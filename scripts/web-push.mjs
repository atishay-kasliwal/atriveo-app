import webpush from 'web-push';

// Limit outbound requests to known browser push services; never fetch arbitrary subscriber URLs.
export function validateSubscription(value) {
  const endpoint = value?.endpoint;
  if (typeof endpoint !== 'string') throw new Error('Invalid subscription endpoint');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid subscription endpoint'); }
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || endpoint.length > 4096) throw new Error('Unsupported push endpoint');
  const keys = value?.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth) || Buffer.from(keys.p256dh, 'base64url')[0] !== 4) throw new Error('Invalid subscription keys');
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
/** Notification action buttons: up to three { action, title }, plain short strings (the service worker decides what each does). */
export function safeActions(value) {
  if (!Array.isArray(value)) return undefined;
  const list = value.slice(0, 3).filter(a => a && /^[a-z-]{1,20}$/.test(String(a.action)) && String(a.title || '').trim()).map(a => ({ action: String(a.action), title: String(a.title).trim().slice(0, 30) }));
  return list.length ? list : undefined;
}
export function safePushUrl(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value.slice(0, 1500) : '/';
}
export async function ensurePushIndexes(db) {
  await db.collection('push_subscriptions').createIndex({ endpoint: 1 }, { unique: true });
  await db.collection('push_subscriptions').createIndex({ userId: 1 });
  await db.collection('push_deliveries').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
export async function saveSubscription(db, userId, input) {
  const sub = validateSubscription(input);
  // Endpoint ownership cannot be silently transferred between signed-in accounts.
  try {
    await db.collection('push_subscriptions').updateOne({ endpoint: sub.endpoint, userId }, {
      $set: { keys: sub.keys, updatedAt: new Date() }, $setOnInsert: { userId, endpoint: sub.endpoint, createdAt: new Date() },
    }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Two tabs can subscribe concurrently. Retry only if the existing owner matches.
    const result = await db.collection('push_subscriptions').updateOne({ endpoint: sub.endpoint, userId }, { $set: { keys: sub.keys, updatedAt: new Date() } });
    if (!result.matchedCount) throw error;
  }
}
/** Provider-independent application entry point. Only this module knows Web Push. */
export async function sendPushNotification(db, userId, notification, { env = process.env, send = webpush.sendNotification } = {}) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error('Web Push is not configured');
  const payload = JSON.stringify({ title: String(notification.title || 'Atriveo').slice(0, 120), body: String(notification.body || '').slice(0, 500), url: safePushUrl(notification.url), type: String(notification.type || '').slice(0, 80), data: notification.data, tag: notification.tag, actions: safeActions(notification.actions) });
  if (Buffer.byteLength(payload) > 3000) throw new Error('Notification too large');
  const subs = await db.collection('push_subscriptions').find({ userId }).toArray();
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async sub => {
    try {
      validateSubscription(sub);
      await send({ endpoint: sub.endpoint, keys: sub.keys }, payload, { vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }, TTL: 3600, timeout: 10000 });
      sent++;
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) await db.collection('push_subscriptions').deleteOne({ _id: sub._id, userId });
      else failed++;
    }
  }));
  return { sent, failed };
}
export async function handlePushRoute(req, res, pathname, withMongo) {
  if (!pathname.startsWith('/push/')) return false;
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const userId = req.headers['x-atriveo-push-user'];
  if (!process.env.TAILOR_TOKEN || req.headers['x-tailor-token'] !== process.env.TAILOR_TOKEN || typeof userId !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(userId)) { json(401, { error: 'Unauthorized' }); return true; }
  try {
    if (pathname === '/push/config' && req.method === 'GET') {
      json(200, { publicKey: process.env.VAPID_PUBLIC_KEY || null }); return true;
    }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 8192) { json(413, { error: 'Payload too large' }); return true; } }
    const body = JSON.parse(raw || '{}');
    await withMongo(async db => {
      await ensurePushIndexes(db);
      if (pathname === '/push/subscription' && req.method === 'POST') { await saveSubscription(db, userId, body); json(200, { ok: true }); }
      else if (pathname === '/push/subscription' && req.method === 'DELETE') { if (typeof body.endpoint !== 'string') throw new Error('Endpoint required'); await db.collection('push_subscriptions').deleteOne({ endpoint: body.endpoint, userId }); json(200, { ok: true }); }
      else if (pathname === '/push/test' && req.method === 'POST') {
        const claim = await db.collection('push_deliveries').updateOne({ _id: `test:${userId}:${Math.floor(Date.now() / 30000)}` }, { $setOnInsert: { expiresAt: new Date(Date.now() + 60000) } }, { upsert: true });
        if (!claim.upsertedCount) { json(429, { error: 'Please wait 30 seconds before another test' }); return; }
        json(200, await sendPushNotification(db, userId, { title: 'Atriveo', body: 'Push notifications are working 🎉', url: '/settings', type: 'test' }));
      } else json(405, { error: 'Method not allowed' });
    });
  } catch (err) { json(err.code === 11000 ? 409 : 400, { error: err.code === 11000 ? 'This subscription belongs to another account. Disable notifications there first.' : 'Could not process push request. Check configuration and subscription.' }); }
  return true;
}
