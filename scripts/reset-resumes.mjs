#!/usr/bin/env node
// Clears compiled resume data for the HOURLY FEED only, every 48h via the
// com.atriveo.resume-reset LaunchAgent. Manual builds (resume.source === 'manual',
// i.e. the dock's "Build a Resume" tab) are PRESERVED forever — both their DB
// records and their PDF folders on disk.
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import os from "os";

dotenv.config();

const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  log("Resume reset starting (preserving manual builds)");

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("job_pipeline");

  // 1) Collect the run_dirs of manual builds so we never delete their PDFs.
  const manualJobs = await db.collection("jobs").find(
    { "resume.source": "manual", "resume.run_dir": { $exists: true, $ne: null } },
    { projection: { _id: 0, "resume.run_dir": 1 } },
  ).toArray();
  const preservedDirs = new Set(
    manualJobs
      .map((j) => j.resume?.run_dir)
      .filter(Boolean)
      .map((d) => path.resolve(d)),
  );
  log(`Preserving ${preservedDirs.size} manual build folder(s)`);

  // 2) Clear the resume field ONLY for non-manual (hourly feed) jobs.
  const result = await db.collection("jobs").updateMany(
    { resume: { $exists: true }, "resume.source": { $ne: "manual" } },
    { $unset: { resume: "" } },
  );
  await client.close();
  log(`Cleared resume field from ${result.modifiedCount} non-manual jobs`);

  // 3) Delete PDF folders on disk, but skip any that belong to a manual build.
  //    Structure: OUT_ROOT/YYYY-MM-DD/<company-folder>[/<run-dir>]
  if (!fs.existsSync(OUT_ROOT)) {
    log(`${OUT_ROOT} does not exist, skipping disk cleanup`);
    log("Resume reset complete");
    return;
  }

  let deleted = 0;
  let kept = 0;
  // Walk each dated dir, then each leaf folder inside it.
  for (const dateEntry of fs.readdirSync(OUT_ROOT, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const dateDir = path.join(OUT_ROOT, dateEntry.name);
    for (const leaf of fs.readdirSync(dateDir, { withFileTypes: true })) {
      if (!leaf.isDirectory()) continue;
      const leafPath = path.resolve(path.join(dateDir, leaf.name));
      // A leaf is preserved if it (or a folder nested under it, for the legacy
      // company/run-dir layout) is a manual run_dir.
      const isManual = preservedDirs.has(leafPath)
        || [...preservedDirs].some((d) => d.startsWith(leafPath + path.sep));
      if (isManual) { kept++; continue; }
      fs.rmSync(leafPath, { recursive: true, force: true });
      deleted++;
    }
    // Remove the dated dir if it's now empty.
    try {
      if (fs.readdirSync(dateDir).length === 0) fs.rmdirSync(dateDir);
    } catch { /* not empty or race — leave it */ }
  }
  log(`Deleted ${deleted} feed folder(s), kept ${kept} manual folder(s)`);

  log("Resume reset complete");
}

main().catch((err) => {
  console.error(new Date().toISOString(), "Reset failed:", err);
  process.exit(1);
});
