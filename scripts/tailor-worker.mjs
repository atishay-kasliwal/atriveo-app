#!/usr/bin/env node
/**
 * Persistent compile worker — drains Mongo queue without browser tab.
 * Supports cross-machine fleets: stable WORKER_ID, lease renewal, heartbeats.
 *
 * Usage:
 *   npm run tailor:worker              # loop forever
 *   npm run tailor:worker -- --once      # process one job and exit
 *   npm run tailor:worker -- --enqueue   # enqueue top jobs then drain once
 *
 * Env:
 *   WORKER_ID          — override stable id (default: ~/.atriveo/worker-id)
 *   WORKER_REQUIRE_DRIVE=0 — claim jobs even without external drive (not recommended)
 *   TAILOR_OUT_ROOT    — PDF output root (must match across machines sharing a drive)
 *   ARTIFACTS_ROOT     — manifest cache root
 */

import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMongo, withMongo } from "./mongo-client.mjs";
import {
  claimNextJob,
  ensureResumeIndex,
  enqueueFreshSessionJobs,
  fetchDescription,
  renewJobLease,
  updateResumeState,
} from "./resume-queue.mjs";
import { resolveResumeSessionDir } from "./resume-path.mjs";
import { tailorOneAc } from "./tailor-ac.mjs";
import { getArtifactsRoot, readManifest } from "./ac-artifact-store.mjs";
import { getWorkerId } from "./worker-id.mjs";
import {
  ensureWorkerIndex,
  heartbeatWorker,
  markWorkerOffline,
  setWorkerBusy,
  setWorkerIdle,
} from "./worker-registry.mjs";

dotenv.config();

const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || "/Volumes/Kasliwal v2/tailored-resumes";
const POLL_MS = Number(process.env.WORKER_POLL_MS || 30_000);
const LEASE_SEC = Number(process.env.WORKER_LEASE_SEC || 900);
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS || 30_000);
const LEASE_RENEW_MS = Number(process.env.WORKER_LEASE_RENEW_MS || Math.min(120_000, (LEASE_SEC * 1000) / 4));
const PLANNER = process.env.TAILOR_PLANNER?.trim() || "v2";
const WORKER_ID = getWorkerId();
const REQUIRE_DRIVE = process.env.WORKER_REQUIRE_DRIVE !== "0";

const ONCE = process.argv.includes("--once");
const ENQUEUE = process.argv.includes("--enqueue");

function log(kind, msg) {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] [${kind}] ${msg}`);
}

function driveMounted() {
  try {
    return fs.existsSync(path.dirname(OUT_ROOT));
  } catch {
    return false;
  }
}

function workerProfile(status = "idle", currentJobUrl = null) {
  return {
    hostname: os.hostname(),
    planner: PLANNER,
    out_root: OUT_ROOT,
    artifacts_root: getArtifactsRoot(),
    drive_mounted: driveMounted(),
    status,
    current_job_url: currentJobUrl,
  };
}

function nextSeq(dateDir) {
  if (!fs.existsSync(dateDir)) return 1;
  const existing = fs.readdirSync(dateDir).filter((d) => /^\d+[_-]/.test(d));
  return existing.length + 1;
}

async function processOneJob(db) {
  if (REQUIRE_DRIVE && !driveMounted()) {
    log("wait", `drive not mounted (${path.dirname(OUT_ROOT)}) — skipping claim`);
    return false;
  }

  const jobDoc = await claimNextJob(db, WORKER_ID, LEASE_SEC);
  if (!jobDoc?.job_url) return false;

  const jobUrl = jobDoc.job_url;
  const company = jobDoc.company || jobDoc.resume?.company || "unknown";
  const title = jobDoc.title || jobDoc.resume?.title || "role";
  log("claim", `${company} · ${title} · worker ${WORKER_ID} · ${jobUrl.slice(0, 60)}…`);

  await setWorkerBusy(db, WORKER_ID, jobUrl, workerProfile("busy", jobUrl));

  const jd = await fetchDescription(db, jobUrl);
  if (!jd || jd.length < 200) {
    await updateResumeState(db, jobUrl, {
      status: "failed",
      stage: "GATED",
      error: "JD not found or too short in Mongo descriptions",
      lease_until: null,
    });
    await setWorkerIdle(db, WORKER_ID, workerProfile());
    log("fail", `Missing JD for ${jobUrl}`);
    return true;
  }

  if (REQUIRE_DRIVE && !driveMounted()) {
    await updateResumeState(db, jobUrl, {
      status: "queued",
      lease_until: null,
      worker_id: null,
      error: "External drive not mounted",
    });
    await setWorkerIdle(db, WORKER_ID, workerProfile());
    throw new Error(`External drive not mounted: ${path.dirname(OUT_ROOT)}`);
  }

  const batchTime = jobDoc.batch_time || jobDoc.resume?.batch_time || null;
  const { dateDir, hour } = resolveResumeSessionDir(
    OUT_ROOT,
    batchTime,
    jobDoc.resume?.session_hour,
  );
  const storedSlot = Number(jobDoc.resume?.resume_slot);
  const seq = Number.isInteger(storedSlot) && storedSlot > 0
    ? storedSlot
    : nextSeq(dateDir);
  log("path", `${hour}h · slot ${seq} · ${dateDir}`);

  const ctx = {
    sendPhase: () => {},
    log: (kind, text) => log(kind, text),
  };

  let leaseTimer = null;
  try {
    await updateResumeState(db, jobUrl, { stage: "GATED" });

    leaseTimer = setInterval(() => {
      void renewJobLease(db, jobUrl, WORKER_ID, LEASE_SEC).then((ok) => {
        if (ok) log("lease", `renewed · ${company}`);
      }).catch(() => { /* mongo blip */ });
    }, LEASE_RENEW_MS);

    const result = await tailorOneAc(
      {
        company,
        title,
        job_url: jobUrl,
        jd,
        score_pct: jobDoc.score_pct ?? null,
      },
      seq,
      dateDir,
      ctx,
      {
        planner: PLANNER,
        learn: process.env.TAILOR_LEARN === "1",
        forceRecompile: process.env.TAILOR_FORCE_RECOMPILE === "1",
      },
    );

    const success = result.status === "ok" && result.pdfPath;
    const fingerprint = result.fingerprint || null;
    const manifest = fingerprint ? readManifest(fingerprint) : null;

    await updateResumeState(db, jobUrl, {
      status: success ? "success" : "failed",
      stage: success ? "SUCCESS" : (manifest?.stage || "PDF"),
      fingerprint,
      lease_until: null,
      worker_id: WORKER_ID,
      error: success ? null : (result.error || result.status),
      run_dir: result.dir || null,
      pdf_path: result.pdfPath || null,
      folder: result.folder || null,
      resume_slot: seq,
      session_hour: hour,
      batch_time: batchTime,
      cached: Boolean(result.cached),
    });

    log(
      success ? (result.cached ? "cache" : "done") : "fail",
      `${company} · ${result.cached ? "cache hit" : result.status}${fingerprint ? ` · fp ${fingerprint.slice(0, 12)}…` : ""}`,
    );
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    await setWorkerIdle(db, WORKER_ID, workerProfile());
  }

  return true;
}

async function main() {
  log("start", `worker ${WORKER_ID} · planner ${PLANNER} · out ${OUT_ROOT} · artifacts ${getArtifactsRoot()}`);

  let heartbeatTimer = null;

  await withMongo(async (db) => {
    await ensureResumeIndex(db);
    await ensureWorkerIndex(db);
    await heartbeatWorker(db, WORKER_ID, workerProfile());
    if (ENQUEUE) {
      const rawLimit = process.env.WORKER_ENQUEUE_LIMIT?.trim();
      const limit = rawLimit ? Number(rawLimit) : null;
      const results = await enqueueFreshSessionJobs(db, { limit: limit && limit > 0 ? limit : null });
      log("enqueue", `${results.filter((r) => !r.skipped).length} jobs queued`);
    }
  }, { appName: "AtriveoTailorWorker" });

  heartbeatTimer = setInterval(() => {
    void withMongo(async (db) => {
      await heartbeatWorker(db, WORKER_ID, workerProfile());
    }, { appName: "AtriveoTailorWorker" }).catch(() => { /* ignore */ });
  }, HEARTBEAT_MS);

  try {
    do {
      let processed = false;
      await withMongo(async (db) => {
        processed = await processOneJob(db);
      }, { appName: "AtriveoTailorWorker" });

      if (!processed) {
        if (ONCE) break;
        log("idle", `no queued jobs · sleeping ${POLL_MS / 1000}s`);
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      if (ONCE) break;
    } while (true);

    log("exit", ONCE ? "after one pass" : "worker stopped");
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await withMongo(async (db) => {
      await markWorkerOffline(db, WORKER_ID);
    }, { appName: "AtriveoTailorWorker" }).catch(() => { /* ignore */ });
  }
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => closeMongo());
