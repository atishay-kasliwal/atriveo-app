import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resumeMatchOf, trackOf } from "./applications-analytics.mjs";

// Job Matching: one job at a time, its tailored resume already built. Nothing here builds a resume or applies anywhere.
// The queue is the jobs whose resume is done and that you haven't decided on; a decision is one job_swipes row
// (left = Not apply, right = Apply, later = Save for later), the same collection Discard and Mark applied write.

const run = promisify(execFile);
const IMAGE = "resume-page.png";
const SOURCE = "job-matching";
const DAYS = 7;
const JD_CAP = 12_000;

const isoOf = (v) => (v ? new Date(v).toISOString() : null);
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
  const full = decode(text).replace(/\r/g, "").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t\u00a0]{3,}/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, JD_CAP);
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
  const kind = /\bintern(ship)?\b/i.test(full) ? "Internship" : /\bcontract(or)?\b|\bc2h\b/i.test(full) ? "Contract" : /\bfull[- ]time\b/i.test(full) ? "Full-time" : null;
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
export async function matchingQueue(db, { limit = 8, offset = 0, now = new Date() } = {}) {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const [docs, applied, swipes] = await Promise.all([
    db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "success", "resume.pdf_path": { $type: "string" } },
      { projection: { _id: 0, job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, level: 1, score_pct: 1, date_posted: 1, run_at: 1, apply_type: 1, site: 1, "resume.pdf_path": 1 } })
      .sort({ run_at: -1 }).limit(1500).toArray(),
    db.collection("applications").distinct("jobUrls"),
    db.collection("job_swipes").find({}, { projection: { _id: 0, job_url: 1, direction: 1, swiped_at: 1 } }).toArray(),
  ]);
  const taken = new Set(applied);
  const later = new Map();
  for (const s of swipes) {
    if (s.direction === "later") later.set(s.job_url, s.swiped_at ?? "");
    else taken.add(s.job_url);
  }
  const byUrl = new Map();
  for (const d of docs) {
    if (taken.has(d.job_url) || d.apply_type === "closed" || byUrl.has(d.job_url)) continue;
    byUrl.set(d.job_url, d);
  }
  const ranked = [...byUrl.values()].sort((a, b) => {
    const la = later.has(a.job_url), lb = later.has(b.job_url);
    if (la !== lb) return la ? 1 : -1;
    return (b.score_pct ?? 0) - (a.score_pct ?? 0) || String(b.run_at).localeCompare(String(a.run_at));
  });
  // A page is the rows with a resume file and a page image; others are skipped, not shown half-ready.
  const rows = [];
  let skipped = 0;
  for (const d of ranked.slice(offset)) {
    if (rows.length >= limit) break;
    const pdf = d.resume.pdf_path;
    if (!fs.existsSync(pdf) || !(await ensureResumeImage(pdf))) { skipped++; continue; }
    rows.push(d);
  }
  const urls = rows.map((d) => d.job_url);
  const jds = urls.length ? await db.collection("descriptions").aggregate([
    { $match: { job_url: { $in: urls } } }, { $project: { _id: 0, job_url: 1, description: { $substrCP: ["$description", 0, JD_CAP] } } },
  ]).toArray() : [];
  const jdOf = new Map(jds.map((j) => [j.job_url, j.description]));
  const jobs = rows.map((d) => {
    const jd = shapeJd(jdOf.get(d.job_url) ?? "");
    return {
      id: d.job_url, company: decode(d.company), title: decode(d.title), location: d.location ? decode(d.location) : null, level: d.level ?? null,
      score: typeof d.score_pct === "number" ? d.score_pct : null, postedAt: isoOf(d.date_posted), foundAt: isoOf(d.run_at),
      applyType: d.apply_type ?? null, track: trackOf(d.title),
      // The company's own form when known, else the posting you were shown.
      applyUrl: d.job_url_direct || d.job_url, postingUrl: d.job_url,
      resumePath: d.resume.pdf_path, resumeMatch: resumeMatchOf(d.resume.pdf_path),
      saved: later.has(d.job_url), jd,
    };
  });
  return { ok: true, generatedAt: now.toISOString(), total: ranked.length - skipped, jobs };
}

/** Not apply (left), Apply (right: you chose to; nothing is submitted), Save for later (later), or undo your last choice on it. */
export async function recordDecision(db, { jobUrl, decision, now = new Date() }) {
  if (!/^https:\/\//.test(String(jobUrl || ""))) throw new Error("A job URL is required");
  const swipes = db.collection("job_swipes");
  if (decision === "undo") {
    // Only this page's own rows; a Discard or Mark applied made elsewhere stays.
    const r = await swipes.deleteOne({ job_url: jobUrl, source: SOURCE });
    return { ok: true, undone: r.deletedCount > 0 };
  }
  const direction = { skip: "left", apply: "right", later: "later" }[decision];
  if (!direction) throw new Error("Unknown decision");
  await swipes.updateOne({ job_url: jobUrl },
    { $set: { job_url: jobUrl, direction, swiped_at: now.toISOString(), date: now.toISOString().slice(0, 10), source: SOURCE } }, { upsert: true });
  return { ok: true };
}
