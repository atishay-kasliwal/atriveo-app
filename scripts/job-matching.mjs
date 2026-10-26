import {matchingSource,matchingTimestamp,filterMatchingJobs,confirmedApplicationCount} from './matching-filters.mjs';
import fs from "node:fs";
import { resumeRevision } from "./application-kit.mjs";
import { queueKey, companyKey, companySummary, similarJobs, matchingEvents, preferenceBoost, recordMatchingEvent, forgetMatchingDecision } from "./matching-workspace.mjs";
import { analyzeMatchingResume } from "./job-matching-analysis.mjs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resumeMatchOf, resumeReadyOf, readyBrief, trackOf } from "./applications-analytics.mjs";
import { publishResume, storeFromEnv } from "./resume-store.mjs";
import { ensureFit } from "./fit-store.mjs";

// Job Matching: one job at a time, its tailored resume already built. Nothing here builds a resume or applies anywhere.
// The queue is the jobs whose resume is done and that you haven't decided on; a decision is one job_swipes row
// (left = Not apply, right = Apply, later = Save for later), the same collection Discard and Mark applied write.

const run = promisify(execFile);
const IMAGE = "resume-page.png";
const SOURCE = "job-matching";
const HIDDEN = "matching_hidden_companies";
const DAYS = 30;
const FIT_PER_REQUEST = 40;
// A Fit costs ~200 ms of CPU, so a request computes missing ones for at most this long; the rest are computed after it answers.
const FIT_BUDGET_MS = 500;
// The jobs, applications and decisions behind the queue are read once and reused this long (a decision here clears it).
const BASE_MS = 30_000;
// For ranking, similar jobs and the company list only these parts of each Fit are needed; a shown job gets its whole Fit.
const RANK_PROJECTION = { _id: 0, job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, level: 1, score_pct: 1, date_posted: 1, run_at: 1, apply_type: 1, site: 1,
  "fit.score": 1, "fit.confidence": 1, "fit.knockouts.verdict": 1, "fit.ledger.skills.alternatives": 1,
  "fit.config_hash": 1, "fit.master_hash": 1, "fit.candidate_hash": 1, "fit.shape": 1, "fit.as_of": 1,
  "resume.pdf_path": 1, "resume.object": 1 };

const isoOf = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bull: "•" };
const decode = (s) => String(s ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === "x" ? 2 : 1), e[1].toLowerCase() === "x" ? 16 : 10) || 32) : (ENT[e.toLowerCase()] ?? m));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The first page of a tailored resume as a PNG beside the PDF, made once (poppler's pdftoppm). Null when it can't be made. */
export async function ensureResumeImage(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;
  const out = path.join(path.dirname(pdfPath), IMAGE);
  try {
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(pdfPath).mtimeMs) return out;
    const base = out.slice(0, -4);
    await run("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", pdfPath, base], { timeout: 20_000 });
    return fs.existsSync(out) ? out : null;
  } catch { return null; }
}

/** The PNG for a resume PDF path (never outside the resume folder: the caller checks the PDF's root first). */
export const resumeImagePath = (pdfPath) => path.join(path.dirname(pdfPath), IMAGE);

const SECTION = [
  ["nice", /^(preferred|nice[- ]to[- ]have|bonus|plus(es)?|desired|extra credit|a plus)\b/i],
  ["requirements", /^(required|requirements?|qualifications?|minimum|basic qualifications|what you.?ll need|what we.?re looking for|must[- ]have|you have|you bring|who you are|about you|skills|experience)\b/i],
  ["duties", /^(responsibilities|what you.?ll do|what you will do|the role|your role|in this role|duties|day[- ]to[- ]day|you will|the work|key responsibilities)\b/i],
  ["about", /^(role summary|about (the )?(role|job|position|team|us|company)|overview|summary|who we are|job description|position summary|the opportunity)\b/i],
];
const BULLET = /^\s*(?:[-*•·▪◦–]|\d+[.)])\s+/;

function bucketOf(line) {
  const t = line.replace(/[:：*#_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 70 || BULLET.test(line) || /[.!?]$/.test(t)) return null;
  for (const [name, re] of SECTION) if (re.test(t)) return name;
  return null;
}

/** A job description cut into what a decision needs: facts, the must-haves, the duties, flags. Plain text in, small JSON out. */
export function shapeJd(text) {
  // Many saved descriptions are flattened: sections and bullets are separated by runs of spaces, not newlines.
  const full = decode(text).replace(/\r/g, "").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t\u00a0]{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const lines = full.split("\n");
  const sections = { about: [], requirements: [], nice: [], duties: [] };
  let cur = "about", sawHeading = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = bucketOf(line);
    if (b) { cur = b; sawHeading = true; continue; }
    const item = line.replace(BULLET, "").trim();
    if (item.length < 12) continue;
    sections[cur].push(clip(item, 240));
  }
  if (!sawHeading) sections.about = [clip(full.replace(/\s+/g, " "), 480)];
  const salary = (full.match(/\$\s?\d{2,3}(?:,\d{3})?(?:\.\d+)?\s?[kK]?\s?(?:-|–|—|to)\s?\$?\s?\d{2,3}(?:,\d{3})?(?:\.\d+)?\s?[kK]?(?:\s?(?:\/|per)\s?(?:yr|year|hour|hr))?/) ?? [])[0] ?? null;
  const work = /\bhybrid\b/i.test(full) ? "Hybrid" : /\bremote\b/i.test(full) ? "Remote" : /\bon[- ]?site\b|\bin[- ]office\b/i.test(full) ? "On-site" : null;
  const kind = /\bfull[- ]time\b/i.test(full) ? "Full-time" : /\bpart[- ]time\b/i.test(full) ? "Part-time" : /(?:^|\n)\s*internship\s*(?:$|\n)|\b(?:paid|summer) internship\b|\binternship (?:role|position|opportunity)\b/i.test(full) ? "Internship" : /\b(?:contract(?:or)? (?:role|position|opportunity)|c2h)\b|(?:job|employment) type\s*:\s*contract/i.test(full) ? "Contract" : null;
  const flags = [];
  if (/(?:not|unable to|cannot|can.?t|won.?t|will not)\s+(?:\w+\s+){0,3}sponsor|without (?:visa )?sponsorship|no (?:visa )?sponsorship/i.test(full)) flags.push("No sponsorship");
  if (/\b(?:u\.?s\.? citizen(?:ship)?|security clearance|secret clearance|ts\/sci)\b/i.test(full)) flags.push("Citizenship or clearance");
  return {
    about: clip(sections.about.join(" "), 480),
    requirements: sections.requirements.slice(0, 8),
    nice: sections.nice.slice(0, 6),
    duties: sections.duties.slice(0, 8),
    salary, work, kind, flags,
    full,
    structured: sawHeading,
  };
}

/**
 * The next jobs to decide on: resume done (PDF and page image on disk), no application, no decision yet (Saved for
 * later comes back after the rest). Best match first. Only what the page shows crosses the wire.
 */
const published = new Set();
const CONF = { high: 2, medium: 1, low: 0 };
/**
 * The queue's order: saved-for-later last; then jobs with a hard mismatch (blocked); then by Fit; then how sure Fit is;
 * then the pipeline's score and the newest. Jobs without a Fit yet sort after those that have one.
 */
export function rankForMatching(docs, later = new Map(), sort = 'fit') {
  if(sort==='latest')return [...docs].sort((a,b)=>matchingTimestamp(b)-matchingTimestamp(a)||a.job_url.localeCompare(b.job_url));
  return [...docs].sort((a, b) => {
    const la = later.has(a.job_url), lb = later.has(b.job_url);
    if (la !== lb) return la ? 1 : -1;
    const ba = a.fit?.knockouts?.verdict === "blocked", bb = b.fit?.knockouts?.verdict === "blocked";
    if (ba !== bb) return ba ? 1 : -1;
    return (b.fit?.score ?? -1) - (a.fit?.score ?? -1) || (CONF[b.fit?.confidence] ?? -1) - (CONF[a.fit?.confidence] ?? -1)
      || (b.score_pct ?? 0) - (a.score_pct ?? 0) || String(b.run_at).localeCompare(String(a.run_at));
  });
}

let base = null;
/** Forget the cached jobs and decisions (after a decision, or when new Fits were saved). */
export function invalidateMatchingQueue() { base = null; }
async function loadBase(db, now) {
  const at = now.getTime();
  if (base && base.db === db && at >= base.at && at - base.at < BASE_MS) return base;
  const since = new Date(at - DAYS * 86_400_000);
  const filter = { run_at: { $gte: since }, "resume.status": "success", "resume.pdf_path": { $type: "string" } };
  const [docs, applied, swipes, confirmed, hiddenRows] = await Promise.all([
    db.collection("jobs").find(filter, { projection: RANK_PROJECTION })
      .sort({ run_at: -1 }).limit(6000).toArray(),
    db.collection("applications").distinct("jobUrls"),
    db.collection("job_swipes").find({}, { projection: { _id: 0, job_url: 1, direction: 1, swiped_at: 1, applied_at: 1, source: 1 } }).toArray(),
    db.collection("applications").find({status:"APPLIED"},{projection:{_id:1,jobUrls:1,"lifecycle.appliedAt":1}}).toArray(),
    db.collection(HIDDEN).find({}, { projection: { _id: 0, key: 1 } }).toArray().catch(() => []),
  ]);
  base = { db, at, filter, docs, applied, swipes, confirmed, hidden: new Set(hiddenRows.map((h) => h.key)) };
  return base;
}

// Missing or stale Fits left over by a request are computed here, one at a time (~200 ms of CPU each), and never while a
// queue request is being answered, so the page is not kept waiting behind them.
let filling = null;
let answering = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function fillFitsLater(db, docs) {
  if (filling || !docs.length) return;
  filling = (async () => {
    let saved = 0;
    for (let i = 0; i < docs.length; i += 1) {
      await new Promise((r) => setImmediate(r));
      while (answering > 0) await pause(50);
      const batch = docs.slice(i, i + 1);
      const got = await ensureFit(db, batch, { max: batch.length });
      const fresh = batch.filter((d) => got.has(d.job_url) && got.get(d.job_url) !== d.fit).length;
      saved += fresh;
      if (fresh && saved % 10 < fresh && base?.db === db) base = null; // let the queue pick new Fits up every ~10
    }
    if (saved && base?.db === db) base = null;
  })().catch(() => {}).finally(() => { filling = null; });
}
/** Resolves when the background Fit fill (if any) is done. For tests and scripts. */
export const fitsFilled = () => filling ?? Promise.resolve();

export async function matchingQueue(db, opts = {}) {
  answering++;
  try { return await answerQueue(db, opts); } finally { answering--; }
}

async function answerQueue(db, { limit = 8, offset = 0, now = new Date(), company = null, jobUrl = null, exclude = [], learn = true, period = '7d', sources = [], role = '', query = '', timeZone = 'America/New_York', sort = 'latest' } = {}) {
  const { docs: cached, applied, swipes, filter, confirmed, hidden } = await loadBase(db, now);
  // Copies, so this request's Fits never leak into the cached rows.
  const docs = cached.map((d) => ({ ...d }));
  const taken = new Set(applied);
  const later = new Map();
  for (const s of swipes) {
    if (s.direction === "later") later.set(s.job_url, s.swiped_at ?? "");
    else taken.add(s.job_url);
  }
  const byUrl = new Map();
  for (const d of docs) {
    if (taken.has(d.job_url) || d.apply_type === "closed" || byUrl.has(d.job_url) || hidden.has(companyKey(d.company))) continue;
    byUrl.set(d.job_url, d);
  }
  // Fit (master resume against the posting) is kept on each job; up to FIT_PER_REQUEST missing or stale ones are computed
  // here within FIT_BUDGET_MS, and the rest right after this answer (then the queue re-reads them).
  const live=filterMatchingJobs([...byUrl.values()].map(d=>({...d,track:trackOf(d.title)})),{period,sources,role,query,timeZone,now});
  const fits = await ensureFit(db, live, { max: FIT_PER_REQUEST, budgetMs: filling ? 0 : FIT_BUDGET_MS });
  const stored = new Map(live.map((d) => [d.job_url, d.fit]));
  for (const d of live) d.fit = fits.get(d.job_url) ?? null;
  if (live.some((d) => d.fit && d.fit !== stored.get(d.job_url))) invalidateMatchingQueue(); // new Fits were saved: re-read next time
  fillFitsLater(db, live.filter((d) => !fits.has(d.job_url)).map((d) => ({ ...d, fit: stored.get(d.job_url) })));
  const events = learn ? await matchingEvents(db).catch(() => []) : [];
  const allRanked = rankForMatching(live, later, sort);
  // A bounded preference signal can only reorder nearby scores; it never removes a job.
  if (sort==='fit' && learn && events.length) {
    const boosts=new Map(allRanked.map(d=>[d.job_url,preferenceBoost({...d,track:trackOf(d.title)},events)]));
    allRanked.sort((a,b)=>Number(later.has(a.job_url))-Number(later.has(b.job_url)) || Number(a.fit?.knockouts?.verdict==='blocked')-Number(b.fit?.knockouts?.verdict==='blocked') || ((b.fit?.score??-1)+(boosts.get(b.job_url)||0))-((a.fit?.score??-1)+(boosts.get(a.job_url)||0)));
  }
  const companies = companySummary(allRanked, later, now);
  const excluded = new Set(exclude.slice(0,512));
  const scoped = company ? allRanked.filter(d=>companyKey(d.company)===companyKey(company)) : allRanked;
  const ranked = scoped.filter(d=>!excluded.has(queueKey(d.job_url)));
  if (jobUrl) { const i=ranked.findIndex(d=>d.job_url===jobUrl); if(i>0)ranked.unshift(...ranked.splice(i,1)); }
  const stats = { appliedToday: confirmedApplicationCount(confirmed,swipes,{now,timeZone}), applied: confirmedApplicationCount(confirmed,swipes), opened: 0, skipped: 0, saved: 0, remaining: allRanked.length };
  const known = new Set(docs.map(d=>d.job_url));
  for(const swipe of swipes) if(known.has(swipe.job_url)&&swipe.source==='job-matching'){if(swipe.direction==='right')stats.opened++;else if(swipe.direction==='left')stats.skipped++;else if(swipe.direction==='later')stats.saved++;}
  // A page is the rows with a resume file and a page image; others are skipped, not shown half-ready. A first view of a job
  // makes its page image and (with R2 set up) checks it is stored: that is a few network round trips and a pdftoppm each, so a
  // page's candidates are prepared together, then taken in ranked order, instead of one after another (7-11 s for 8 jobs).
  const rows = [];
  let skipped = 0;
  const candidates = ranked.slice(offset);
  const ready = new Map();
  for (let i = 0; i < candidates.length && rows.length < limit; i += limit) {
    const chunk = candidates.slice(i, i + limit);
    await Promise.all(chunk.map(async (d) => { const pdf = d.resume.pdf_path; ready.set(d, fs.existsSync(pdf) && Boolean(await ensureResumeImage(pdf))); }));
    for (const d of chunk) {
      if (rows.length >= limit) break;
      if (ready.get(d)) rows.push(d); else skipped++;
    }
  }
  // With R2 set up, the resume and its page image are kept there too. Once stored the job carries the reference
  // (resume.object.image_key), so this runs once per file ever, not once per server start.
  if (storeFromEnv()) {
    await Promise.all(rows.map(async (d) => {
      const pdf = d.resume.pdf_path;
      if (published.has(pdf) || d.resume.object?.image_key) return;
      const r = await publishResume(pdf);
      if (!r.object) return;
      d.resume.object = r.object; published.add(pdf);
      await db.collection("jobs").updateMany?.({ job_url: d.job_url, "resume.pdf_path": pdf }, { $set: { "resume.object": r.object, "resume.object_error": null } }).catch(() => {});
    }));
  }
  const urls = rows.map((d) => d.job_url);
  // Ranking read only part of each saved Fit; a shown job gets the whole one (a Fit computed in this request is whole already).
  const partial = rows.filter((d) => d.fit && d.fit === stored.get(d.job_url)).map((d) => d.job_url);
  const [jds, wholeFits] = urls.length ? await Promise.all([
    db.collection("descriptions").aggregate([
      { $match: { job_url: { $in: urls } } }, { $project: { _id: 0, job_url: 1, description: 1 } },
    ]).toArray(),
    partial.length ? db.collection("jobs").find({ ...filter, job_url: { $in: partial } }, { projection: { _id: 0, job_url: 1, run_at: 1, fit: 1 } }).sort({ run_at: -1 }).toArray() : [],
  ]) : [[], []];
  const whole = new Map();
  for (const j of wholeFits) if (!whole.has(j.job_url) && j.fit) whole.set(j.job_url, j.fit);
  for (const d of rows) if (partial.includes(d.job_url) && whole.has(d.job_url)) d.fit = whole.get(d.job_url);
  const jdOf = new Map(jds.map((j) => [j.job_url, j.description]));
  const jobs = await Promise.all(rows.map(async (d) => {
    const jd = shapeJd(jdOf.get(d.job_url) ?? "");
    return {
      id: d.job_url, key: queueKey(d.job_url), position: scoped.findIndex(x=>x.job_url===d.job_url)+1, similar: similarJobs(d, allRanked), company: decode(d.company), title: decode(d.title), location: d.location ? decode(d.location) : null, level: d.level ?? null,
      score: typeof d.score_pct === "number" ? d.score_pct : null, postedAt: isoOf(d.date_posted), foundAt: isoOf(d.run_at),
      source: matchingSource(d), applyType: d.apply_type ?? null, track: trackOf(d.title),
      // The company's own form when known, else the posting you were shown.
      applyUrl: d.job_url_direct || d.job_url, postingUrl: d.job_url,
      resumePath: d.resume.pdf_path, resumeSha256: resumeRevision(d.resume), resumeObject: d.resume.object ? { sha256: d.resume.object.sha256, hasImage: Boolean(d.resume.object.image_key) } : null, resumeMatch: resumeMatchOf(d.resume.pdf_path, { refresh: true }), ready: readyBrief(resumeReadyOf(d.resume.pdf_path, d.fit)), fit: wireFit(d.fit),
      saved: later.has(d.job_url), jd: wireJd(jd), ats: await analyzeMatchingResume(d.resume.pdf_path, jd.full, d.fit),
    };
  }));
  return { ok: true, generatedAt: now.toISOString(), total: scoped.length - skipped, companies, stats, windowDays: DAYS, sort, preference: { active: sort==='fit' && learn && events.filter(e=>["apply_opened","saved","not_apply"].includes(e.kind)).length>=5, limit: 2 }, jobs };
}

// What the page shows of a description and a Fit; the section lists, hashes and lost points stay on the server.
const wireJd = ({ full, salary, work, kind, flags }) => ({ full, salary, work, kind, flags });
const wireFit = (fit) => {
  if (!fit) return fit;
  const { config_hash, master_hash, candidate_hash, shape, as_of, jd_chars, applicable_weight, lost, ...shown } = fit;
  return shown;
};

/** Not apply (left), Apply (right: you chose to; nothing is submitted), Save for later (later), or undo your last choice on it. */
export async function recordDecision(db, { jobUrl, decision, now = new Date() }) {
  if (!/^https:\/\//.test(String(jobUrl || ""))) throw new Error("A job URL is required");
  const swipes = db.collection("job_swipes");
  if (decision === "undo") {
    // Only this page's own rows; a Discard or Mark applied made elsewhere stays.
    const r = await swipes.deleteOne({ job_url: jobUrl, source: SOURCE });
    if(r.deletedCount){invalidateMatchingQueue();await forgetMatchingDecision(db,jobUrl).catch(()=>{});}
    return { ok: true, undone: r.deletedCount > 0 };
  }
  const direction = { skip: "left", apply: "right", later: "later" }[decision];
  if (!direction) throw new Error("Unknown decision");
  await swipes.updateOne({ job_url: jobUrl },
    { $set: { job_url: jobUrl, direction, swiped_at: now.toISOString(), date: now.toISOString().slice(0, 10), source: SOURCE } }, { upsert: true });
  invalidateMatchingQueue();
  await recordMatchingEvent(db, {jobUrl, kind: {apply:'apply_opened',skip:'not_apply',later:'saved'}[decision], now}).catch(()=>{});
  return { ok: true };
}

/** Companies the user is not interested in, newest first. Their postings stay out of the queue, rail and counts. */
export async function hiddenCompanies(db) {
  const rows = await db.collection(HIDDEN).find({}, { projection: { _id: 0, key: 1, name: 1, hidden_at: 1 } }).toArray();
  return rows.map((r) => ({ key: r.key, name: r.name || r.key, hiddenAt: r.hidden_at ?? null })).sort((a, b) => String(b.hiddenAt).localeCompare(String(a.hiddenAt)));
}

/** Hide a company (Not interested) or bring it back. Returns the whole list. */
export async function setCompanyHidden(db, { company, hidden = true, now = new Date() }) {
  const name = String(company ?? "").trim().slice(0, 200);
  if (!name) throw new Error("A company is required");
  const key = companyKey(name);
  if (hidden) await db.collection(HIDDEN).updateOne({ key }, { $set: { key, name, hidden_at: now.toISOString() } }, { upsert: true });
  else await db.collection(HIDDEN).deleteOne({ key });
  invalidateMatchingQueue();
  return { ok: true, hidden: await hiddenCompanies(db) };
}

/**
 * The last scrape runs, newest first. The job pipeline writes one `sessions` row per pipeline per run (same session_id,
 * job_count = jobs it kept); a run is those rows together. The staffing scraper keeps its own `staffing_runs`.
 */
export async function recentScrapeRuns(db, { limit = 5 } = {}) {
  const [sessions, staffing] = await Promise.all([
    db.collection("sessions").find({ archived: { $ne: true } }, { projection: { _id: 0, session_id: 1, run_at: 1, job_count: 1 } }).sort({ run_at: -1 }).limit(300).toArray().catch(() => []),
    db.collection("staffing_runs").find({}, { projection: { _id: 0, started_at: 1, finished_at: 1, new_jobs: 1, status: 1 } }).sort({ started_at: -1 }).limit(limit).toArray().catch(() => []),
  ]);
  // One scrape cycle runs several pipeline stages, each with its own session row seconds apart: sessions that finish within
  // RUN_GAP_MS of each other are one run, with their job counts added.
  const RUN_GAP_MS = 20 * 60_000;
  const runs = [];
  let open = null;
  for (const s of sessions.map((x) => ({ at: isoOf(x.run_at), n: Number(x.job_count) || 0 })).filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at))) {
    if (open && Date.parse(open.earliest) - Date.parse(s.at) <= RUN_GAP_MS) { open.added += s.n; open.earliest = s.at; continue; }
    open = { kind: "Job search", finishedAt: s.at, earliest: s.at, added: s.n, status: "ok" };
    runs.push(open);
  }
  for (const r of runs) delete r.earliest;
  for (const r of staffing) {
    const at = isoOf(r.finished_at);
    if (at) runs.push({ kind: "Staffing", finishedAt: at, added: Number.isFinite(r.new_jobs) ? r.new_jobs : null, status: r.status === "partial" ? "partial" : "ok" });
  }
  return { ok: true, runs: runs.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, limit) };
}
