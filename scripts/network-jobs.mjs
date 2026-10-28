import { companyKey } from "./applied-history.mjs";

// Jobs where you know someone: the job board (jobs) and the staffing scraper (staffing_jobs, where the company is the agency) read for
// the companies your people work at, with your own status on each (applied, passed, resume ready, new). Company names are compared
// loosely ("Randstad", "Randstad USA", "randstad inc." are one company), and only the rows that can match are read from Mongo.

const DAY = 86_400_000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SUFFIX = new Set(["incorporated", "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "the"]);
const wordsOf = (name) => String(name ?? "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w && !SUFFIX.has(w));

/**
 * The same company, give or take a suffix or a country: one name's words start the other's ("Randstad" and "Randstad USA", "Northwind
 * Labs" and "Northwind Labs, Inc."), whole words only, so "Randstadt Logistics" is someone else. Names shorter than three letters never match.
 */
export function sameCompany(a, b) {
  const x = wordsOf(a), y = wordsOf(b), [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.join("").length >= 3 && short.every((w, i) => long[i] === w);
}

/** Where a person works: their own "works at", else their source when it is a company. */
export function companyOf(person, sourcesById) {
  if (person.company) return person.company;
  const s = person.sourceId ? sourcesById.get(person.sourceId) : null;
  return s?.type === "company" ? s.name : "";
}

/** A Mongo filter that keeps only names starting with one of these companies' first words; null when there is nothing to look for. */
export function companyRegex(names) {
  const words = [...new Set(names.map((n) => String(n ?? "").trim().replace(/^the\s+/i, "").split(/\s+/)[0]?.toLowerCase() ?? "").filter((w) => w.replace(/[^a-z0-9]/g, "").length >= 3))];
  return words.length ? new RegExp(`^\\s*(?:the\\s+)?(?:${words.map(esc).join("|")})`, "i") : null;
}

/** Your applied and passed jobs, by link. */
async function yourMarks(db) {
  const [apps, swipes] = await Promise.all([
    db.collection("applications").find({ status: "APPLIED" }, { projection: { _id: 0, url: 1, jobUrls: 1, "lifecycle.appliedAt": 1, "submission.submittedAt": 1 } }).toArray(),
    db.collection("job_swipes").find({ direction: { $in: ["applied", "left"] } }, { projection: { _id: 0, job_url: 1, direction: 1, applied_at: 1, swiped_at: 1 } }).toArray(),
  ]);
  const applied = new Map(), passed = new Set();
  for (const a of apps) for (const u of [a.url, ...(a.jobUrls ?? [])].filter(Boolean)) applied.set(u, a.lifecycle?.appliedAt || a.submission?.submittedAt || null);
  for (const s of swipes) { if (s.direction === "applied" && !applied.has(s.job_url)) applied.set(s.job_url, s.applied_at || s.swiped_at || null); if (s.direction === "left") passed.add(s.job_url); }
  return { applied, passed };
}

const iso = (v) => (v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null);

/**
 * Open jobs (found in the last `days`) and your past applications (any age) at any of these companies, newest first, each with your
 * status. Staffing postings count for their agency.
 */
export async function jobsForCompanies(db, names, { now = new Date(), days = 45, limit = 500 } = {}) {
  const rx = companyRegex(names);
  if (!rx) return [];
  const since = new Date(now.getTime() - days * DAY);
  const marks = await yourMarks(db);
  const appliedUrls = [...marks.applied.keys()];
  const [board, staffing, past] = await Promise.all([
    db.collection("jobs").find({ company: rx, run_at: { $gte: since }, apply_type: { $ne: "closed" } }, { projection: { _id: 0, job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, run_at: 1, site: 1, "resume.status": 1 } }).sort({ run_at: -1 }).limit(limit).toArray(),
    db.collection("staffing_jobs").find({ company: rx, expired: false }, { projection: { _id: 0, job_url: 1, company: 1, title: 1, location: 1, first_seen_at: 1 } }).limit(limit).toArray(),
    appliedUrls.length ? db.collection("jobs").find({ company: rx, job_url: { $in: appliedUrls } }, { projection: { _id: 0, job_url: 1, job_url_direct: 1, company: 1, title: 1, location: 1, run_at: 1, site: 1, "resume.status": 1 } }).toArray() : [],
  ]);
  const out = new Map();
  for (const j of [...board, ...past]) if (!out.has(j.job_url)) out.set(j.job_url, { url: j.job_url, applyUrl: j.job_url_direct || j.job_url, company: j.company, title: j.title, location: j.location ?? "", foundAt: iso(j.run_at), site: j.site ?? "", resumeReady: j.resume?.status === "success" });
  for (const j of staffing) if (!out.has(j.job_url)) out.set(j.job_url, { url: j.job_url, applyUrl: j.job_url, company: j.company, title: j.title, location: j.location ?? "", foundAt: iso(j.first_seen_at), site: "staffing", resumeReady: false });
  return [...out.values()]
    .filter((j) => names.some((n) => sameCompany(n, j.company)))
    .map((j) => ({ ...j, status: marks.applied.has(j.url) ? "applied" : marks.passed.has(j.url) ? "passed" : j.resumeReady ? "ready" : "new", appliedAt: iso(marks.applied.get(j.url)) }))
    .sort((a, b) => String(b.foundAt ?? "").localeCompare(String(a.foundAt ?? "")));
}

async function people(db) {
  const [ppl, sources] = await Promise.all([db.collection("network_people").find({}).toArray(), db.collection("network_sources").find({}).toArray()]);
  const byId = new Map(sources.map((s) => [s._id, s]));
  return ppl.filter((p) => !p.archived).map((p) => ({ id: p._id, name: p.name, company: companyOf(p, byId), watchJobs: Boolean(p.watchJobs) })).filter((p) => p.company);
}

/** One person's company, its jobs and your applications there. */
export async function jobsForPerson(db, id, opts = {}) {
  const p = await db.collection("network_people").findOne({ _id: String(id ?? "") });
  if (!p) return { company: "", jobs: [] };
  const src = p.sourceId ? await db.collection("network_sources").findOne({ _id: p.sourceId }) : null;
  const company = companyOf(p, new Map(src ? [[src._id, src]] : []));
  return { company, jobs: company ? await jobsForCompanies(db, [company], opts) : [] };
}

/** Every company where you know someone, with those people and its jobs: the Jobs tab. Companies with nothing open come last. */
export async function warmJobs(db, opts = {}) {
  const list = await people(db);
  const groups = [];
  for (const p of list) {
    const g = groups.find((x) => sameCompany(x.company, p.company));
    if (g) g.people.push({ id: p.id, name: p.name, watchJobs: p.watchJobs }); else groups.push({ company: p.company, people: [{ id: p.id, name: p.name, watchJobs: p.watchJobs }] });
  }
  const jobs = await jobsForCompanies(db, groups.map((g) => g.company), opts);
  return groups.map((g) => ({ ...g, jobs: jobs.filter((j) => sameCompany(g.company, j.company)) }))
    .sort((a, b) => Number(b.jobs.some((j) => j.status !== "applied" && j.status !== "passed")) - Number(a.jobs.some((j) => j.status !== "applied" && j.status !== "passed")) || b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));
}

/** The small list job cards elsewhere use: company key, name, and who you know there. */
export async function knownCompanies(db) {
  const list = await people(db), out = [];
  for (const p of list) {
    const key = companyKey(p.company), g = out.find((x) => sameCompany(x.name, p.company));
    if (g) g.people.push({ id: p.id, name: p.name }); else out.push({ key, name: p.company, people: [{ id: p.id, name: p.name }] });
  }
  return out;
}
