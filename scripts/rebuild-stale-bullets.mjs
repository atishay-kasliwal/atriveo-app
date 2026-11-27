// After a bank change: which built resumes still print a bullet that has since been retired, removed or reworded, and
// re-queue the job resumes among them (docs/open-source-rules.md, rule 7). Each resume's composition.json keeps the id
// and wording it printed, so this needs no git history. Report only unless --apply.
//   node --env-file=.env scripts/rebuild-stale-bullets.mjs                 job resumes of the last 7 days, report only
//   node --env-file=.env scripts/rebuild-stale-bullets.mjs --apply         queue those rebuilds (below fresh jobs)
//   node scripts/rebuild-stale-bullets.mjs --masters                       the five masters and pasted resumes (files only)
//   options: --days 7   --limit 3000   --only open-source (bullets of one role)
// Never queued: a job you applied to (that resume may be the one you sent), and a resume you edited in the builder
// (builder.json): both are listed for you. Masters are rebuilt by hand (scripts/general-resumes.mjs, rule 7).
// Run job checks where the resume files are (inside the dashboard container on Oracle).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBank } from "./ac-bank.mjs";

const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
const retired = (x) => Array.isArray(x?.tracks) && x.tracks.includes("retired");

/** Pure: the bullets of one composition that no longer match the bank. [] when it is current. */
export function staleBullets(composition, bank, { only = null } = {}) {
  const comp = composition?.composition ?? composition ?? {};
  const byId = new Map((bank.acs || []).map((a) => [a.id, a]));
  const out = [];
  for (const section of [...(comp.experience || []), ...(comp.projects || [])]) {
    if (only && section.role !== only) continue;
    for (const b of section.bullets || []) {
      const id = b.ac_id ?? b.ac?.id;
      if (!id || !/^AC-\d+$/.test(id)) continue;
      const ac = byId.get(id);
      if (!ac) { out.push({ id, role: section.role, why: "removed from the bank" }); continue; }
      const v = (ac.variants || []).find((x) => (x.facet ?? "default") === (b.facet ?? "default")) || null;
      if (retired(ac) || retired(v)) { out.push({ id, role: section.role, why: "retired" }); continue; }
      if (!v) { out.push({ id, role: section.role, why: "its wording was removed" }); continue; }
      if (clean(v.text) !== clean(b.text ?? b.face?.text)) out.push({ id, role: section.role, why: "reworded" });
    }
  }
  return out;
}

const readComposition = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "composition.json"), "utf8")); } catch { return null; } };

/** The masters (general/<Track>/) and pasted resumes (pasted/<id>/) under the output root. Files only. */
export function staleFiles(outRoot, bank, opts = {}) {
  const rows = [];
  for (const kind of ["general", "pasted"]) {
    const base = path.join(outRoot, kind);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (name.startsWith(".") || !fs.statSync(dir).isDirectory()) continue;
      const comp = readComposition(dir);
      if (!comp) continue;
      const stale = staleBullets(comp, bank, opts);
      if (stale.length) rows.push({ kind, name, dir, edited: fs.existsSync(path.join(dir, "builder.json")), stale });
    }
  }
  return rows;
}

/** Job resumes of the last `days` days. Queues the stale ones that are neither applied to nor edited. */
export async function rebuildStaleJobs(db, { bank = loadBank(), apply = false, days = 7, limit = 3000, only = null, enqueue = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600e3);
  const rows = await db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "success" })
    .project({ job_url: 1, company: 1, title: 1, location: 1, "resume.pdf_path": 1 }).sort({ run_at: -1 }).toArray();
  const seen = new Set(), jobs = rows.filter((r) => r.resume?.pdf_path && !seen.has(r.job_url) && seen.add(r.job_url)).slice(0, limit);
  const applied = new Set((await db.collection("applications").find({}, { projection: { url: 1, jobUrls: 1, "resume.sourceJobUrl": 1 } }).toArray())
    .flatMap((a) => [a.url, a.resume?.sourceJobUrl, ...(a.jobUrls || [])]).filter(Boolean));
  const out = { looked_at: jobs.length, current: 0, missing_file: 0, stale: 0, queued: 0, applied: [], edited: [], by_bullet: {} };
  const queue = enqueue ?? (await import("./resume-queue.mjs")).enqueueJob;
  for (const j of jobs) {
    const dir = path.dirname(j.resume.pdf_path);
    const comp = readComposition(dir);
    if (!comp) { out.missing_file++; continue; }
    const stale = staleBullets(comp, bank, { only });
    if (!stale.length) { out.current++; continue; }
    out.stale++;
    for (const s of stale) out.by_bullet[`${s.id} ${s.why}`] = (out.by_bullet[`${s.id} ${s.why}`] || 0) + 1;
    const row = { job_url: j.job_url, company: j.company, title: j.title, bullets: stale.map((s) => `${s.id} ${s.why}`) };
    if (applied.has(j.job_url)) { out.applied.push(row); continue; }
    if (fs.existsSync(path.join(dir, "builder.json"))) { out.edited.push(row); continue; }
    if (apply) {
      const PRIORITY_MANUAL = 500;
      const r = await queue(db, { job_url: j.job_url, company: j.company, title: j.title, location: j.location, priority: PRIORITY_MANUAL, source: "bank-change" }, { force: true });
      if (!r?.skipped) out.queued++;
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const only = arg("--only", null), bank = loadBank();
  if (process.argv.includes("--masters")) {
    const outRoot = process.env.TAILOR_OUT_ROOT?.trim() || path.join(os.homedir(), "Documents", "tailored-resumes");
    const rows = staleFiles(outRoot, bank, { only });
    if (!rows.length) console.log("Every master and pasted resume matches the bank.");
    for (const r of rows) console.log(`${r.kind === "general" ? "Master" : "Pasted"} ${r.name}${r.edited ? " (edited in the builder: check it by hand)" : ""}: ${r.stale.map((s) => `${s.id} ${s.why}`).join(", ")}`);
    const masters = rows.filter((r) => r.kind === "general").map((r) => r.name);
    if (masters.length) console.log(`\nRebuild with scripts/general-resumes.mjs into a scratch TAILOR_OUT_ROOT first, check, then install (rule 7): ${masters.join(", ")}`);
  } else {
    const { withMongo, closeMongo } = await import("./mongo-client.mjs");
    try {
      const r = await withMongo((db) => rebuildStaleJobs(db, { bank, apply: process.argv.includes("--apply"), days: Number(arg("--days", 7)), limit: Number(arg("--limit", 3000)), only }), { appName: "AtriveoStaleBullets" });
      console.log(JSON.stringify({ ...r, applied: r.applied.length, edited: r.edited.length }, null, 2));
      if (r.applied.length) console.log(`\nApplied to, left as sent (${r.applied.length}):\n${r.applied.map((x) => `  ${x.company} | ${x.title} | ${x.bullets.join(", ")}`).join("\n")}`);
      if (r.edited.length) console.log(`\nEdited in the builder, check by hand (${r.edited.length}):\n${r.edited.map((x) => `  ${x.company} | ${x.title} | ${x.bullets.join(", ")}`).join("\n")}`);
      if (!process.argv.includes("--apply") && r.stale) console.log(`\n${r.stale - r.applied.length - r.edited.length} would be re-queued with --apply.`);
    } finally { await closeMongo(); }
  }
}
