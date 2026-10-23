// Retention and local cleanup for resumes kept in R2. Both are dry-run unless --apply is given.
//
//   node --env-file=.env scripts/resume-retention.mjs prune  [--days 60] [--apply]   unapplied resumes older than N days leave R2
//   node --env-file=.env scripts/resume-retention.mjs local  [--days 14] [--apply]   local copies of resumes that are safely in R2 are deleted
//
// Never touched: a resume of a job you applied to (any application, any status other than discarded, or an applied swipe),
// and anything newer than the cutoff. An R2 object shared by several jobs (the same file) goes only when none of them is kept.
// A local copy goes only when its bytes still match the hash recorded in R2.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { withMongo } from "./mongo-client.mjs";
import { storeFromEnv } from "./resume-store.mjs";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const objectKeys = (o) => [o?.key, o?.image_key, o?.tex_key, o?.jd_key].filter(Boolean);

/** The job URLs whose resumes must be kept: applied, or part of an application that is not discarded. */
export async function keptJobUrls(db) {
  const [apps, swipes] = await Promise.all([
    db.collection("applications").find({ status: { $ne: "DISCARDED" } }, { projection: { jobUrls: 1, url: 1 } }).toArray(),
    db.collection("job_swipes").find({ direction: "applied" }, { projection: { job_url: 1 } }).toArray(),
  ]);
  return new Set([...apps.flatMap((a) => [a.url, ...(a.jobUrls ?? [])]), ...swipes.map((s) => s.job_url)].filter(Boolean));
}

export async function planPrune(db, { days = 60, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const kept = await keptJobUrls(db);
  const docs = await db.collection("jobs").find({ "resume.object.key": { $type: "string" } }, { projection: { job_url: 1, run_at: 1, "resume.object": 1, "resume.updated_at": 1 } }).toArray();
  const keep = new Set(), drop = new Map();
  for (const d of docs) {
    const when = new Date(d.resume?.updated_at ?? d.run_at ?? 0);
    const protectedJob = kept.has(d.job_url) || when >= cutoff;
    for (const k of objectKeys(d.resume.object)) (protectedJob ? keep.add(k) : drop.set(k, d.job_url));
  }
  return { delete: [...drop.keys()].filter((k) => !keep.has(k)), jobs: new Set([...drop.values()]).size, kept: keep.size };
}

export async function planLocal(db, { days = 14, now = new Date(), exists = fs.existsSync, read = fs.readFileSync } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const kept = await keptJobUrls(db);
  const docs = await db.collection("jobs").find({ "resume.object.sha256": { $type: "string" }, "resume.pdf_path": { $type: "string" } }, { projection: { job_url: 1, run_at: 1, resume: 1 } }).toArray();
  const out = [], skipped = { too_new: 0, kept_application: 0, missing: 0, changed: 0 };
  for (const d of docs) {
    const file = d.resume.pdf_path, when = new Date(d.resume.updated_at ?? d.run_at ?? 0);
    if (when >= cutoff) { skipped.too_new++; continue; }
    if (kept.has(d.job_url)) { skipped.kept_application++; continue; }
    if (!exists(file)) { skipped.missing++; continue; }
    if (sha(read(file)) !== d.resume.object.sha256) { skipped.changed++; continue; }
    const dir = path.dirname(file);
    out.push([file, path.join(dir, "resume-page.png")].filter((f) => exists(f)));
  }
  return { files: out.flat(), skipped };
}

async function main() {
  const [mode] = process.argv.slice(2);
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const apply = process.argv.includes("--apply");
  await withMongo(async (db) => {
    if (mode === "prune") {
      const plan = await planPrune(db, { days: arg("--days", 60) });
      console.log(`${plan.delete.length} R2 objects from ${plan.jobs} unapplied jobs older than the cutoff (${plan.kept} objects kept)${apply ? "" : "  [dry run: add --apply]"}`);
      if (apply) { const store = storeFromEnv(); if (!store) throw new Error("R2 is not configured"); for (const k of plan.delete) await store.del(k); console.log("deleted"); }
    } else if (mode === "local") {
      const plan = await planLocal(db, { days: arg("--days", 14) });
      console.log(`${plan.files.length} local files safely in R2; skipped ${JSON.stringify(plan.skipped)}${apply ? "" : "  [dry run: add --apply]"}`);
      if (apply) { for (const f of plan.files) fs.unlinkSync(f); console.log("deleted"); }
    } else { console.log("usage: resume-retention.mjs prune|local [--days N] [--apply]"); }
  });
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
