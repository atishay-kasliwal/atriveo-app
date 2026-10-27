import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appliedItems, APPLIED_TZ } from "./applied-core.mjs";
import { trackOf } from "./applications-analytics.mjs";
import { matchingSource } from "./matching-filters.mjs";
import { companyKey as matchingCompanyKey } from "./matching-workspace.mjs";

// Jobs whose posting text could not be read, so no tailored resume was built ("JD not found or too short"). They are not lost: you
// can apply to them with your general resume for the role (one per track), from a plain table you can sort, filter and skip through.

const NEEDS_TEXT = /JD not found|too short/i;
export const noTextKey = (url) => crypto.createHash("sha1").update(String(url)).digest("hex").slice(0, 12);
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The general resume for each track that is built and on disk: { 'software-engineer': { label, path } }. */
export function generalResumes(outRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(outRoot, "general", "manifest.json"), "utf8"));
    const out = {};
    for (const [track, r] of Object.entries(manifest.resumes ?? {})) {
      // The manifest is written on the Mac, so its paths name the Mac's folder; the same PDF sits under this server's general folder.
      const root = path.resolve(outRoot, "general"), raw = String(r.path || "");
      const tail = raw.includes("/general/") ? raw.slice(raw.lastIndexOf("/general/") + "/general/".length) : null;
      const file = tail ? path.resolve(root, tail) : path.resolve(raw);
      if (file.startsWith(root + path.sep) && path.extname(file).toLowerCase() === ".pdf" && fs.existsSync(file)) out[track] = { label: r.label || r.title || track, title: r.title || track, path: file };
    }
    return out;
  } catch { return {}; }
}

export function buildNoTextRows({ jobs, descriptions, applied, swipes, hidden, general }) {
  const withText = new Set(descriptions.filter((d) => d.len >= 200).map((d) => d.job_url));
  const taken = new Set(applied);
  for (const s of swipes) if (["applied", "left", "skip"].includes(s.direction)) taken.add(s.job_url);
  const seen = new Set(), rows = [];
  for (const j of [...jobs].sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)))) {
    if (seen.has(j.job_url)) continue;
    seen.add(j.job_url);
    if (taken.has(j.job_url) || withText.has(j.job_url) || j.apply_type === "closed" || hidden.has(matchingCompanyKey(j.company))) continue;
    const track = trackOf(j.title);
    rows.push({ key: noTextKey(j.job_url), jobUrl: j.job_url, applyUrl: j.job_url_direct || j.job_url, company: String(j.company || ""), title: String(j.title || ""), location: j.location ?? null,
      source: matchingSource(j) || null, track, postedAt: iso(j.date_posted), foundAt: iso(j.run_at), resume: track && general[track] ? { track, label: general[track].label } : null });
  }
  return rows;
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APPLIED_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const nyDay = (ms) => dayFmt.format(ms);
/** The calendar day a row belongs to, the one its "Found" column shows: a date-only posting date is that day; a timestamp is its New York day. */
export function rowDay(r) {
  const at = r.postedAt || r.foundAt;
  if (!at) return null;
  return at.endsWith("T00:00:00.000Z") ? at.slice(0, 10) : nyDay(Date.parse(at));
}
export const RANGES = ["today", "yesterday", "7d", "30d"];
/** Does a row's day fall in the range? "" (or unknown) means any day. */
export function inRange(day, range, now = Date.now()) {
  if (!RANGES.includes(range)) return true;
  if (!day) return false;
  const today = nyDay(now), back = (n) => nyDay(now - n * 86400000);
  if (range === "today") return day === today;
  if (range === "yesterday") return day === back(1);
  const first = back(range === "7d" ? 6 : 29);
  return day >= first && day <= today;
}

const SORTS = {
  new: (a, b) => String(b.postedAt || b.foundAt).localeCompare(String(a.postedAt || a.foundAt)),
  company: (a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title) || a.company.localeCompare(b.company),
};

export async function noTextJobs(db, { q = "", track = "", source = "", range = "", sort = "new", skip = 0, limit = 50, outRoot, now = Date.now() } = {}) {
  const [jobs, applications, swipes, hiddenRows] = await Promise.all([
    db.collection("jobs").find({ "resume.status": "failed", "resume.error": { $regex: "JD not found|too short", $options: "i" } }, { projection: { _id: 0, job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, site: 1, date_posted: 1, run_at: 1, apply_type: 1 } }).toArray(),
    db.collection("applications").find({ status: "APPLIED" }, { projection: { _id: 1, jobUrls: 1, "lifecycle.appliedAt": 1, "submission.submittedAt": 1 } }).toArray(),
    db.collection("job_swipes").find({}, { projection: { _id: 0, job_url: 1, direction: 1, applied_at: 1, swiped_at: 1 } }).toArray(),
    db.collection("matching_hidden_companies").find({}, { projection: { _id: 0, key: 1 } }).toArray(),
  ]);
  const urls = [...new Set(jobs.map((j) => j.job_url))];
  const descriptions = urls.length ? await db.collection("descriptions").aggregate([
    { $match: { job_url: { $in: urls } } }, { $project: { _id: 0, job_url: 1, len: { $strLenCP: { $ifNull: ["$description", ""] } } } },
  ]).toArray() : [];
  const general = generalResumes(outRoot);
  const applied = appliedItems(applications, swipes).map((i) => i.jobUrl).filter(Boolean);
  const every = buildNoTextRows({ jobs, descriptions, applied, swipes, hidden: new Set(hiddenRows.map((h) => h.key)), general });
  const rangeCounts = { all: every.length };
  for (const r of RANGES) rangeCounts[r] = every.filter((x) => inRange(rowDay(x), r, now)).length;
  const all = every.filter((x) => inRange(rowDay(x), range, now));
  const text = String(q || "").trim().toLowerCase().slice(0, 100);
  const searched = text ? all.filter((r) => `${r.company} ${r.title} ${r.location || ""}`.toLowerCase().includes(text)) : all;
  const byTrack = {}, bySource = {};
  for (const r of searched) { byTrack[r.track || "other"] = (byTrack[r.track || "other"] || 0) + 1; bySource[r.source || "other"] = (bySource[r.source || "other"] || 0) + 1; }
  const picked = searched.filter((r) => (!track || (track === "other" ? !r.track : r.track === track)) && (!source || (source === "other" ? !r.source : r.source === source))).sort(SORTS[sort] ?? SORTS.new);
  return { ok: true, total: picked.length, allTotal: all.length, counts: { byTrack, bySource, byRange: rangeCounts }, generalReady: Object.fromEntries(Object.entries(general).map(([t, g]) => [t, g.label])),
    rows: picked.slice(Math.max(0, skip), Math.max(0, skip) + Math.min(200, Math.max(1, limit))) };
}
