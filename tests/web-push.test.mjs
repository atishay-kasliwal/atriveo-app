import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import { validateSubscription, safePushUrl, sendPushNotification, handlePushRoute } from '../scripts/web-push.mjs';
import { inboxPush, deliverEvent } from '../scripts/push-events.mjs';
const subscription = { endpoint: 'https://web.push.apple.com/Qtest', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } };
test('subscription validation prevents SSRF and malformed keys', () => {
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const endpoint of ['http://web.push.apple.com/x', 'https://localhost/x', 'https://web.push.apple.com.evil.test/x', 'https://web.push.apple.com:888/x', 'https://user@web.push.apple.com/x']) assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  assert.throws(() => validateSubscription({ ...subscription, keys: { auth: 'a', p256dh: 'b' } }));
  assert.equal(safePushUrl('//evil.test'), '/'); assert.equal(safePushUrl('/\\evil.test'), '/'); assert.equal(safePushUrl('/outreach?id=1'), '/outreach?id=1');
});
test('delivery scopes subscriptions by user, removes expired only, and never serializes secrets', async () => {
  let query; const deleted = []; const payloads = [];
  const db = { collection: () => ({ find: q => { query = q; return { toArray: async () => [1, 2, 3].map(_id => ({ ...subscription, _id })) }; }, deleteOne: async q => deleted.push(q) }) };
  let calls = 0;
  const result = await sendPushNotification(db, 'a@example.com', { title: 'Hello', url: '//evil.test' }, { env: { VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:a@example.com' }, send: async (_, payload) => { payloads.push(payload); calls++; if (calls > 1) throw { statusCode: calls === 2 ? 410 : 503 }; } });
  assert.deepEqual(query, { userId: 'a@example.com' }); assert.deepEqual(result, { sent: 1, failed: 1 });
  assert.deepEqual(deleted, [{ _id: 2, userId: 'a@example.com' }]); assert.equal(JSON.parse(payloads[0]).url, '/'); assert.ok(!payloads[0].includes('private'));
});
test('push route refuses caller identity without backend secret', async () => {
  let status, body;
  await handlePushRoute({ headers: { 'x-atriveo-push-user': 'b@example.com' } }, { writeHead: s => { status = s; }, end: b => { body = b; } }, '/push/test', () => { throw new Error('must not query'); });
  assert.equal(status, 401); assert.match(body, /Unauthorized/);
});
test('detected events exclude dismissed mail and preserve application links', () => {
  assert.equal(inboxPush({ kind: 'interview', state: 'dismissed' }), null);
  assert.equal(inboxPush({ kind: 'offer', applicationId: 'abc' }).url, '/applied/abc');
});
test('duplicate event claims never send again', async () => {
  let sends = 0;
  const db = { collection: () => ({ updateOne: async () => { throw { code: 11000 }; } }) };
  await deliverEvent(db, 'a', 'event', {}, { send: async () => { sends++; } });
  assert.equal(sends, 0);
});
test('service worker displays fallback push and focuses/navigates existing window or opens one', async () => {
  const handlers = {}; const shown = []; const navigation = []; let windows = [];
  const self = { location: { origin: 'https://apply.atriveo.com' }, addEventListener: (name, fn) => { handlers[name] = fn; }, registration: { showNotification: async (...args) => shown.push(args) }, clients: { matchAll: async () => windows, openWindow: async url => navigation.push(['open', url]) } };
  vm.runInNewContext(fs.readFileSync('apply-public/sw.js', 'utf8'), { self, URL });
  let work;
  handlers.push({ data: { json: () => { throw Error(); } }, waitUntil: p => { work = p; } }); await work; assert.equal(shown[0][0], 'Atriveo');
  const click = url => handlers.notificationclick({ notification: { data: { url }, close() {} }, waitUntil: p => { work = p; } });
  click('https://evil.test'); await work; assert.equal(navigation[0][1], 'https://apply.atriveo.com/');
  windows = [{ url: 'https://apply.atriveo.com/', navigate: async url => navigation.push(['navigate', url]), focus: async () => navigation.push(['focus']) }];
  click('/outreach?id=42'); await work; assert.equal(navigation[1][1], 'https://apply.atriveo.com/outreach?id=42'); assert.equal(navigation[2][0], 'focus');
});
test('Pages push proxy rejects anonymous and cross-origin requests and overrides caller identity', async () => {
  const ts = await import('typescript');
  const source = fs.readFileSync('functions/api/push/[[path]].ts', 'utf8').replace('"../../_lib/admin"', '"./functions/_lib/admin.ts"');
  // Transpile the small route, injecting the existing admin policy for this route's auth-boundary test.
  const compiled = ts.default.transpileModule(source.replace(/import \{ emailAllowed, type AdminEnv \} from .*?;/, 'const emailAllowed = () => true;'), { compilerOptions: { module: ts.default.ModuleKind.ESNext, target: ts.default.ScriptTarget.ES2022 } }).outputText;
  const { onRequest } = await import(`data:text/javascript,${encodeURIComponent(compiled.replace('from "jose"', `from "${new URL('../node_modules/jose/dist/webapi/index.js', import.meta.url).href}"`))}`);
  const { SignJWT } = await import('jose');
  const env = { JWT_SECRET: 'test-secret-for-route', TAILOR_ORIGIN: 'https://relay.test', TAILOR_TOKEN: 'backend-secret' };
  const token = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(env.JWT_SECRET));
  const request = headers => new Request('https://apply.atriveo.com/api/push/test', { method: 'POST', headers, body: '{}' });
  assert.equal((await onRequest({ request: request({ Origin: 'https://apply.atriveo.com', 'Content-Type': 'application/json' }), env })).status, 401);
  assert.equal((await onRequest({ request: request({ Origin: 'https://evil.test', Cookie: `atriveo_token=${token}`, 'Content-Type': 'application/json' }), env })).status, 403);
  assert.equal((await onRequest({ request: new Request('https://apply.atriveo.com/api/push/health'), env })).status, 401);
  const previous = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (_, init) => { forwarded = init; return Response.json({ sent: 1 }); };
  try {
    const health = await onRequest({ request: new Request('https://apply.atriveo.com/api/push/health', { headers: { Authorization: 'Bearer backend-secret' } }), env });
    assert.equal(health.status, 200); assert.equal((await health.json()).upstreamStatus, 200);
    const response = await onRequest({ request: request({ Origin: 'https://apply.atriveo.com', Cookie: `atriveo_token=${token}`, 'Content-Type': 'application/json', 'X-Atriveo-Push-User': 'victim@example.com' }), env });
    assert.equal(response.status, 200); assert.equal(forwarded.headers['X-Atriveo-Push-User'], 'owner@example.com'); assert.ok(!forwarded.headers.Cookie);
    // Cloudflare can return an encoded upstream stream. Its encoding header must
    // survive the relay, or Safari cannot parse the config before subscribing.
    const payload = JSON.stringify({ publicKey: 'test-public-key' });
    globalThis.fetch = async () => new Response(gzipSync(payload), { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' } });
    const compressed = await onRequest({ request: new Request('https://apply.atriveo.com/api/push/config', { headers: { Cookie: `atriveo_token=${token}` } }), env });
    assert.equal(compressed.headers.get('Content-Encoding'), 'gzip');
    assert.equal(compressed.headers.get('Vary'), 'Accept-Encoding');
    assert.equal(compressed.headers.get('Cache-Control'), 'no-store');
    assert.equal(gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString(), payload);
  } finally { globalThis.fetch = previous; }
});
