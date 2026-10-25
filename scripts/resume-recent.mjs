#!/usr/bin/env node
// Resume pass for recent jobs only: queue resumes for jobs posted in the last N hours (default 24) and take
// every older job off the resume queue. Jobs themselves are never deleted.
//
//   node scripts/resume-recent.mjs                    # dry run: counts and the cutoff, changes nothing
//   node scripts/resume-recent.mjs --apply            # dequeue older jobs, queue the recent ones
//   node scripts/resume-recent.mjs --hours=12 --apply
//
// How "recent" is decided. job-pipeline stores one jobs doc per (session_id, job_url), so a posting scraped
// again today gets a new doc with today's run_at. A job's age is therefore its FIRST sighting: the earliest
// run_at over every doc with that job_url. ATS boards (Greenhouse, Ashby, Lever) also give date_posted (the
// posting's first-published day); boards are often discovered days after posting, so a job with a
// date_posted before the cutoff's UTC day is older no matter when we first saw it. LinkedIn has no
// date_posted, and its "last 4 hours" search also returns old postings that were only relisted. LinkedIn
// job ids are assigned in creation order, so any id at or below the highest id we had already seen before
// the cutoff was created before the cutoff: such a job is a relisting, not a new posting.
// A job is recent when first seen >= cutoff AND (no date_posted, or date_posted >= the cutoff's UTC day)
// AND (not LinkedIn, or its id is above that floor).
// Only scraped jobs (with a session_id) count; Apply-here pages from the extension are not jobs to build for.
//
// What it changes with --apply:
//   - queued resumes (any owner) and stale running ones (lease expired) for older jobs: resume record removed,
//     the same as the hourly purge, so no worker picks them up
//   - recent jobs without a resume, or with a failed (retryable), queued or stale running one: queued for
//     `owner` (this backend's compiler) at the hourly priority; the worker still claims by priority then
//     score_pct, so the strongest matches go first
// Built resumes (success), resumes being built right now, deterministic failures (no-go, unsupported-jd)
// and applications are left alone. Source "recent" keeps the hourly purge (resume-enqueue.mjs) off them.
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { enqueueJob, PRIORITY_FRESH } from "./resume-queue.mjs";
import { compileOwner } from "./worker-id.mjs";

export const RECENT_SOURCE = "recent";

function linkedinId(url) {
  const m = /linkedin\.com\/jobs\/view\/(\d+)/.exec(url || "");
  return m ? Number(m[1]) : null;
}

function time(v) {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(typeof v === "string" ? v : "");
  return Number.isFinite(t) ? t : null;
}

/** One row per job_url: first sighting, earliest posting day, and the doc's resume. */
async function jobRows(db) {
  const docs = await db.collection("jobs").find(
    { session_id: { $nin: [null, ""] } },
    { projection: { _id: 0, job_url: 1, company: 1, title: 1, location: 1, score_pct: 1, run_at: 1, session_id: 1, batch_time: 1, date_posted: 1, resume: 1 } },
  ).toArray();
  const byUrl = new Map();
  for (const d of docs) {
    if (!d.job_url) continue;
    const seen = time(d.run_at) ?? time(d.session_id) ?? time(d.batch_time);
    const posted = typeof d.date_posted === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.date_posted) ? d.date_posted.slice(0, 10) : null;
    const row = byUrl.get(d.job_url);
    if (!row) {
      byUrl.set(d.job_url, { job: d, firstSeen: seen, posted, resume: d.resume ?? null, score: d.score_pct ?? null });
      continue;
    }
    if (seen != null && (row.firstSeen == null || seen < row.firstSeen)) row.firstSeen = seen;
    if (posted && (!row.posted || posted < row.posted)) row.posted = posted;
    if (!row.resume && d.resume) row.resume = d.resume;
    if (d.score_pct != null && (row.score == null || d.score_pct > row.score)) row.score = d.score_pct;
  }
  return [...byUrl.values()];
}

export async function queueRecentResumes({ db, hours = 24, owner = compileOwner(), now = Date.now(), apply = false, log = console.log }) {
  if (!(hours > 0)) throw new Error(`hours must be positive, got ${hours}`);
  const cutoff = now - hours * 3600 * 1000;
  const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
  const rows = await jobRows(db);

  const seenInWindow = rows.filter((r) => r.firstSeen != null && r.firstSeen >= cutoff);
  let idFloor = null;
  for (const r of rows) {
    const id = linkedinId(r.job.job_url);
    if (id != null && r.firstSeen != null && r.firstSeen < cutoff && (idFloor == null || id > idFloor)) idFloor = id;
  }
  const postedInWindow = seenInWindow.filter((r) => !r.posted || r.posted >= cutoffDay);
  const recent = postedInWindow.filter((r) => { const id = linkedinId(r.job.job_url); return id == null || idFloor == null || id > idFloor; });
  const recentUrls = new Set(recent.map((r) => r.job.job_url));
  const touchedInWindow = new Set((await db.collection("jobs").distinct("job_url", { run_at: { $gte: new Date(cutoff) } })));

  const stale = (r) => r?.status === "running" && (time(r.lease_until) ?? 0) < now;
  const buckets = { built: [], building: [], permanentFail: [], toQueue: [] };
  for (const r of recent) {
    const s = r.resume?.status;
    if (s === "success") buckets.built.push(r);
    else if (s === "running" && !stale(r.resume)) buckets.building.push(r);
    else if (s === "failed" && r.resume?.failure_reason) buckets.permanentFail.push(r);
    else buckets.toQueue.push(r);
  }
  // Strongest first, newest breaking ties; the worker's claim order (priority, score_pct) does the rest.
  buckets.toQueue.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.firstSeen - a.firstSeen);

  const olderFilter = {
    job_url: { $nin: [...recentUrls] },
    $or: [
      { "resume.status": "queued" },
      { "resume.status": "running", $or: [{ "resume.lease_until": null }, { "resume.lease_until": { $lt: new Date(now) } }] },
    ],
  };
  const olderQueued = await db.collection("jobs").countDocuments(olderFilter);

  const summary = {
    cutoff: new Date(cutoff).toISOString(),
    cutoffDay,
    field: "first sighting (min run_at per job_url), plus date_posted (ATS boards) and the LinkedIn id floor",
    scrapedInWindow: touchedInWindow.size,
    firstSeenInWindow: seenInWindow.length,
    recent: recent.length,
    excludedRescraped: touchedInWindow.size - seenInWindow.length,
    excludedPostedEarlier: seenInWindow.length - postedInWindow.length,
    linkedinIdFloor: idFloor,
    excludedRelisted: postedInWindow.length - recent.length,
    alreadyBuilt: buckets.built.length,
    building: buckets.building.length,
    permanentFail: buckets.permanentFail.length,
    toQueue: buckets.toQueue.length,
    olderDequeued: olderQueued,
    queued: 0,
    cacheHits: 0,
  };
  log(`Cutoff ${summary.cutoff} (${hours} h) · posting day >= ${cutoffDay}`);
  log(`Scraped in window ${summary.scrapedInWindow} · first seen in window ${summary.firstSeenInWindow} · recent ${summary.recent}`);
  log(`Excluded: ${summary.excludedRescraped} seen before the cutoff, ${summary.excludedPostedEarlier} posted before ${cutoffDay}, ${summary.excludedRelisted} LinkedIn relistings (id <= ${idFloor ?? "none"})`);
  log(`Recent: ${summary.alreadyBuilt} already built (kept), ${summary.building} building now, ${summary.permanentFail} no-go/unsupported, ${summary.toQueue} ${apply ? "to queue" : "would queue"} for ${owner}`);
  log(`${apply ? "Dequeuing" : "Would dequeue"} ${olderQueued} older queued/stale resume(s)`);
  if (!apply) return { ...summary, queue: buckets.toQueue.map((r) => r.job.job_url) };

  summary.olderDequeued = (await db.collection("jobs").updateMany(olderFilter, { $unset: { resume: "" } })).modifiedCount;
  for (const r of buckets.toQueue) {
    // A queued or stale build may sit on another doc of the same posting, owned by another worker:
    // clear it everywhere so exactly one copy is queued, for `owner`.
    if (r.resume?.status === "queued" || r.resume?.status === "running") {
      await db.collection("jobs").updateMany({ job_url: r.job.job_url, "resume.status": { $in: ["queued", "running"] } }, { $unset: { resume: "" } });
    }
    const res = await enqueueJob(db, {
      job_url: r.job.job_url,
      company: r.job.company,
      title: r.job.title,
      location: r.job.location,
      batch_time: r.job.batch_time || null,
      session_id: r.job.session_id || null,
      source: RECENT_SOURCE,
      owner,
      priority: PRIORITY_FRESH,
    });
    if (res.reason === "cache_hit") summary.cacheHits += 1;
    else if (!res.skipped) summary.queued += 1;
  }
  log(`Dequeued ${summary.olderDequeued} · queued ${summary.queued} · reused ${summary.cacheHits} cached build(s)`);
  return { ...summary, queue: buckets.toQueue.map((r) => r.job.job_url) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  dotenv.config();
  const apply = process.argv.includes("--apply");
  const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
  const hours = hoursArg ? Number(hoursArg.split("=")[1]) : 24;
  (async () => {
    const { withMongo, closeMongo } = await import("./mongo-client.mjs");
    try { return await withMongo((db) => queueRecentResumes({ db, hours, apply }), { appName: "AtriveoResumeRecent" }); } finally { await closeMongo(); }
  })().then(() => { if (!apply) console.log("Dry run. Add --apply to do it."); }).catch((e) => { console.error(e); process.exit(1); });
}
