import crypto from "node:crypto";
import { appliedItems, appliedCounts } from "./applied-core.mjs";

// Everything you applied to, in one list: applications Atriveo tracked, plus jobs you marked applied ("I applied" in the
// extension or Matching), each with what the employers' emails said afterwards. The Stats history only has the first kind.

const OUTCOMES = ["rejected", "assessment", "interview", "offer"];
const SUFFIX = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|the)\b/g;
export const companyKey = (name) => String(name || "").toLowerCase().replace(/&/g, " and ").replace(SUFFIX, " ").replace(/[^a-z0-9]+/g, "");
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const swipeKey = (url) => `j:${crypto.createHash("sha1").update(String(url)).digest("hex").slice(0, 12)}`;

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "a job posting"; }
}

/** The employer's mail about one application: events whose company is this one, received after it was sent. */
function eventsFor(row, events, appId) {
  const key = companyKey(row.company);
  const from = Date.parse(row.appliedAt) - 86400000;
  return events.filter((e) => {
    if (!OUTCOMES.includes(e.kind) || e.state === "dismissed" || e.state === "undone") return false;
    if (appId && e.match === appId) return true;
    return Boolean(key) && Date.parse(e.receivedAt) >= from && (e.companies || []).some((c) => companyKey(c) === key);
  }).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

export function buildAppliedRows({ applications, swipes, jobs, events }) {
  const jobBy = new Map();
  for (const j of jobs) if (!jobBy.has(j.job_url)) jobBy.set(j.job_url, j);
  const appBy = new Map(applications.map((a) => [String(a._id), a]));
  const rows = [];
  // Which jobs are applied, and when, is the shared definition (applied-core.mjs), so this list and every count agree.
  for (const it of appliedItems(applications, swipes)) {
    if (!it.appliedAt) continue;
    if (it.kind === "application") {
      const a = appBy.get(it.id);
      const job = (a.jobUrls || []).map((u) => jobBy.get(u)).find(Boolean);
      rows.push({ key: it.key, appId: it.id, jobUrl: it.jobUrl || a.applyUrl || null, company: a.company || job?.company || "", title: a.title || job?.title || "",
        location: a.location ?? job?.location ?? null, source: a.ats || job?.site || null, appliedAt: it.appliedAt, via: a.submission?.by === "extension" ? "Apply with Atriveo" : "Atriveo engine",
        postingUrl: (a.jobUrls || []).find((u) => /linkedin\.com/.test(u)) || a.applyUrl || null, applyUrl: a.finalUrl || a.applyUrl || null,
        resume: { path: a.resume?.path ?? job?.resume?.pdf_path ?? null, sha256: job?.resume?.object?.sha256 ?? null }, foundAt: iso(job?.run_at), resumeAt: iso(job?.resume?.updated_at), appOutcome: a.outcome || null });
    } else {
      const job = jobBy.get(it.jobUrl);
      rows.push({ key: swipeKey(it.jobUrl), appId: null, jobUrl: it.jobUrl, company: job?.company || "", title: job?.title || `Job on ${hostLabel(it.jobUrl)}`, location: job?.location ?? null, source: job?.site || null,
        appliedAt: it.appliedAt, via: "You marked it applied", postingUrl: it.jobUrl, applyUrl: job?.job_url_direct || null,
        resume: { path: job?.resume?.pdf_path ?? null, sha256: job?.resume?.object?.sha256 ?? null }, foundAt: iso(job?.run_at), resumeAt: iso(job?.resume?.updated_at), appOutcome: null });
    }
  }
  for (const r of rows) {
    const mail = eventsFor(r, events, r.appId);
    r.mail = mail.map((e) => ({ at: iso(e.receivedAt), kind: e.kind, subject: e.subject || null }));
    const last = r.mail.at(-1);
    const fromApp = r.appOutcome && OUTCOMES.concat("confirmed").includes(r.appOutcome.status) ? { status: r.appOutcome.status, at: iso(r.appOutcome.stageAt ?? r.appOutcome.rejectedAt ?? r.appOutcome.confirmedAt) } : null;
    r.outcome = last ? { status: last.kind, at: last.at } : fromApp && fromApp.status !== "confirmed" ? fromApp : null;
    r.confirmed = Boolean(fromApp?.status === "confirmed" || r.appOutcome?.confirmedAt);
    delete r.appOutcome;
  }
  return rows.sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));
}

const matchesOutcome = (r, outcome) => outcome === "all" || (outcome === "replied" ? Boolean(r.outcome) : outcome === "none" ? !r.outcome : r.outcome?.status === outcome);

/** Every applied job as a row (with its mail), and the raw items the shared counts are built from. */
export async function loadAppliedRows(db, { now = Date.now() } = {}) {
  const since = new Date(now - 200 * 86400000).toISOString();
  const [applications, swipes, events] = await Promise.all([
    db.collection("applications").find({ status: "APPLIED" }, { projection: { company: 1, title: 1, location: 1, ats: 1, applyUrl: 1, finalUrl: 1, jobUrls: 1, "lifecycle.appliedAt": 1, "submission.submittedAt": 1, "submission.by": 1, outcome: 1, resume: 1 } }).toArray(),
    db.collection("job_swipes").find({ direction: "applied" }, { projection: { _id: 0, job_url: 1, direction: 1, applied_at: 1, swiped_at: 1 } }).toArray(),
    db.collection("inbox_events").find({ receivedAt: { $gte: since }, kind: { $in: OUTCOMES } }, { projection: { _id: 0, receivedAt: 1, kind: 1, subject: 1, companies: 1, state: 1, match: 1 } }).toArray(),
  ]);
  const urls = [...new Set([...applications.flatMap((a) => a.jobUrls || []), ...swipes.map((s) => s.job_url)])].slice(0, 6000);
  const jobs = urls.length ? await db.collection("jobs").find({ job_url: { $in: urls } }, { projection: { _id: 0, job_url: 1, company: 1, title: 1, location: 1, site: 1, run_at: 1, job_url_direct: 1, "resume.pdf_path": 1, "resume.updated_at": 1, "resume.object.sha256": 1 } }).toArray() : [];
  const all = buildAppliedRows({ applications, swipes, jobs, events });
  return { all, applications, swipes };
}

export async function appliedHistory(db, { q = "", outcome = "all", skip = 0, limit = 40, key = null, now = Date.now() } = {}) {
  const { all, applications, swipes } = await loadAppliedRows(db, { now });
  if (key) { const row = all.find((r) => r.key === key); return row ? { ok: true, row } : { ok: false, error: "That application was not found." }; }
  const text = String(q || "").trim().toLowerCase().slice(0, 100);
  const searched = text ? all.filter((r) => `${r.company} ${r.title} ${r.location || ""}`.toLowerCase().includes(text)) : all;
  const counts = { all: searched.length, replied: 0, assessment: 0, interview: 0, offer: 0, rejected: 0, none: 0 };
  for (const r of searched) { if (r.outcome) { counts.replied++; counts[r.outcome.status] = (counts[r.outcome.status] || 0) + 1; } else counts.none++; }
  const picked = searched.filter((r) => matchesOutcome(r, outcome));
  const shared = appliedCounts(appliedItems(applications, swipes), { now: new Date(now), days: 7 });
  return { ok: true, total: picked.length, counts, last7: shared.last7, allTime: shared.total,
    rows: picked.slice(Math.max(0, skip), Math.max(0, skip) + Math.min(100, Math.max(1, limit))).map(({ mail, ...r }) => ({ ...r, mailCount: mail.length })) };
}
