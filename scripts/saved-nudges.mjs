import { postingKey } from './staffing-workspace.mjs';

// A job you save (Later in Matching, swipe right on the phone, Saved in Staffing) is nudged 3, 6 and 13 hours later
// until you apply. Each nudge is its own push, sent at most once; applied, skipped, passed or undone jobs get none.
export const NUDGE_HOURS = [3, 6, 13];
const HOUR = 3_600_000;
// A nudge missed while the server was down is still sent this long after the last mark, never later.
const LATE_MS = 3 * HOUR;
const BODY = {
  3: 'Saved 3 hours ago. Apply now.',
  6: 'Still not applied, 6 hours since you saved it.',
  13: 'Last reminder: saved 13 hours ago.',
};
const keyOf = (u) => { try { return postingKey(u); } catch { return ''; } };
const shortId = (u) => keyOf(u).slice(0, 16) || 'job';

/** The saves still waiting (not applied, skipped, passed or undone), each with the latest nudge that is due now. */
export async function dueSavedNudges(db, { since, now = new Date() } = {}) {
  const from = new Date(Math.max(Date.parse(since) || +now, +now - (NUDGE_HOURS.at(-1) * HOUR + LATE_MS)));
  const [matching, staffing] = await Promise.all([
    db.collection('job_swipes').find({ direction: 'later', swiped_at: { $gte: from.toISOString() } }, { projection: { _id: 0, job_url: 1, swiped_at: 1 } }).toArray(),
    db.collection('staffing_decisions').find({ state: 'saved', updated_at: { $gte: from } }, { projection: { job_url: 1, updated_at: 1 } }).toArray(),
  ]);
  const saves = [
    ...matching.map((s) => ({ source: 'matching', url: s.job_url, savedAt: new Date(s.swiped_at) })),
    ...staffing.filter((s) => s.job_url).map((s) => ({ source: 'staffing', url: s.job_url, savedAt: new Date(s.updated_at) })),
  ].filter((s) => /^https?:\/\//.test(String(s.url)) && !Number.isNaN(+s.savedAt));
  if (!saves.length) return [];
  const urls = saves.map((s) => s.url);
  const [applications, swipes] = await Promise.all([
    db.collection('applications').find({ status: 'APPLIED', $or: [{ jobUrls: { $in: urls } }, { url: { $in: urls } }] }, { projection: { url: 1, jobUrls: 1 } }).toArray(),
    db.collection('job_swipes').find({ job_url: { $in: urls }, direction: 'applied' }, { projection: { _id: 0, job_url: 1 } }).toArray(),
  ]);
  const applied = new Set([...applications.flatMap((a) => [a.url, ...(a.jobUrls || [])]), ...swipes.map((s) => s.job_url)].filter(Boolean).map(keyOf));
  const out = [];
  for (const s of saves) {
    if (applied.has(keyOf(s.url))) continue;
    const due = NUDGE_HOURS.filter((h) => +s.savedAt + h * HOUR <= +now);
    if (!due.length || +now - (+s.savedAt + due.at(-1) * HOUR) > LATE_MS) continue;
    out.push({ ...s, hour: due.at(-1), earlier: due.slice(0, -1) });
  }
  return out;
}

const nudgeId = (s, h) => `saved:${s.source}:${shortId(s.url)}:${s.savedAt.toISOString()}:${h}`;

/** Sends the nudges that are due; called from the push poll every minute. Saves made before the first run are left alone. */
export async function tickSavedNudges(db, userId, { now = new Date(), deliver } = {}) {
  const stateId = `saved-nudges:${userId}`;
  await db.collection('app_settings').updateOne({ _id: stateId }, { $setOnInsert: { since: now.toISOString() } }, { upsert: true });
  const { since } = await db.collection('app_settings').findOne({ _id: stateId });
  const due = await dueSavedNudges(db, { since, now });
  if (!due.length) return 0;
  const urls = due.map((s) => s.url);
  const [jobs, staffingJobs] = await Promise.all([
    db.collection('jobs').find({ job_url: { $in: urls } }, { projection: { _id: 0, job_url: 1, company: 1, title: 1 } }).toArray(),
    db.collection('staffing_jobs').find({ job_url: { $in: urls } }, { projection: { job_url: 1, company: 1, title: 1 } }).toArray(),
  ]);
  const info = new Map([...jobs, ...staffingJobs].map((j) => [j.job_url, j]));
  let sent = 0;
  for (const s of due) {
    // A mark already passed (the server was down for it) is recorded as done without a push, so only the latest is sent.
    for (const h of s.earlier) await db.collection('push_deliveries').updateOne({ _id: `${userId}:${nudgeId(s, h)}` }, { $setOnInsert: { sentAt: now, silent: true, expiresAt: new Date(+now + 90 * 86400000) } }, { upsert: true });
    const job = info.get(s.url) || {};
    const staffingId = s.source === 'staffing' ? String(staffingJobs.find((j) => j.job_url === s.url)?._id || '') : '';
    const title = [job.company, job.title].map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ') || 'A saved job';
    await deliver(nudgeId(s, s.hour), {
      title: title.slice(0, 120), body: BODY[s.hour], type: 'saved_nudge',
      url: s.source === 'staffing' ? '/staffing?view=saved' : '/job-matching?saved=1',
      data: { savedJob: { source: s.source, jobUrl: s.url, ...(staffingId ? { staffingId } : {}) } },
      actions: [{ action: 'applied', title: 'I applied' }, { action: 'skip', title: 'Not applying' }],
    });
    sent++;
  }
  return sent;
}
