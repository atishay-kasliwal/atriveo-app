#!/usr/bin/env node
// Clears all compiled resume data from DB and deletes local PDFs.
// Runs every 48h via com.atriveo.resume-reset LaunchAgent.
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import os from "os";

dotenv.config();

const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  log("Resume reset starting");

  // Clear resume fields from DB
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("job_pipeline");
  const result = await db.collection("jobs").updateMany(
    { resume: { $exists: true } },
    { $unset: { resume: "" } }
  );
  await client.close();
  log(`Cleared resume field from ${result.modifiedCount} jobs`);

  // Delete local PDF folder
  if (fs.existsSync(OUT_ROOT)) {
    fs.rmSync(OUT_ROOT, { recursive: true, force: true });
    log(`Deleted ${OUT_ROOT}`);
  } else {
    log(`${OUT_ROOT} does not exist, skipping`);
  }

  log("Resume reset complete");
}

main().catch((err) => {
  console.error(new Date().toISOString(), "Reset failed:", err);
  process.exit(1);
});
