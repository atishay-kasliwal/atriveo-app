// Live job feed for the dock, read straight from Mongo.
// Mirrors job-pipeline/job_pipeline/export_static.py so the dock sees the same
// rows as application.atriveo.com, without waiting for the static export.

const TZ = process.env.DASHBOARD_TZ?.trim() || "America/New_York";
const PROJECTION = { _id: 0, run_at: 0 };

function tzOffsetMs(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - date.getTime();
}

function localDateParts(date) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date).split("-").map(Number);
  return { y, m, d };
}

function localMidnightUtc(y, m, d) {
  const naive = Date.UTC(y, m - 1, d);
  // Second pass settles the offset on DST-transition days.
  const first = naive - tzOffsetMs(new Date(naive));
  return new Date(naive - tzOffsetMs(new Date(first)));
}

export function localDayBoundsUtc(daysAgo, now = new Date()) {
  const { y, m, d } = localDateParts(now);
  return [localMidnightUtc(y, m, d - daysAgo), localMidnightUtc(y, m, d - daysAgo + 1)];
}

function localDateString(date) {
  const { y, m, d } = localDateParts(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dedupeKey(job) {
  return job.job_url || `${job.title}-${job.company}`;
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const k = dedupeKey(j);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function latestSessionJobs(db, pipeline) {
  const session = await db.collection("sessions").findOne(
    { pipeline, archived: false },
    { sort: { run_at: -1 } },
  );
  if (!session) return [];
  return db.collection("jobs").find({ session_id: session.session_id }, { projection: PROJECTION }).toArray();
}

async function dayJobs(db, daysAgo) {
  const [start, end] = localDayBoundsUtc(daysAgo);
  const sessions = await db.collection("sessions")
    .find({ pipeline: "standard", archived: false, run_at: { $gte: start, $lt: end } }, { projection: { session_id: 1 } })
    .toArray();
  if (!sessions.length) return [];
  const jobs = await db.collection("jobs")
    .find({ session_id: { $in: sessions.map((s) => s.session_id) } }, { projection: PROJECTION })
    .toArray();
  return dedupe(jobs);
}

async function weekJobs(db) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sessions = await db.collection("sessions")
    .find({ pipeline: "standard", archived: false, run_at: { $gte: cutoff } }, { projection: { session_id: 1, run_at: 1 } })
    .sort({ run_at: 1 })
    .toArray();
  if (!sessions.length) return [];

  const order = new Map(sessions.map((s, i) => [s.session_id, i]));
  const dateOf = new Map(sessions.map((s) => [s.session_id, localDateString(new Date(s.run_at))]));
  const jobs = await db.collection("jobs")
    .find({ session_id: { $in: [...order.keys()] } }, { projection: PROJECTION })
    .toArray();

  // Oldest session first so dedupe keeps each job's first sighting.
  jobs.sort((a, b) => (order.get(a.session_id) ?? 1e9) - (order.get(b.session_id) ?? 1e9));
  const unique = dedupe(jobs).map((j) => ({ ...j, scraped_date: dateOf.get(j.session_id) || "" }));
  unique.sort((a, b) =>
    b.scraped_date.localeCompare(a.scraped_date) || (b.score || 0) - (a.score || 0));
  return unique;
}

export const FEED_TYPES = ["hour", "today", "yesterday", "week", "important"];

export async function fetchFeed(db, type) {
  switch (type) {
    case "hour":      return latestSessionJobs(db, "standard");
    case "important": return latestSessionJobs(db, "important");
    case "today":     return dayJobs(db, 0);
    case "yesterday": return dayJobs(db, 1);
    case "week":      return weekJobs(db);
    default: throw new Error(`unknown feed type "${type}" (expected ${FEED_TYPES.join("|")})`);
  }
}
