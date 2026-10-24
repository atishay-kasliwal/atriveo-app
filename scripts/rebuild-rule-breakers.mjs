// Rebuild the recent resumes that break the page rules (one page, filled to the bottom, two projects with two bullets each),
// so the ones you are about to review follow them. Nothing is deleted: a rebuild writes a new folder and the job points at it.
//   node --env-file=.env scripts/rebuild-rule-breakers.mjs                 report only (changes nothing)
//   node --env-file=.env scripts/rebuild-rule-breakers.mjs --apply         queue the rebuilds (below fresh jobs)
//   options: --days 7   --limit 2000
// Jobs that already have an application are left alone (that resume may be the one you sent). Run it where the resume files
// are (inside the dashboard container on Oracle).
import fs from "node:fs";
import path from "node:path";
import { withMongo, closeMongo } from "./mongo-client.mjs";
import { enqueueJob, PRIORITY_MANUAL } from "./resume-queue.mjs";
import { measurePdf, LINE_PT } from "./ac-page-fill.mjs";

/** What a built resume breaks, from its saved ATS parse (projects) and its PDF (pages, empty space). [] when it is fine. */
export function ruleBreaks({ projects, pages, gapPt }) {
  const out = [];
  if (projects != null && projects.length < 2) out.push(`${projects.length} project${projects.length === 1 ? "" : "s"}`);
  for (const p of projects ?? []) if ((p.bullets ?? []).length < 2) out.push(`${p.name || "a project"}: ${(p.bullets ?? []).length} bullet`);
  if (pages != null && pages > 1) out.push(`${pages} pages`);
  if (gapPt != null && pages === 1 && gapPt >= LINE_PT) out.push(`${Math.floor(gapPt / LINE_PT)} empty line(s)`);
  return out;
}

function inspect(pdfPath) {
  const dir = path.dirname(pdfPath);
  let projects = null;
  try { projects = JSON.parse(fs.readFileSync(path.join(dir, "ats-score.json"), "utf8")).readiness?.parsed?.projects ?? null; } catch { /* not scored */ }
  let pages = null, gapPt = null;
  try { const m = measurePdf(pdfPath); pages = m.pages; gapPt = m.bottom_gap_pt; } catch { /* unreadable */ }
  return { projects, pages, gapPt };
}

export async function rebuildRuleBreakers(db, { apply = false, days = 7, limit = 2000, log = console.log } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600e3);
  const rows = await db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "success" })
    .project({ job_url: 1, company: 1, title: 1, location: 1, "resume.pdf_path": 1 }).sort({ run_at: -1 }).toArray();
  const seen = new Set(), jobs = rows.filter((r) => r.resume?.pdf_path && !seen.has(r.job_url) && seen.add(r.job_url));
  const applied = new Set((await db.collection("applications").find({}, { projection: { url: 1, jobUrls: 1, "resume.sourceJobUrl": 1 } }).toArray())
    .flatMap((a) => [a.url, a.resume?.sourceJobUrl, ...(a.jobUrls || [])]).filter(Boolean));
  const out = { looked_at: jobs.length, applied_skipped: 0, missing_file: 0, fine: 0, breaking: 0, queued: 0, reasons: {} };
  for (const j of jobs.slice(0, limit)) {
    if (applied.has(j.job_url)) { out.applied_skipped++; continue; }
    if (!fs.existsSync(j.resume.pdf_path)) { out.missing_file++; continue; }
    const breaks = ruleBreaks(inspect(j.resume.pdf_path));
    if (!breaks.length) { out.fine++; continue; }
    out.breaking++;
    for (const b of breaks) { const k = b.replace(/^[^:]+: /, "").replace(/\d+/g, "N"); out.reasons[k] = (out.reasons[k] || 0) + 1; }
    if (apply) {
      const r = await enqueueJob(db, { job_url: j.job_url, company: j.company, title: j.title, location: j.location, priority: PRIORITY_MANUAL, source: "page-rules" }, { force: true });
      if (!r.skipped) out.queued++;
    }
  }
  log(`${out.looked_at} resumes from the last ${days} days: ${out.fine} follow the rules, ${out.breaking} break them, ${out.applied_skipped} have an application (left alone), ${out.missing_file} have no file here`);
  for (const [k, v] of Object.entries(out.reasons).sort((a, b) => b[1] - a[1])) log(`  ${String(v).padStart(5)}  ${k}`);
  log(apply ? `queued ${out.queued} rebuilds` : "(report only: nothing was changed; add --apply)");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) || d : d; };
  try { await withMongo((db) => rebuildRuleBreakers(db, { apply: process.argv.includes("--apply"), days: arg("days", 7), limit: arg("limit", 2000) })); }
  finally { await closeMongo(); }
}
