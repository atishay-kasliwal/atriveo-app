// Retention and local cleanup for resumes kept in R2. Both are dry-run unless --apply is given.
//
//   node --env-file=.env scripts/resume-retention.mjs prune  [--days 60] [--apply]   unapplied resumes older than N days leave R2
//   node --env-file=.env scripts/resume-retention.mjs local  [--days 14] [--apply]   local copies of resumes that are safely in R2 are deleted
//   node --env-file=.env scripts/resume-retention.mjs jobs   [--days 3]  [--apply] [--compact]
//        jobs you did not apply to, scraped more than N days ago, leave Mongo (jobs + descriptions) with their resume folder and R2 files.
//        --compact then gives the freed space back to the disk (Mongo reuses deleted space but does not shrink its files on its own).
//
// Never touched: a resume of a job you applied to (any application, any status other than discarded, or an applied swipe),
// anything newer than the cutoff, and the general resumes (the general/ folder of a resume root). An R2 object shared by several jobs (the same file) goes only when none of them is kept.
// A local copy goes only when its bytes still match the hash recorded in R2.
// "jobs" also keeps: jobs saved for later, Create-tab builds (resume.source manual), resumes being built (queued/running), resumes
// you edited within the window, and rows with no scrape date (staffing). A job's rows go only after its resume files are gone.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { withMongo } from "./mongo-client.mjs";
import { storeFromEnv } from "./resume-store.mjs";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const objectKeys = (o) => [o?.key, o?.image_key, o?.tex_key, o?.jd_key].filter(Boolean);
const BUILDING = ["queued", "running"];
const BATCH = 500;

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

export async function planLocal(db, { days = 14, now = new Date(), exists = fs.existsSync, read = fs.readFileSync, roots = resumeRoots() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const kept = await keptJobUrls(db);
  const docs = await db.collection("jobs").find({ "resume.object.sha256": { $type: "string" }, "resume.pdf_path": { $type: "string" } }, { projection: { job_url: 1, run_at: 1, resume: 1 } }).toArray();
  const out = [], skipped = { too_new: 0, kept_application: 0, missing: 0, changed: 0 };
  for (const d of docs) {
    const file = d.resume.pdf_path, when = new Date(d.resume.updated_at ?? d.run_at ?? 0);
    if (when >= cutoff) { skipped.too_new++; continue; }
    if (isGeneral(path.resolve(file), roots)) { skipped.general = (skipped.general ?? 0) + 1; continue; }
    if (kept.has(d.job_url)) { skipped.kept_application++; continue; }
    if (!exists(file)) { skipped.missing++; continue; }
    if (sha(read(file)) !== d.resume.object.sha256) { skipped.changed++; continue; }
    const dir = path.dirname(file);
    out.push([file, path.join(dir, "resume-page.png")].filter((f) => exists(f)));
  }
  return { files: out.flat(), skipped };
}

/** Where resume folders may be deleted: TAILOR_OUT_ROOT, ~/Documents/tailored-resumes, and the Mac path Mongo stores (mounted on Oracle). */
export function resumeRoots(env = process.env) {
  return [...new Set([env.TAILOR_OUT_ROOT?.trim(), path.join(os.homedir(), "Documents", "tailored-resumes"), "/Users/atishaykasliwal/Documents/tailored-resumes"]
    .filter(Boolean).map((r) => path.resolve(r)))];
}

/** The general resumes (one per role track) belong to no job: a job that used one never takes it along when it leaves. */
const isGeneral = (p, roots) => roots.some((r) => { const g = path.join(r, "general"); return p === g || p.startsWith(g + path.sep); });

/** A resume's folder, only when it sits strictly inside one of the roots (never a root itself, never the general resumes). */
export function resumeFolder(file, roots) {
  if (typeof file !== "string" || !file) return null;
  const dir = path.dirname(path.resolve(file));
  if (isGeneral(dir, roots)) return null;
  return roots.some((r) => dir.startsWith(r + path.sep)) ? dir : null;
}

const scrapedAt = (v) => { const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null; return d && !Number.isNaN(+d) ? d : null; };
const docFolders = (d, roots) => [d.resume?.pdf_path, d.resume?.generated_pdf_path].map((f) => resumeFolder(f, roots)).filter(Boolean);
const nested = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);

/**
 * Which jobs leave Mongo: every row of a job URL goes when none of them is kept and all were scraped before the cutoff.
 * Returns { urls, keys (R2), folders: Map(folder -> [urls]), kept }. Pure apart from the reads.
 */
export async function planJobs(db, { days = 3, now = new Date(), roots = resumeRoots() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const [applied, later, apps, docs] = await Promise.all([
    keptJobUrls(db),
    db.collection("job_swipes").find({ direction: "later" }, { projection: { job_url: 1 } }).toArray(),
    db.collection("applications").find({}, { projection: { "resume.path": 1 } }).toArray(),
    db.collection("jobs").find({}, { projection: { job_url: 1, run_at: 1, "resume.source": 1, "resume.status": 1, "resume.edited_at": 1,
      "resume.object": 1, "resume.pdf_path": 1, "resume.generated_pdf_path": 1 } }).toArray(),
  ]);
  const kept = new Set([...applied, ...later.map((s) => s.job_url)].filter(Boolean));
  const keepDoc = (d) => {
    const at = scrapedAt(d.run_at), edited = scrapedAt(d.resume?.edited_at);
    return !d.job_url || kept.has(d.job_url) || !at || at >= cutoff || d.resume?.source === "manual"
      || BUILDING.includes(d.resume?.status) || (edited && edited >= cutoff);
  };
  const byUrl = new Map();
  for (const d of docs) byUrl.set(d.job_url, [...(byUrl.get(d.job_url) ?? []), d]);
  const drop = [], stay = [];
  for (const [url, rows] of byUrl) (rows.every((d) => !keepDoc(d)) ? drop : stay).push(...rows.map((d) => ({ ...d, url })));

  const keepKeys = new Set(stay.flatMap((d) => objectKeys(d.resume?.object)));
  const keepFolders = [...stay.flatMap((d) => docFolders(d, roots)), ...apps.map((a) => resumeFolder(a.resume?.path, roots)).filter(Boolean)];
  const keys = new Set(), folders = new Map();
  for (const d of drop) {
    for (const k of objectKeys(d.resume?.object)) if (!keepKeys.has(k)) keys.add(k);
    for (const f of docFolders(d, roots)) if (!keepFolders.some((k) => nested(f, k))) folders.set(f, [...new Set([...(folders.get(f) ?? []), d.url])]);
  }
  return { cutoff, urls: [...new Set(drop.map((d) => d.url))], rows: drop.length, keys: [...keys], folders, kept: byUrl.size - new Set(drop.map((d) => d.url)).size };
}

function folderBytes(dir) {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? folderBytes(p) : fs.statSync(p).size; } } catch { /* gone or unreadable */ }
  return n;
}

/**
 * Carry out a plan: resume folders and R2 files first, then the Mongo rows of the jobs whose files are gone (a failed delete keeps
 * the job, so the next run tries again instead of leaving files nobody points at). Then descriptions with no job row left: those of
 * the jobs just deleted, and any other added before the cutoff (a fresh one may belong to a job being written right now). The delete re-checks age and build state, so a row that changed since the plan stays.
 */
export async function applyJobs(db, plan, { store = storeFromEnv(), rm = (d) => fs.rmSync(d, { recursive: true, force: true }), log = console.log } = {}) {
  const failed = new Set();
  let folders = 0, objects = 0;
  for (const [dir, urls] of plan.folders) { try { rm(dir); folders++; } catch (e) { urls.forEach((u) => failed.add(u)); log(`  could not delete ${dir}: ${e.message}`); } }
  if (plan.keys.length && !store) log("  R2 is not configured: its files for these jobs are left in R2");
  else for (const k of plan.keys) { try { await store.del(k); objects++; } catch (e) { log(`  could not delete R2 ${k}: ${e.message}`); } }

  const urls = plan.urls.filter((u) => !failed.has(u));
  const old = { $or: [{ run_at: { $lt: plan.cutoff } }, { run_at: { $type: "string", $lt: plan.cutoff.toISOString() } }] };
  let jobs = 0, descriptions = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const chunk = urls.slice(i, i + BATCH);
    jobs += (await db.collection("jobs").deleteMany({ job_url: { $in: chunk }, ...old, "resume.status": { $nin: BUILDING } })).deletedCount;
  }
  const live = new Set(await db.collection("jobs").distinct("job_url"));
  const gone = new Set(urls);
  const orphans = (await db.collection("descriptions").find({}, { projection: { job_url: 1 } }).toArray())
    .filter((d) => !live.has(d.job_url) && (gone.has(d.job_url) || (d._id instanceof ObjectId && d._id.getTimestamp() < plan.cutoff))).map((d) => d._id);
  for (let i = 0; i < orphans.length; i += BATCH) descriptions += (await db.collection("descriptions").deleteMany({ _id: { $in: orphans.slice(i, i + BATCH) } })).deletedCount;
  return { jobs, descriptions, folders, objects, skipped: failed.size };
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
    } else if (mode === "jobs") {
      const plan = await planJobs(db, { days: arg("--days", 3) });
      const bytes = [...plan.folders.keys()].reduce((n, d) => n + folderBytes(d), 0);
      console.log(`${plan.urls.length} unapplied jobs scraped before ${plan.cutoff.toISOString().slice(0, 16)}Z (${plan.rows} rows), ${plan.folders.size} resume folders`
        + ` (${(bytes / 1e6).toFixed(1)} MB), ${plan.keys.length} R2 files; ${plan.kept} jobs kept${apply ? "" : "  [dry run: add --apply]"}`);
      if (apply) console.log(`deleted ${JSON.stringify(await applyJobs(db, plan))}`);
      if (apply && process.argv.includes("--compact")) {
        for (const c of ["jobs", "descriptions"]) {
          try { const r = await db.command({ compact: c }); console.log(`compacted ${c}: ${((r.bytesFreed ?? 0) / 1e6).toFixed(1)} MB back to the disk`); }
          catch (e) { console.log(`compact ${c} failed: ${e.message}`); }
        }
      }
      const s = await db.command({ dbStats: 1 });
      console.log(`Mongo now: ${(s.dataSize / 1e6).toFixed(0)} MB data, ${((s.storageSize + s.indexSize) / 1e6).toFixed(0)} MB on disk`);
    } else { console.log("usage: resume-retention.mjs prune|local|jobs [--days N] [--apply] [--compact]"); }
  });
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
