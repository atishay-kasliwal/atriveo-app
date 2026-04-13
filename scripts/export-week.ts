/**
 * Export last 7 days of jobs from MongoDB to public/week_jobs.json.
 * Queries the `sessions` collection for all non-archived sessions, then
 * fetches every job belonging to those sessions from the `jobs` collection.
 * Summary is excluded to keep the file size manageable.
 *
 * Usage:  npx tsx scripts/export-week.ts
 * Requires MONGO_URI in environment or a .env file at the project root.
 */
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");

async function main() {
  const { MongoClient } = await import("mongodb");
  const dotenv = await import("dotenv");
  dotenv.config();

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");

  const client = new MongoClient(uri, { appName: "AtriveoExport" });
  await client.connect();
  const db = client.db("job_pipeline");

  // All sessions not yet archived == last 7 days of live data.
  const sessions = await db
    .collection("sessions")
    .find({ archived: false })
    .project({ _id: 0, session_id: 1, run_at: 1 })
    .sort({ run_at: -1 })
    .toArray();

  console.log(`Found ${sessions.length} active sessions`);

  const sessionIds = sessions.map((s) => s.session_id as string);

  // Fetch all jobs for those sessions; skip _id and heavy summary field.
  const jobs = await db
    .collection("jobs")
    .find({ session_id: { $in: sessionIds } })
    .project({
      _id: 0,
      job_url: 1,
      session_id: 1,
      batch_time: 1,
      company: 1,
      competition_score: 1,
      date_posted: 1,
      level: 1,
      location: 1,
      max_exp: 1,
      min_exp: 1,
      pipeline: 1,
      score: 1,
      score_pct: 1,
      search_term: 1,
      site: 1,
      title: 1,
      // summary intentionally excluded — keeps file ~60 % smaller
    })
    .sort({ batch_time: -1 })
    .toArray();

  await client.close();

  const outPath = resolve(PUBLIC_DIR, "week_jobs.json");
  writeFileSync(outPath, JSON.stringify(jobs, null, 2));
  console.log(`✓ Wrote ${jobs.length} jobs across ${sessions.length} sessions → ${outPath}`);
}

main().catch(console.error);
