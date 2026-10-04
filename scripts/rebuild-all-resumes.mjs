#!/usr/bin/env node
// One-off: delete every built resume and cover letter, then build them all again from scratch.
//
//   node scripts/rebuild-all-resumes.mjs                 # dry run: counts only, changes nothing
//   node scripts/rebuild-all-resumes.mjs --apply         # delete files + cache, re-queue in Mongo
//   node scripts/rebuild-all-resumes.mjs --apply --files-only   # this machine's files + cache only
//
// Deletes everything under TAILOR_OUT_ROOT (resumes, cover letters, manual builds included) and the compile
// cache (ARTIFACTS_ROOT), so nothing is reused. Then every job that had a built, queued or running resume is
// queued again for this backend's compile worker (compileOwner), newest postings first; the worker writes a
// draft cover letter next to each new resume (resume-cover.mjs). Every other job's resume record is cleared.
// Applications are not touched: ones pointing at a deleted file fail their file check and wait for you.
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { getArtifactsRoot } from "./ac-artifact-store.mjs";
import { enqueueJob } from "./resume-queue.mjs";
import { compileOwner } from "./worker-id.mjs";

const RECENT_MS = 3 * 24 * 3600 * 1000;
const PRIORITY_RECENT = 1000;
const PRIORITY_OLDER = 100;

function emptyDir(dir, apply) {
  if (!dir || !fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir);
  if (apply) for (const e of entries) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  return entries.length;
}

function postedAt(job) {
  const t = Date.parse(job.batch_time || job.resume?.batch_time || job.date_posted || "");
  return Number.isFinite(t) ? t : 0;
}

export async function rebuildAllResumes({ db, outRoot, artifactsRoot, apply = false, filesOnly = false, owner = compileOwner(), now = Date.now(), log = console.log }) {
  for (const root of [outRoot, artifactsRoot]) {
    if (!root || path.resolve(root) === path.parse(path.resolve(root)).root || path.resolve(root) === os.homedir()) throw new Error(`refusing to empty ${root}`);
  }
  const files = { resumes: emptyDir(outRoot, apply), cache: emptyDir(artifactsRoot, apply) };
  log(`${apply ? "Deleted" : "Would delete"} ${files.resumes} folder(s) in ${outRoot} and ${files.cache} cache entr(ies) in ${artifactsRoot}`);
  if (filesOnly) return { files, requeued: 0, cleared: 0 };

  const jobs = db.collection("jobs");
  const targets = await jobs.find(
    { "resume.status": { $in: ["success", "queued", "running"] } },
    { projection: { job_url: 1, company: 1, title: 1, location: 1, batch_time: 1, date_posted: 1, session_id: 1, "resume.source": 1, "resume.batch_time": 1 } },
  ).toArray();
  const others = await jobs.countDocuments({ resume: { $exists: true }, "resume.status": { $nin: ["success", "queued", "running"] } });
  const recent = targets.filter((j) => now - postedAt(j) < RECENT_MS).length;
  log(`${apply ? "Re-queuing" : "Would re-queue"} ${targets.length} job(s) for ${owner} (${recent} recent first), ${apply ? "clearing" : "would clear"} ${others} other resume record(s)`);
  if (!apply) return { files, requeued: targets.length, cleared: others };

  let requeued = 0;
  for (const j of targets) {
    await enqueueJob(db, {
      job_url: j.job_url,
      company: j.company,
      title: j.title,
      location: j.location,
      batch_time: j.batch_time || j.resume?.batch_time || null,
      session_id: j.session_id || null,
      source: j.resume?.source || "hourly",
      owner,
      priority: now - postedAt(j) < RECENT_MS ? PRIORITY_RECENT : PRIORITY_OLDER,
    }, { force: true });
    requeued += 1;
    if (requeued % 250 === 0) log(`  ${requeued}/${targets.length}`);
  }
  const cleared = (await jobs.updateMany({ resume: { $exists: true }, "resume.status": { $nin: ["queued"] } }, { $unset: { resume: "" } })).modifiedCount;
  log(`Re-queued ${requeued}, cleared ${cleared}`);
  return { files, requeued, cleared };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  dotenv.config();
  const apply = process.argv.includes("--apply");
  const filesOnly = process.argv.includes("--files-only");
  const outRoot = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
  const run = async (db) => rebuildAllResumes({ db, outRoot, artifactsRoot: getArtifactsRoot(), apply, filesOnly });
  (async () => {
    if (filesOnly) return run(null);
    const { withMongo, closeMongo } = await import("./mongo-client.mjs");
    try { return await withMongo(run, { appName: "AtriveoResumeRebuild" }); } finally { await closeMongo(); }
  })().then(() => { if (!apply) console.log("Dry run. Add --apply to do it."); }).catch((e) => { console.error(e); process.exit(1); });
}
