#!/usr/bin/env node
/**
 * Enqueue jobs for the compile worker.
 *
 * Default (hourly): only the latest scraped session — fresh JDs first.
 *   node scripts/resume-enqueue.mjs [--limit=all] [--min-score=0]
 *
 * Legacy (all eligible jobs by score):
 *   node scripts/resume-enqueue.mjs --all
 */

import dotenv from "dotenv";
import { closeMongo, withMongo } from "./mongo-client.mjs";
import {
  ensureResumeIndex,
  enqueueFreshSessionJobs,
  enqueueTopJobs,
  purgeStaleQueuedJobs,
  resolveFreshSessionIds,
  resolveLatestSession,
} from "./resume-queue.mjs";

dotenv.config();

function parseArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalLimit() {
  const hit = process.argv.find((a) => a.startsWith("--limit="));
  if (!hit) return null;
  const raw = hit.split("=")[1];
  if (raw === "all" || raw === "0") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const useAll = process.argv.includes("--all");

async function main() {
  const limit = parseOptionalLimit();
  const minScore = parseArg("min-score", 0);

  const results = await withMongo(async (db) => {
    await ensureResumeIndex(db);
    if (useAll) {
      return enqueueTopJobs(db, { limit, minScore });
    }
    const purged = await purgeStaleQueuedJobs(db);
    if (purged > 0) console.log(`Purged stale queue · ${purged} jobs`);
    const latest = await resolveLatestSession(db);
    if (latest) {
      console.log(`Today's session · ${latest.sessionId} · ${latest.runAt}`);
    } else {
      console.log("No scrape session for today (ET) — skip fresh enqueue");
      return [{ skipped: true, reason: "no_fresh_session_today" }];
    }
    return enqueueFreshSessionJobs(db, { limit, minScore });
  }, { appName: "AtriveoResumeEnqueue" });

  const enqueued = results.filter((r) => !r.skipped).length;
  const skipped = results.length - enqueued;
  const mode = useAll ? "all" : "fresh";
  console.log(`Enqueue complete · ${enqueued} queued · ${skipped} skipped · mode ${mode} · limit ${limit ?? "all"}`);
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
