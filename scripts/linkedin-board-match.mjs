// LinkedIn jobs → the same posting on the company's own job board (Greenhouse, Ashby, Lever).
//
// LinkedIn hides the company's Apply link from logged-out pages, so the pipeline can't apply to most LinkedIn
// jobs. Many are also posted on the company's own board, whose public API lists every open job. For each recent
// LinkedIn job with a resume and no Apply link: find the company's board (one we already know in ats_boards, or
// try its name as a board on each ATS), fetch the board's jobs, and when exactly one has the same title, save
// its link as the job's job_url_direct (what the pipeline applies to). Never touches LinkedIn.
//
//   node --env-file=.env scripts/linkedin-board-match.mjs            dry run: what it would save
//   node --env-file=.env scripts/linkedin-board-match.mjs --apply    save the matches

import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) || 3);

const companyKey = (s) => String(s ?? "").toLowerCase()
  .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|group|holdings|plc|gmbh|labs?|usa|us|the)\b\.?/g, "")
  .replace(/[^a-z0-9]+/g, "");
// Titles compared without punctuation, seniority noise or location suffixes ("Engineer II - Remote").
const titleKey = (s) => String(s ?? "").toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s[-–|,]\s.*$/, "").replace(/[^a-z0-9]+/g, " ").trim();

const BOARDS = {
  greenhouse: async (token) => {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`);
    return r?.jobs?.map((j) => ({ title: j.title, url: j.absolute_url })) ?? null;
  },
  ashby: async (token) => {
    const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
    return r?.jobs?.map((j) => ({ title: j.title, url: j.jobUrl })) ?? null;
  },
  lever: async (token) => {
    const r = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
    return Array.isArray(r) ? r.map((j) => ({ title: j.text, url: j.hostedUrl })) : null;
  },
};

async function get(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db(process.env.MONGO_DB || undefined);
try {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const docs = await db.collection("jobs").find(
    { run_at: { $gte: since }, job_url: /^https:\/\/(www\.)?linkedin\.com\//, "resume.status": "success", $or: [{ job_url_direct: null }, { job_url_direct: { $exists: false } }] },
    { projection: { job_url: 1, company: 1, title: 1 } },
  ).toArray();
  const jobs = [...new Map(docs.map((d) => [d.job_url, d])).values()];

  // Boards we already know, by company key; otherwise the company's name tried as a board on each ATS.
  const known = new Map();
  for (const b of await db.collection("ats_boards").find({}, { projection: { _id: 0, ats: 1, token: 1 } }).toArray()) {
    if (BOARDS[b.ats]) known.set(companyKey(b.token), { ats: b.ats, token: b.token });
  }
  const byCompany = new Map();
  for (const j of jobs) { const k = companyKey(j.company); if (k) (byCompany.get(k) ?? byCompany.set(k, []).get(k)).push(j); }

  let matched = 0, saved = 0, boardsFound = 0;
  const started = Date.now();
  for (const [key, list] of byCompany) {
    const tries = known.has(key) ? [known.get(key)] : Object.keys(BOARDS).map((ats) => ({ ats, token: key }));
    let postings = null;
    for (const t of tries) { postings = await BOARDS[t.ats](t.token); if (postings?.length) break; }
    if (!postings?.length) continue;
    boardsFound++;
    for (const j of list) {
      const want = titleKey(j.title);
      const hits = postings.filter((p) => p.url && titleKey(p.title) === want);
      if (hits.length !== 1) continue;
      matched++;
      console.log(`${j.company} · ${j.title} → ${hits[0].url}`);
      if (APPLY) {
        const r = await db.collection("jobs").updateMany({ job_url: j.job_url, $or: [{ job_url_direct: null }, { job_url_direct: { $exists: false } }] },
          { $set: { job_url_direct: hits[0].url, job_url_direct_from: "board-match", job_url_direct_at: new Date().toISOString() } });
        saved += r.modifiedCount ? 1 : 0;
      }
    }
  }
  console.log(`\n${jobs.length} LinkedIn jobs · ${byCompany.size} companies · ${boardsFound} boards found · ${matched} matched${APPLY ? ` · ${saved} saved` : " (dry run)"} · ${Math.round((Date.now() - started) / 1000)}s`);
} finally {
  await client.close();
}
