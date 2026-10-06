// Easy Apply or the company's own site, for each recent LinkedIn job.
//
// LinkedIn's public (logged-out) job page labels every button "Apply", but a job that applies on the company's
// site carries an "offsite" icon on that button; an Easy Apply job doesn't. One request per job, spaced out, no
// login: the same public page JobSpy reads for the description. Saves `apply_type` on the job:
//   "offsite"     Apply goes to the company's site: a real application form (Atriveo can fill it)
//   "easy_apply"  LinkedIn's own Easy Apply: lower priority on Today
//   "closed"      no longer accepting applications
// Jobs already typed are skipped; a page that can't be read is left for the next run.
//
//   node --env-file=.env scripts/linkedin-apply-type.mjs [--days=3] [--limit=400]

import { MongoClient } from "mongodb";

const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) || 3);
// Gentle on purpose (it runs from your own connection): at most 60 an hour, 3-5 s apart, and it stops at a 429.
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) || 60);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The apply type of one job's public page, or null when it couldn't be read. */
export function applyTypeOf(html) {
  if (!html || html.length < 2000) return null;
  if (/no longer accepting applications/i.test(html)) return "closed";
  if (/apply-button__offsite/.test(html)) return "offsite";
  if (/apply-button/.test(html)) return "easy_apply";
  return null;
}

if (process.argv[1]?.endsWith("linkedin-apply-type.mjs")) {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db(process.env.MONGO_DB || undefined);
  try {
    const since = new Date(Date.now() - DAYS * 86_400_000);
    const urls = (await db.collection("jobs").distinct("job_url", { run_at: { $gte: since }, job_url: /^https:\/\/(www\.)?linkedin\.com\/jobs\/view\/\d+/, apply_type: { $exists: false } })).slice(0, LIMIT);
    const counts = { offsite: 0, easy_apply: 0, closed: 0, unread: 0 };
    const started = Date.now();
    for (const url of urls) {
      const id = /\/jobs\/view\/(\d+)/.exec(url)?.[1];
      let res = null;
      try { res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }); } catch { /* network */ }
      if (res?.status === 429) { console.log("LinkedIn asked to slow down (429); stopping until the next run."); break; }
      const type = res?.ok ? applyTypeOf(await res.text()) : null;
      if (type) {
        counts[type]++;
        await db.collection("jobs").updateMany({ job_url: url }, { $set: { apply_type: type, apply_type_at: new Date().toISOString() } });
      } else counts.unread++;
      await sleep(3000 + Math.random() * 2000);
    }
    console.log(`${urls.length} LinkedIn jobs · offsite ${counts.offsite} · Easy Apply ${counts.easy_apply} · closed ${counts.closed} · unread ${counts.unread} · ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await client.close();
  }
}
