import { ensurePushIndexes, sendPushNotification } from './web-push.mjs';
import { widgetProgress } from './widget-progress.mjs';
import { readGoal } from './phone-summary.mjs';

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
  if (progress.appliedToday >= goal) await deliverEvent(db, userId, `goal:${progress.dayKey}`, { title: 'Daily application goal reached', body: `You reached your goal of ${goal} applications today.`, url: '/job-matching', type: 'daily_goal' }, { now, send });
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
