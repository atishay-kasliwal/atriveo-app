import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const PUBLIC_DIR = resolve(ROOT_DIR, "public");
const OUT_DIR = resolve(PUBLIC_DIR, "job_descriptions");
const DATA_FILES = [
  "jobs.json",
  "today_jobs.json",
  "yesterday_jobs.json",
  "week_jobs.json",
  "important_jobs.json",
];

function bucketForUrl(jobUrl) {
  let hash = 0;
  for (let index = 0; index < jobUrl.length; index += 1) {
    hash = ((hash * 31) + jobUrl.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

function activeJobUrls() {
  const urls = new Set();
  for (const file of DATA_FILES) {
    const path = resolve(PUBLIC_DIR, file);
    if (!existsSync(path)) continue;
    const rows = JSON.parse(readFileSync(path, "utf8"));
    for (const row of rows) {
      if (row?.job_url) urls.add(row.job_url);
    }
  }
  return [...urls];
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is not set");

  const urls = new Set(activeJobUrls());
  const client = new MongoClient(mongoUri, { appName: "AtriveoDescriptionExport" });
  await client.connect();
  const db = client.db("job_pipeline");

  const todayUtc = new Date().toISOString().slice(0, 10);
  const todaysJobs = await db.collection("jobs")
    .find({ batch_time: { $gte: todayUtc } }, { projection: { _id: 0, job_url: 1 } })
    .toArray();
  for (const job of todaysJobs) {
    if (job?.job_url) urls.add(job.job_url);
  }

  const buckets = new Map();
  let found = 0;
  const urlList = [...urls];
  for (let index = 0; index < urlList.length; index += 100) {
    const chunk = urlList.slice(index, index + 100);
    const rows = await db.collection("descriptions")
      .find({ job_url: { $in: chunk } }, { projection: { _id: 0, job_url: 1, description: 1 } })
      .toArray();

    for (const row of rows) {
      const description = typeof row.description === "string" ? row.description.trim() : "";
      if (!description) continue;
      const bucket = bucketForUrl(row.job_url);
      if (!buckets.has(bucket)) buckets.set(bucket, {});
      buckets.get(bucket)[row.job_url] = description;
      found += 1;
    }
  }

  await client.close();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [bucket, data] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    writeFileSync(resolve(OUT_DIR, `${bucket}.json`), JSON.stringify(data));
  }

  writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    active_urls: urlList.length,
    descriptions_found: found,
    buckets: buckets.size,
  }, null, 2));

  const ratio = urlList.length ? found / urlList.length : 1;
  console.log(`✓ Exported ${found}/${urlList.length} full job descriptions into ${buckets.size} buckets`);
  if (ratio < 0.85) {
    console.warn(`⚠ Only ${(ratio * 100).toFixed(0)}% of active jobs have a JD — jobs without one will fail as "no-jd" in the app. Re-run after the scraper finishes if this is unexpectedly low.`);
  }
  console.log(`  Reminder: run this AFTER every scrape, or the app serves stale JDs and resumes fail with "No full JD captured".`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
