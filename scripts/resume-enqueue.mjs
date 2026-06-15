#!/usr/bin/env node
/**
 * Enqueue all jobs that still need a compile (worker drain).
 * Default: all eligible jobs (no cap). Optional: --limit=N
 *
 * Usage:
 *   node scripts/resume-enqueue.mjs [--limit=N] [--min-score=0]
 */

import dotenv from "dotenv";
import { closeMongo, withMongo } from "./mongo-client.mjs";
import { ensureResumeIndex, enqueueTopJobs } from "./resume-queue.mjs";

dotenv.config();

function parseArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_LIMIT = 25;

function parseOptionalLimit() {
  const hit = process.argv.find((a) => a.startsWith("--limit="));
  if (!hit) return DEFAULT_LIMIT;
  const raw = hit.split("=")[1];
  if (raw === "all" || raw === "0") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

async function main() {
  const limit = parseOptionalLimit();
  const minScore = parseArg("min-score", 0);

  const results = await withMongo(async (db) => {
    await ensureResumeIndex(db);
    return enqueueTopJobs(db, { limit, minScore });
  }, { appName: "AtriveoResumeEnqueue" });

  const enqueued = results.filter((r) => !r.skipped).length;
  const skipped = results.length - enqueued;
  console.log(`Enqueue complete · ${enqueued} queued · ${skipped} skipped · limit ${limit ?? "all"}`);
  for (const r of results.filter((x) => !x.skipped)) {
    console.log(`  + ${r.jobUrl}`);
  }
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => closeMongo());
