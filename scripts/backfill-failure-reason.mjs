#!/usr/bin/env node
/**
 * One-time backfill: mark existing failed jobs with resume.failure_reason
 * so they stop being auto re-enqueued every hour. Only matches the
 * "Unsupported JD" error prefix, which is unambiguous — no-go reasons are
 * free text and self-correct naturally as jobs get retried under the new
 * tailor-worker.mjs code (which now sets failure_reason going forward).
 *
 * Run once: node --env-file=.env scripts/backfill-failure-reason.mjs
 */
import { withMongo, closeMongo } from "./mongo-client.mjs";

async function main() {
  const result = await withMongo(async (db) => {
    const res = await db.collection("jobs").updateMany(
      {
        "resume.status": "failed",
        "resume.error": { $regex: "^Unsupported JD" },
        "resume.failure_reason": { $in: [null, undefined] },
      },
      { $set: { "resume.failure_reason": "unsupported-jd" } },
    );
    return res;
  }, { appName: "AtriveoBackfill" });

  console.log(`Matched ${result.matchedCount}, modified ${result.modifiedCount}`);
  await closeMongo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
