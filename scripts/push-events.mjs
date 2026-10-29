import { ensurePushIndexes, sendPushNotification } from './web-push.mjs';
import { widgetProgress } from './widget-progress.mjs';
import { listAssessments } from './assessments.mjs';
import { pushSchedule, scheduledPushes } from './push-scheduled.mjs';
import { buildMessage, nyParts, reached, readGoal, streakOf } from './phone-summary.mjs';

export function inboxPush(event) {
  if (!['interview', 'offer'].includes(event.kind) || ['dismissed', 'undone', 'ignored'].includes(event.state)) return null;
  return { title: event.kind === 'offer' ? 'Offer detected' : 'Interview detected', body: 'A new update is available in Atriveo.', type: event.kind, url: event.applicationId ? `/applied/${encodeURIComponent(event.applicationId)}` : '/applied' };
}
export async function deliverEvent(db, userId, id, notification, { now = new Date(), send = sendPushNotification } = {}) {
  const _id = `${userId}:${id}`;
  const deliveries = db.collection('push_deliveries');
  let claim;
  try {
    claim = await deliveries.updateOne({ _id, sentAt: { $exists: false }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] }, { $set: { leaseUntil: new Date(+now + 120000), expiresAt: new Date(+now + 90 * 86400000) } }, { upsert: true });
  } catch (e) { if (e.code === 11000) return; throw e; }
  if (!claim.modifiedCount && !claim.upsertedCount) return;
  const result = await send(db, userId, { ...notification, tag: id });
  // Accepted devices are not repeated when another device has a transient failure.
  if (result.sent || !result.failed) await deliveries.updateOne({ _id }, { $set: { sentAt: now } });
}
export async function pollPushEvents(db, userId, { now = new Date(), send = sendPushNotification } = {}) {
  await ensurePushIndexes(db);
  if (!await db.collection('push_subscriptions').findOne({ userId })) return;
  // Start at opt-in, no historical notification flood. Persist across restarts.
  const stateId = `push-events:${userId}`;
  await db.collection('app_settings').updateOne({ _id: stateId }, { $setOnInsert: { since: now.toISOString() } }, { upsert: true });
  const state = await db.collection('app_settings').findOne({ _id: stateId });
  const since = state.since > new Date(+now - 7 * 86400000).toISOString() ? state.since : new Date(+now - 7 * 86400000).toISOString();
  const events = await db.collection('inbox_events').find({ receivedAt: { $gte: since }, kind: { $in: ['interview', 'offer'] } }).toArray();
  for (const event of events) {
    const notification = inboxPush(event);
    if (notification) await deliverEvent(db, userId, `inbox:${event._id}:${event.kind}`, notification, { now, send });
  }
  const replies = await db.collection('outreach').find({ 'reply.at': { $gte: since } }).toArray();
  for (const record of replies) await deliverEvent(db, userId, `reply:${record._id}`, {
    title: 'Recruiter replied', body: `${String(record.company || 'A recruiter').slice(0, 100)} responded to your outreach.`, type: 'recruiter_reply', url: `/outreach?id=${encodeURIComponent(record._id)}`,
  }, { now, send });
  const [progress, goal] = await Promise.all([widgetProgress(db, { now }), readGoal(db)]);
  // The same milestones as the ntfy messages (first of the day, halfway, goal, twice, four times, personal best, streak), each once a day.
  if (goal > 0) {
    const { hour } = nyParts(now), day = progress.dayKey;
    const history = (progress.days ?? []).map((d) => ({ day: d.day, applied: d.applied }));
    const best = Math.max(0, ...history.filter((d) => d.day !== day).map((d) => d.applied));
    const streak = streakOf(history, day, goal, progress.appliedToday, { includeToday: true });
    const ctx = { day, applied: progress.appliedToday, goal, best, streak };
    // "goal" keeps the id the goal push always had, so a day that already had it is not sent it again.
    const idOf = (k) => `${k === "m1" ? "goal" : k}:${day}`, push = (k) => { const m = buildMessage(k, ctx); return { title: m.title, body: m.message, url: '/job-matching', type: k === "m1" ? 'daily_goal' : `progress_${k}` }; };
    const r = hour >= 7 && hour < 23 ? reached(ctx) : { tiers: [], extra: [] }, extra = r.extra;
    const tiers = hour < 19 ? r.tiers : r.tiers.filter((k) => k.startsWith("m"));
    for (const k of tiers.slice(0, -1)) await db.collection('push_deliveries').updateOne({ _id: `${userId}:${idOf(k)}` }, { $setOnInsert: { sentAt: now, silent: true, expiresAt: new Date(+now + 90 * 86400000) } }, { upsert: true });
    for (const k of [...tiers.slice(-1), ...extra]) await deliverEvent(db, userId, idOf(k), push(k), { now, send });
  }
  const schedule = pushSchedule(now);
  const [assessments, dailyReplies] = await Promise.all([
    schedule.assessmentStage ? listAssessments(db, { now: +now }) : [],
    schedule.summary ? db.collection('outreach').find({ 'reply.at': { $gte: new Date(+now - 48 * 3600000).toISOString() } }, { projection: { 'reply.at': 1 } }).toArray() : [],
  ]);
  for (const { id, notification } of scheduledPushes({ now, assessments, progress, replies: dailyReplies })) await deliverEvent(db, userId, id, notification, { now, send });
}
export function startPushEvents({ withMongo, log }) {
  const userId = process.env.PUSH_EVENT_USER_ID?.trim().toLowerCase();
  if (!userId || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_SUBJECT || !process.env.MONGO_URI) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await withMongo(db => pollPushEvents(db, userId)); }
    catch { log('Web Push event delivery failed; will retry next minute.'); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 60000); timer.unref(); void tick();
}
