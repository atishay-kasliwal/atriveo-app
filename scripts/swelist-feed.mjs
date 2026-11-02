// New-grad jobs from SWElist's source: the SimplifyJobs New-Grad-Positions list on GitHub (the daily SWElist mail shows part of
// it). Keeps the open Software, AI/ML/Data and Quant jobs in the United States posted in the last few days, stores each with its
// posting text, and queues a resume. A job whose posting cannot be read fails that build and shows on General (the general resume).
//   node --env-file=.env scripts/swelist-feed.mjs              report only (changes nothing)
//   node --env-file=.env scripts/swelist-feed.mjs --apply      add the jobs and their descriptions, queue the resumes
//   options: --days 3 (how far back by posting date)
//
// The jobs carry site "swelist", their own source on Matching and Today. A posting already stored by another scraper is left as it is.
// The after-scrape loop runs this every 15 minutes; the 13 MB list is downloaded only when GitHub says it changed (ETag in feed_state).
import { withMongo, closeMongo } from "./mongo-client.mjs";
import { enqueueJob } from "./resume-queue.mjs";
import { fetchDescription as boardDescription, htmlToText } from "./fill-descriptions.mjs";

export const LISTINGS_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";
export const SITE = "swelist";
const MIN_CHARS = 200;
const STATE_ID = "swelist";
// The list's categories worth a resume; Hardware and Product (ASIC verification, camera technician, product owner) are left out.
export const CATEGORIES = new Set(["Software", "Software Engineering", "AI/ML/Data", "Data Science, AI & Machine Learning", "Quant"]);

const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const STATE_NAMES = "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming";
// "Bedford, MA", "Remote in USA", "United States", "California", and the list's own short names (SF, NYC, LA, South SF).
const US = new RegExp(`,\\s*(?:${STATE_CODES})\\b|^(?:remote in )?(?:usa|us|united states)$|^(?:${STATE_NAMES})$|^(?:south )?sf$|^nyc$|^la$`, "i");

/** True when a listing location is in the United States. Canadian provinces and "…, Canada" never count. */
export function usLocation(location) {
  const text = String(location ?? "").trim();
  return !!text && !/\bcanada\b/i.test(text) && US.test(text);
}

/** The posting link without tracking parameters, so the same job from two sources is one row. */
export function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

/** Pure: the listings to keep (open, visible, a wanted category, posted in the last `days`, at least one US location), as job rows. */
export function pickListings(list, { now = new Date(), days = 3 } = {}) {
  const since = now.getTime() / 1000 - days * 86_400;
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x?.active || x.is_visible === false || !CATEGORIES.has(x.category) || !(Number(x.date_posted) >= since)) continue;
    const us = (x.locations ?? []).filter(usLocation);
    const url = cleanUrl(x.url);
    if (!us.length || !url || !x.company_name || !x.title) continue;
    out.push({
      job_url: url, job_url_direct: url, site: SITE, company: String(x.company_name).trim(), title: String(x.title).trim(),
      location: us.join(" | "), date_posted: new Date(Number(x.date_posted) * 1000).toISOString(), level: "New Grad",
      simplify_id: String(x.id ?? ""), simplify_category: x.category ?? null,
    });
  }
  return out;
}

const getJson = async (url, fetchImpl, init = {}) => {
  const r = await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(20_000) });
  return r.status === 200 ? r.json() : null;
};

/** The posting's text: Workday, SmartRecruiters and Workable here, Greenhouse, Lever and Ashby through fill-descriptions. Null when unavailable. */
export async function fetchPostingText(rawUrl, { fetchImpl = fetch } = {}) {
  let u; try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.toLowerCase(), parts = u.pathname.split("/").filter(Boolean);
  try {
    if (/\.myworkdayjobs\.com$/.test(host)) {
      const at = parts.indexOf("job");
      const site = parts.slice(0, at).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p)).pop();
      if (at < 0 || !site) return null;
      const j = await getJson(`https://${host}/wday/cxs/${host.split(".")[0]}/${site}/${parts.slice(at).join("/")}`, fetchImpl);
      return j?.jobPostingInfo?.jobDescription ? htmlToText(j.jobPostingInfo.jobDescription) : null;
    }
    if (host === "jobs.smartrecruiters.com" && parts.length >= 2) {
      const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${parts[0]}/postings/${parts[1].split("-")[0]}`, fetchImpl);
      return j?.jobAd?.sections ? htmlToText(Object.values(j.jobAd.sections).map((s) => s?.text ?? "").join("\n")) : null;
    }
    if (host === "apply.workable.com" && parts[1] === "j" && parts[2]) {
      const j = await getJson(`https://apply.workable.com/api/v2/accounts/${parts[0]}/jobs/${parts[2]}`, fetchImpl);
      return j ? htmlToText([j.description, j.requirements, j.benefits].filter(Boolean).join("\n")) : null;
    }
  } catch { return null; /* a slow board costs this job its text for now; the next run tries again */ }
  return boardDescription(rawUrl, { fetchImpl });
}

/** The list, or null when it has not changed since the last download (or GitHub did not answer). */
async function loadListings(db, { fetchImpl, force }) {
  const state = force ? null : await db.collection("feed_state").findOne({ _id: STATE_ID });
  const r = await fetchImpl(LISTINGS_URL, { headers: state?.etag ? { "If-None-Match": state.etag } : {}, signal: AbortSignal.timeout(60_000) });
  if (r.status !== 200) return null;
  return { list: await r.json(), etag: r.headers.get("etag") };
}

export async function swelistFeed(db, { apply = false, days = 3, queueLimit = 60, force = false, now = new Date(), fetchImpl = fetch, enqueue = enqueueJob, log = console.log } = {}) {
  const out = { listed: 0, kept: 0, added: 0, known: 0, described: 0, queued: 0, unchanged: false };
  const loaded = await loadListings(db, { fetchImpl, force });
  if (!loaded) { out.unchanged = true; log("SimplifyJobs list unchanged since the last run"); return out; }
  const rows = pickListings(loaded.list, { now, days });
  out.listed = loaded.list.length; out.kept = rows.length;
  // A posting another scraper already stored keeps that row and its source.
  const stored = new Map((await db.collection("jobs").find({ job_url: { $in: rows.map((r) => r.job_url) } }).project({ job_url: 1, site: 1 }).toArray()).map((d) => [d.job_url, d.site]));
  const ours = rows.filter((r) => { const site = stored.get(r.job_url); if (site && site !== SITE) out.known++; return !site || site === SITE; });
  const held = new Map((await db.collection("descriptions").find({ job_url: { $in: ours.map((r) => r.job_url) } }).project({ job_url: 1, description: 1 }).toArray()).map((d) => [d.job_url, d.description]));
  const sessionId = `swelist-${now.toISOString().slice(0, 10)}`;
  for (let i = 0; i < ours.length; i += 6) {
    await Promise.all(ours.slice(i, i + 6).map(async (job) => {
      if (String(held.get(job.job_url) ?? "").length < MIN_CHARS) {
        const text = await fetchPostingText(job.job_url, { fetchImpl });
        if (text && text.length >= MIN_CHARS) { held.set(job.job_url, text); out.described++; if (apply) await db.collection("descriptions").updateOne({ job_url: job.job_url }, { $set: { job_url: job.job_url, description: text } }, { upsert: true }); }
      }
      if (!apply || stored.has(job.job_url)) return;
      const r = await db.collection("jobs").updateOne({ job_url: job.job_url, site: SITE }, { $setOnInsert: { ...job, session_id: sessionId, pipeline: SITE, run_at: now } }, { upsert: true });
      out.added += r.upsertedCount;
    }));
  }
  if (apply) {
    // Jobs with no resume yet: queue them, those with their text first, newest first. Without text the build fails "JD not found"
    // and the job shows on General; fill-descriptions re-opens it if the text turns up. Source "swelist" keeps the hourly purge off them.
    const waiting = await db.collection("jobs").find({ site: SITE, job_url: { $in: ours.map((r) => r.job_url) }, resume: { $in: [null] } })
      .project({ job_url: 1, company: 1, title: 1, location: 1, session_id: 1 }).sort({ date_posted: -1 }).toArray();
    const hasText = (x) => String(held.get(x.job_url) ?? "").length >= MIN_CHARS;
    for (const j of [...waiting.filter(hasText), ...waiting.filter((x) => !hasText(x))].slice(0, queueLimit)) {
      const r = await enqueue(db, { ...j, source: SITE });
      if (!r.skipped) out.queued++;
    }
    await db.collection("feed_state").updateOne({ _id: STATE_ID }, { $set: { etag: loaded.etag, checked_at: now } }, { upsert: true });
  }
  log(`SimplifyJobs list: ${out.listed} listings, ${out.kept} open software/AI/data/quant jobs in the US from the last ${days} days (${out.known} already stored by another scraper)`);
  if (apply) log(`  added ${out.added} jobs, ${out.described} descriptions, queued ${out.queued} resumes`); else log(`  ${out.described} descriptions found (report only: nothing was changed; add --apply)`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) || d : d; };
  try { await withMongo((db) => swelistFeed(db, { apply: process.argv.includes("--apply"), days: arg("days", 3), force: process.argv.includes("--force") }), { appName: "AtriveoSwelistFeed" }); }
  finally { await closeMongo(); }
}
