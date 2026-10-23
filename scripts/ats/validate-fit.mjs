// Read-only check of the Fit Score against real jobs: Fit (master resume vs untouched posting) next to the old
// tailored-resume score. It reads jobs and descriptions from Mongo and the saved PDFs; it writes only the report.
//   node --env-file=.env scripts/ats/validate-fit.mjs --n 60 --out report.json
import fs from "node:fs";
import crypto from "node:crypto";
import { withMongo } from "../mongo-client.mjs";
import { analyzeMatchingResume } from "../job-matching-analysis.mjs";
import { scoreFit } from "./fit.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("--n", 60));
const DAYS = Number(arg("--days", 30));
const OUT = arg("--out", "fit-validation.json");
const LOCAL = arg("--local", null); // a tailored-resumes folder: read real runs (meta.json, jd.txt, PDF) from disk, no database
const SAMPLE = arg("--sample", null); // cache of the picked jobs and postings: re-runs then need no database
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");

const trackOf = (title) => {
  const t = String(title || "").toLowerCase();
  if (/forward.?deployed|solutions? engineer|deployment/.test(t)) return "fde";
  if (/data scien|machine learning|\bml\b|\bai\b|applied scien|research/.test(t)) return "ai-ds";
  if (/data analy|analytics|business intelligence|\bbi\b/.test(t)) return "da";
  if (/software|developer|full.?stack|backend|back.end|frontend|front.end|platform|engineer/.test(t)) return "swe";
  return "other";
};
const levelOf = (title) => (/\b(principal|staff|lead|director|architect)\b/i.test(title) ? "staff+" : /\b(senior|sr\.?|iii|iv)\b/i.test(title) ? "senior" : /\b(intern|junior|jr\.?|entry|associate|i)\b/i.test(title) ? "junior" : "mid");

const since = new Date(Date.now() - DAYS * 86_400_000);
function localRuns(root) {
  const out = [];
  for (const day of fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()) {
    for (const run of fs.readdirSync(`${root}/${day}`)) {
      const dir = `${root}/${day}/${run}`;
      try {
        const meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8"));
        const pdf = `${dir}/Atishay Kasliwal.pdf`;
        if (!meta.role || !fs.existsSync(`${dir}/jd.txt`) || !fs.existsSync(pdf)) continue;
        out.push({ job_url: meta.url || dir, company: meta.company, title: meta.role, level: null, score_pct: meta.score_pct ?? null, resume: { pdf_path: pdf }, jdText: fs.readFileSync(`${dir}/jd.txt`, "utf8") });
      } catch { /* not a run folder */ }
    }
  }
  return out;
}
const cached = SAMPLE && fs.existsSync(SAMPLE) ? JSON.parse(fs.readFileSync(SAMPLE, "utf8")) : null;
const pick = (usable) => {
  // Deterministic stratified pick: group by track x level, then deal round-robin in hash order.
  const groups = new Map();
  for (const d of [...usable].sort((a, b) => hash(a.job_url).localeCompare(hash(b.job_url)))) {
    const key = `${trackOf(d.title)}|${levelOf(d.title)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  }
  const picked = [];
  for (let round = 0; picked.length < N; round++) {
    let any = false;
    for (const list of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)) if (list[round] && picked.length < N) { picked.push(list[round]); any = true; }
    if (!any) break;
  }
  return picked;
};
const { docs, jds } = LOCAL ? (() => { const d = pick(localRuns(LOCAL)); return { docs: d, jds: new Map(d.map((x) => [x.job_url, x.jdText])) }; })() : cached ? { docs: cached.docs, jds: new Map(cached.jds) } : await withMongo(async (db) => {
  const docs = await db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "success", "resume.pdf_path": { $type: "string" } },
    { projection: { _id: 0, job_url: 1, company: 1, title: 1, level: 1, score_pct: 1, "resume.pdf_path": 1 } }).sort({ run_at: -1 }).limit(900).toArray();
  const usable = docs.filter((d) => fs.existsSync(d.resume.pdf_path));
  // Deterministic stratified pick: group by track x level, then deal round-robin in hash order.
  const groups = new Map();
  for (const d of usable.sort((a, b) => hash(a.job_url).localeCompare(hash(b.job_url)))) {
    const key = `${trackOf(d.title)}|${levelOf(d.title)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(d);
  }
  const picked = [];
  for (let round = 0; picked.length < N; round++) {
    let any = false;
    for (const list of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)) if (list[round] && picked.length < N) { picked.push(list[round]); any = true; }
    if (!any) break;
  }
  const rows = await db.collection("descriptions").find({ job_url: { $in: picked.map((d) => d.job_url) } }, { projection: { _id: 0, job_url: 1, description: 1 } }).toArray();
  return { docs: picked, jds: new Map(rows.map((r) => [r.job_url, r.description])) };
});

if (SAMPLE && !cached) fs.writeFileSync(SAMPLE, JSON.stringify({ docs, jds: [...jds] }));
const rows = [];
for (const d of docs) {
  const jd = jds.get(d.job_url);
  if (!jd) continue;
  const a = scoreFit(jd, { title: d.title }), b = scoreFit(jd, { title: d.title });
  const old = await analyzeMatchingResume(d.resume.pdf_path, jd, d.title);
  const again = scoreFit(jd, { title: d.title });
  rows.push({
    url: d.job_url, company: d.company, title: d.title, level: d.level, track: trackOf(d.title), levelBucket: levelOf(d.title), pipeline_score: d.score_pct ?? null,
    old: old && { score: old.score, required: old.required, preferred: old.preferred, chips: old.keywords.length, chipsMatched: old.keywords.filter((k) => k.matched).length, incomplete: old.incomplete },
    fit: a.score == null ? { score: null, note: a.note } : {
      score: a.score, confidence: a.confidence, ledger: { required: a.ledger.required, preferred: a.ledger.preferred, total: a.ledger.total, matched: a.ledger.matched, partial: a.ledger.partial, missing: a.ledger.missing },
      knockouts: a.knockouts, not_applicable: a.not_applicable.map((n) => n.key), unknown: a.unknown_requirements.length,
      lost: a.categories.flatMap((c) => c.items.filter((i) => i.lost > 0).map((i) => ({ category: c.key, requirement: i.label, source: i.source || null, lost: i.lost }))).sort((x, y) => y.lost - x.lost).slice(0, 4),
      accountingOk: Math.round((a.accounting.earned + a.accounting.lost) * 10) === 1000 && a.categories.every((c) => Math.round((c.earned + c.lost) * 10) === Math.round(c.max * 10)),
    },
    deterministic: JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(again),
    jdChars: jd.length,
  });
}
fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), n: rows.length, rows }, null, 2));
console.log(`wrote ${rows.length} jobs to ${OUT}`);
process.exit(0);
