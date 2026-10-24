// Fill in the job descriptions the scraper missed, from each board's public API (Greenhouse, Ashby, Lever), then put the jobs whose
// resume failed only because the text was missing back in line for a rebuild.
//   node --env-file=.env scripts/fill-descriptions.mjs                 report only (changes nothing)
//   node --env-file=.env scripts/fill-descriptions.mjs --apply         write the descriptions and re-open the failed resumes
//   options: --days 3 (how far back to look)  --limit 400
//
// Why: the scraper's own detail request sometimes times out (Greenhouse) or comes back empty (Ashby), so about a third of the board
// jobs had no description and their resume failed with "JD not found or too short". The text is on the board; this fetches it, and
// queues a resume for every recent board job that has its text but no resume yet (the hourly enqueue only sees the newest scrape).
import { withMongo, closeMongo } from "./mongo-client.mjs";
import { enqueueJob } from "./resume-queue.mjs";

const MIN_CHARS = 200;
const SITES = ["greenhouse", "ashby", "lever"];
const ashbyBoards = new Map();

const getJson = async (url, fetchImpl) => {
  const r = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  return r.status === 200 ? r.json() : null;
};

/** Greenhouse's `content` is HTML-escaped HTML: unescape, strip tags, unescape entities. */
export function htmlToText(content) {
  const unescape = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return unescape(unescape(content))
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** The posting's text from its board, or null when the board does not give one (never a guess). */
export async function fetchDescription(rawUrl, { fetchImpl = fetch } = {}) {
  let u; try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.replace(/^www\./, ""), parts = u.pathname.split("/").filter(Boolean);
  try {
    if (/(^|\.)greenhouse\.io$/.test(host) && parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? "")) {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${parts[0]}/jobs/${parts[2]}`, fetchImpl);
      return j ? htmlToText(j.content) : null;
    }
    if (host === "jobs.lever.co" && parts.length >= 2) {
      const j = await getJson(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}`, fetchImpl);
      if (!j) return null;
      const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
      return [j.descriptionPlain || htmlToText(j.description), lists, j.additionalPlain].filter(Boolean).join("\n\n").trim();
    }
    if (host === "jobs.ashbyhq.com" && parts.length >= 2) {
      const [org, id] = parts;
      if (!ashbyBoards.has(org)) ashbyBoards.set(org, await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`, fetchImpl));
      const job = ashbyBoards.get(org)?.jobs?.find((x) => String(x.id) === id);
      return job ? (job.descriptionPlain || htmlToText(job.descriptionHtml) || null) : null;
    }
  } catch { /* a slow or failed board costs this job its text for now; the next run tries again */ }
  return null;
}

/** Pure: which jobs lack a usable description, given the descriptions we hold (url -> text). */
export function missingDescriptions(jobs, held) {
  return jobs.filter((j) => j.job_url && String(held.get(j.job_url) ?? "").length < MIN_CHARS);
}

export async function fillDescriptions(db, { apply = false, days = 3, limit = 400, queueLimit = 150, fetchImpl = fetch, enqueue = enqueueJob, log = console.log } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600e3);
  const jobs = await db.collection("jobs").find({ site: { $in: SITES }, run_at: { $gte: since } }).project({ job_url: 1, site: 1 }).toArray();
  const docs = await db.collection("descriptions").find({ job_url: { $in: jobs.map((j) => j.job_url) } }).project({ job_url: 1, description: 1 }).toArray();
  const held = new Map(docs.map((d) => [d.job_url, d.description]));
  const todo = missingDescriptions(jobs, held).slice(0, limit);
  const out = { looked_at: jobs.length, missing: todo.length, filled: 0, unavailable: 0, reopened: 0, queued: 0 };
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (j) => {
      const text = await fetchDescription(j.job_url, { fetchImpl });
      if (!text || text.length < MIN_CHARS) { out.unavailable++; return; }
      out.filled++;
      if (!apply) return;
      await db.collection("descriptions").updateOne({ job_url: j.job_url }, { $set: { job_url: j.job_url, description: text } }, { upsert: true });
      // Only a resume that failed for lack of text goes back to "not built"; the enqueue step picks it up again.
      const r = await db.collection("jobs").updateOne(
        { job_url: j.job_url, "resume.status": "failed", "resume.error": /JD not found|too short/i },
        { $unset: { resume: "" } });
      out.reopened += r.modifiedCount;
    }));
    if (i + 6 < todo.length) await new Promise((r) => setTimeout(r, 250));
  }
  // Any site: a resume that failed for lack of text, whose text has arrived since (LinkedIn's comes from the Mac), is re-opened.
  if (apply) {
    const stuck = await db.collection("jobs").find({ run_at: { $gte: since }, "resume.status": "failed", "resume.error": /JD not found|too short/i }).project({ job_url: 1 }).toArray();
    const now = new Map((await db.collection("descriptions").find({ job_url: { $in: stuck.map((j) => j.job_url) } }).project({ job_url: 1, description: 1 }).toArray()).map((d) => [d.job_url, d.description]));
    for (const j of stuck.filter((x) => String(now.get(x.job_url) ?? "").length >= MIN_CHARS)) {
      const r = await db.collection("jobs").updateOne({ job_url: j.job_url, "resume.status": "failed", "resume.error": /JD not found|too short/i }, { $unset: { resume: "" } });
      out.reopened += r.modifiedCount;
    }
  }
  // Jobs with their text and no resume record at all: queue them (newest first), a bounded number per run.
  if (apply) {
    // The same posting is stored once per scrape pipeline and the resume sits on one of those rows, so judge by posting, not by row.
    const rows = await db.collection("jobs").find({ site: { $in: [...SITES, "linkedin"] }, run_at: { $gte: since } })
      .project({ job_url: 1, company: 1, title: 1, location: 1, score_pct: 1, session_id: 1, batch_time: 1, "resume.status": 1 }).sort({ run_at: -1 }).toArray();
    const hasResume = new Set(rows.filter((r) => r.resume?.status).map((r) => r.job_url));
    const seenUrl = new Set();
    const fresh = rows.filter((r) => !r.resume?.status && !hasResume.has(r.job_url) && !seenUrl.has(r.job_url) && seenUrl.add(r.job_url));
    const have = new Map((await db.collection("descriptions").find({ job_url: { $in: fresh.map((j) => j.job_url) } }).project({ job_url: 1, description: 1 }).toArray()).map((d) => [d.job_url, d.description]));
    for (const j of fresh.filter((x) => String(have.get(x.job_url) ?? "").length >= MIN_CHARS).slice(0, queueLimit)) {
      const r = await enqueue(db, j);
      if (!r.skipped) out.queued++;
    }
  }
  log(`${out.looked_at} board jobs from the last ${days} days: ${out.missing} had no description; ${out.filled} found on the board, ${out.unavailable} not available there`);
  if (apply) log(`  wrote ${out.filled} descriptions, re-opened ${out.reopened} failed resumes, queued ${out.queued} resumes`); else log("  (report only: nothing was changed; add --apply)");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) || d : d; };
  try { await withMongo((db) => fillDescriptions(db, { apply: process.argv.includes("--apply"), days: arg("days", 3), limit: arg("limit", 400) })); }
  finally { await closeMongo(); }
}
