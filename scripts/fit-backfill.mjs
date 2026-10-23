// Save a current Fit on every recent job that has a tailored resume and lacks one (or has a stale one).
//   node --env-file=.env scripts/fit-backfill.mjs [--days 14] [--limit 5000] [--dry]
// Writes only jobs.fit. Safe to re-run: a current Fit is left alone.
import { withMongo } from "./mongo-client.mjs";
import { ensureFit, fitIsCurrent } from "./fit-store.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg("--days", 14)), LIMIT = Number(arg("--limit", 5000)), DRY = process.argv.includes("--dry");

await withMongo(async (db) => {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const docs = await db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "success" }, { projection: { _id: 0, job_url: 1, title: 1, fit: 1 } }).limit(LIMIT).toArray();
  const stale = docs.filter((d) => !fitIsCurrent(d.fit));
  console.log(`${docs.length} jobs with a resume in the last ${DAYS} days; ${stale.length} need a Fit`);
  if (DRY) return;
  let done = 0;
  for (let i = 0; i < stale.length; i += 100) {
    const got = await ensureFit(db, stale.slice(i, i + 100), { max: 100 });
    done += got.size;
    console.log(`  ${Math.min(i + 100, stale.length)}/${stale.length}`);
  }
  console.log(`saved Fit on ${done} jobs`);
});
process.exit(0);
