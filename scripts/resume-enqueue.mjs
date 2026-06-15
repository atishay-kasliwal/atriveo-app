#!/usr/bin/env node
/**
 * Enqueue today's top-scoring jobs for Mongo-backed compile (worker drain).
 *
 * Usage:
 *   node scripts/resume-enqueue.mjs [--limit=25] [--min-score=0]
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

async function main() {
  const limit = parseArg("limit", 25);
  const minScore = parseArg("min-score", 0);

  const results = await withMongo(async (db) => {
    await ensureResumeIndex(db);
    return enqueueTopJobs(db, { limit, minScore });
  }, { appName: "AtriveoResumeEnqueue" });

  const enqueued = results.filter((r) => !r.skipped).length;
  const skipped = results.length - enqueued;
  console.log(`Enqueue complete · ${enqueued} queued · ${skipped} skipped · limit ${limit}`);
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
