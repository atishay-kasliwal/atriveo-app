import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import * as L from '../../scripts/loops.mjs';
import { validateExtraction } from '../../scripts/loops-schema.mjs';
import { handleLoops } from '../../scripts/loops-routes.mjs';
import { processOne, workerClient } from '../../scripts/loops-mac-worker.mjs';

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const U = 'me@example.com';
const T0 = new Date('2026-10-30T15:00:00Z'); // 11:00 in New York
const at = (hours, from = T0) => new Date(+from + hours * 3_600_000);
const good = (over = {}) => ({
  summary: 'Reach out to Sarah about the NVIDIA Software Engineer position', company: 'NVIDIA', position: 'Software Engineer', person: 'Sarah',
  intent: 'Ask for help with the application', action_type: 'outreach',
  tasks: [{ title: 'Message Sarah about the NVIDIA role', description: 'Ask if she can help with the application', priority: 'high' }],
  context: ['Met Sarah at All Things Open', 'Recently graduated'], deadline: null, suggested_reminder_hours: null, ...over,
});
let mongo, client, db, n = 0;
const id = () => `cap_${String(++n).padStart(6, '0')}`;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client.close(); await mongo.stop(); });
beforeEach(async () => { db = client.db(`t${n}x${Date.now()}`); await L.ensureLoopsIndexes(db); });
const status = async (cid) => (await db.collection('captures').findOne({ _id: cid })).status;
/** A text capture taken all the way to NEEDS_REVIEW through the worker calls. */
async function reviewed(over = {}, text = 'I should message Sarah about the NVIDIA role') {
  const cid = id();
  await L.captureText(db, U, { id: cid, text }, T0);
  const { capture } = await L.claimCapture(db, 'mac', T0);
  await L.completeCapture(db, { id: capture.id, token: capture.token, result: good(over) }, T0);
  return cid;
}
const sender = () => { const sent = []; const send = async (_db, user, note) => { sent.push({ user, note }); return { sent: 1, failed: 0 }; }; return { sent, send }; };

test('a typed thought is saved at once and waits for the Mac; the same id twice is one capture', async () => {
  const cid = id();
  const a = await L.captureText(db, U, { id: cid, text: '  I found a backend role at Stripe  ' }, T0);
  assert.equal(a.capture.status, 'WAITING_FOR_CODEX');
  assert.equal(a.capture.inputType, 'TEXT');
  assert.equal(a.capture.text, 'I found a backend role at Stripe');
  const b = await L.captureText(db, U, { id: cid, text: 'a retried upload' }, at(1));
  assert.equal(b.existed, true);
  assert.equal(await db.collection('captures').countDocuments(), 1);
  assert.equal((await L.getCapture(db, U, cid)).capture.text, 'I found a backend role at Stripe', 'the original is never overwritten');
  await assert.rejects(L.captureText(db, U, { id: id(), text: '   ' }), L.LoopsError);
  await assert.rejects(L.captureText(db, U, { id: 'x', text: 'hi' }), L.LoopsError);
});

test('a recording is saved before anything can fail, and a failed transcription keeps it', async () => {
  const cid = id();
  const bytes = Buffer.from('fake-opus-bytes');
  await assert.rejects(L.captureAudio(db, U, { id: id(), bytes, mime: 'text/plain' }), L.LoopsError);
  const { capture } = await L.captureAudio(db, U, { id: cid, bytes, mime: 'audio/webm;codecs=opus', durationMs: 47_000 }, T0);
  assert.equal(capture.status, 'RECORDED');
  assert.equal(capture.audio.durationMs, 47_000);
  // No provider configured yet: the recording just waits.
  assert.deepEqual(await L.transcribePending(db, null), { done: 0, failed: 0 });
  assert.equal(await status(cid), 'RECORDED');
  // A provider that fails: FAILED with the audio still there.
  await L.transcribePending(db, { name: 'broken', transcribe: async () => { throw new Error('model missing'); } }, { now: T0 });
  assert.equal(await status(cid), 'FAILED');
  assert.equal((await db.collection('captures').findOne({ _id: cid })).error.stage, 'transcribe');
  const audio = await L.readAudio(db, U, cid);
  const chunks = []; for await (const c of audio.stream()) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), 'fake-opus-bytes');
  // Retry → transcribed → the same pipeline as text.
  await L.retryCapture(db, U, cid, T0);
  assert.equal(await status(cid), 'RECORDED');
  await L.transcribePending(db, { name: 'fake', transcribe: async (buf) => `heard ${buf.length} bytes` }, { now: T0 });
  assert.equal(await status(cid), 'WAITING_FOR_CODEX');
  assert.equal((await db.collection('captures').findOne({ _id: cid })).transcript, 'heard 15 bytes');
  // Typing the transcript yourself works too (recording stays).
  const other = id();
  await L.captureAudio(db, U, { id: other, bytes, mime: 'audio/mp4', durationMs: 1000 }, T0);
  await L.setTranscript(db, U, other, 'I typed what I said', T0);
  assert.equal(await status(other), 'WAITING_FOR_CODEX');
  await assert.rejects(L.setTranscript(db, U, other, 'again'), L.LoopsError);
});

test('Mac offline: captures wait, nothing is lost, and the worker is shown as last seen', async () => {
  const cid = id();
  await L.captureText(db, U, { id: cid, text: 'remind me to ask David' }, T0);
  assert.equal((await L.loopsSummary(db, U, { now: at(5) })).counts.WAITING, 1);
  assert.equal((await L.loopsSummary(db, U)).worker.lastSeenAt, null);
  await L.claimCapture(db, 'mac', at(5));
  assert.equal(+(await L.loopsSummary(db, U)).worker.lastSeenAt, +at(5));
});

test('two workers never hold one capture; an expired lease returns it; too many expiries fail it', async () => {
  const cid = id();
  await L.captureText(db, U, { id: cid, text: 'thought' }, T0);
  const [a, b] = await Promise.all([L.claimCapture(db, 'mac-1', T0), L.claimCapture(db, 'mac-2', T0)]);
  assert.equal([a, b].filter((x) => x.capture).length, 1);
  const held = (a.capture ?? b.capture);
  // Not expired yet: nobody else gets it.
  assert.equal((await L.claimCapture(db, 'mac-3', at(0.01))).capture, null);
  // A heartbeat extends the lease.
  assert.equal((await L.heartbeat(db, { id: held.id, token: held.token, workerId: 'x' }, at(0.03))).held, true);
  assert.equal((await L.claimCapture(db, 'mac-3', at(0.05))).capture, null);
  // The Mac sleeps: after the lease, it is claimable again (attempt 2), then 3, then it fails instead of looping forever.
  const second = await L.claimCapture(db, 'mac-3', at(1));
  assert.equal(second.capture.attempt, 2);
  const third = await L.claimCapture(db, 'mac-3', at(2));
  assert.equal(third.capture.attempt, 3);
  assert.equal((await L.claimCapture(db, 'mac-3', at(3))).capture, null);
  assert.equal(await status(cid), 'FAILED');
  // A stale holder cannot finish it, and you can retry it.
  await assert.rejects(L.completeCapture(db, { id: cid, token: held.token, result: good() }), L.LoopsError);
  await L.retryCapture(db, U, cid, at(3));
  assert.equal(await status(cid), 'WAITING_FOR_CODEX');
});

test('Codex failing is retried with a pause, then marked failed; the capture is never lost', async () => {
  const cid = id();
  await L.captureText(db, U, { id: cid, text: 'thought' }, T0);
  let { capture } = await L.claimCapture(db, 'mac', T0);
  assert.deepEqual(await L.failCapture(db, { id: cid, token: capture.token, error: 'codex crashed' }, T0), { ok: true, retrying: true });
  assert.equal(await status(cid), 'WAITING_FOR_CODEX');
  assert.equal((await L.claimCapture(db, 'mac', at(0.01))).capture, null, 'it waits before the next try');
  ({ capture } = await L.claimCapture(db, 'mac', at(1)));
  await L.failCapture(db, { id: cid, token: capture.token, error: 'again' }, at(1));
  ({ capture } = await L.claimCapture(db, 'mac', at(2)));
  assert.equal((await L.failCapture(db, { id: cid, token: capture.token, error: 'third' }, at(2))).retrying, false);
  assert.equal(await status(cid), 'FAILED');
  assert.equal((await L.getCapture(db, U, cid)).capture.text, 'thought');
});

test('malformed Codex output activates nothing and goes back for another try', async () => {
  for (const bad of [null, 'text', {}, good({ action_type: 'dance' }), good({ summary: '' }), good({ tasks: [{ title: 'x', priority: 'urgent' }] }), good({ suggested_reminder_hours: 0 }), good({ tasks: 'none' })]) {
    assert.throws(() => validateExtraction(bad));
  }
  const cid = id();
  await L.captureText(db, U, { id: cid, text: 'thought' }, T0);
  const { capture } = await L.claimCapture(db, 'mac', T0);
  const r = await L.completeCapture(db, { id: cid, token: capture.token, result: { summary: 'x' } }, T0);
  assert.equal(r.retrying, true);
  const doc = await db.collection('captures').findOne({ _id: cid });
  assert.equal(doc.status, 'WAITING_FOR_CODEX');
  assert.equal(doc.structured, null);
  assert.equal(doc.reminder.nextAt, null);
  assert.ok((await L.getCapture(db, U, cid)).events.some((e) => e.type === 'malformed'));
});

test('a good reading goes to review, not to reminders; the same answer sent twice is harmless', async () => {
  const cid = id();
  await L.captureText(db, U, { id: cid, text: 'thought' }, T0);
  const { capture } = await L.claimCapture(db, 'mac', T0);
  await L.completeCapture(db, { id: cid, token: capture.token, result: good() }, T0);
  assert.deepEqual(await L.completeCapture(db, { id: cid, token: capture.token, result: good() }, T0), { ok: true, duplicate: true });
  const c = (await L.getCapture(db, U, cid)).capture;
  assert.equal(c.status, 'NEEDS_REVIEW');
  assert.equal(c.view.company, 'NVIDIA');
  assert.equal(c.tasks.length, 1);
  assert.equal(c.reminder.nextAt, null, 'nothing is scheduled before you confirm');
  const { sent, send } = sender();
  await L.tickReminders(db, U, { now: at(48), send });
  assert.equal(sent.length, 0);
});

test('review: correct, confirm, and the original reading and your changes both stay', async () => {
  const cid = await reviewed();
  await assert.rejects(L.confirmCapture(db, U, cid, {}, T0).then(() => L.confirmCapture(db, U, cid, {}, T0)), L.LoopsError, 'cannot confirm twice');
  const c2 = await reviewed({ tasks: [] });
  await assert.rejects(L.confirmCapture(db, U, c2, {}, T0), /at least one/);
  await L.editCapture(db, U, c2, { person: 'Sarah Chen', tasks: [{ title: 'Message Sarah', priority: 'high' }], reminderHours: 4 }, T0);
  const edited = await L.getCapture(db, U, c2);
  assert.equal(edited.capture.view.person, 'Sarah Chen');
  assert.equal(edited.capture.structured.person, 'Sarah', 'the reading is a separate layer');
  const change = edited.events.find((e) => e.type === 'edited').data;
  assert.deepEqual(change.person, { from: 'Sarah', to: 'Sarah Chen' });
  await L.confirmCapture(db, U, c2, {}, T0);
  const live = (await L.getCapture(db, U, c2)).capture;
  assert.equal(live.status, 'ACTIVE');
  assert.equal(live.reminder.intervalHours, 4);
  assert.equal(+new Date(live.reminder.nextAt), +at(4));
});

test('reminders: due ones are sent once, nextAt advances from the last reminder, nothing is pre-created', async () => {
  const cid = await reviewed();
  await L.confirmCapture(db, U, cid, {}, T0); // 11:00 + 6h = 17:00
  const { sent, send } = sender();
  assert.equal((await L.tickReminders(db, U, { now: at(5.9), send })).sent, 0);
  const [a, b] = await Promise.all([L.tickReminders(db, U, { now: at(6.1), send }), L.tickReminders(db, U, { now: at(6.1), send })]);
  assert.equal(a.sent + b.sent, 1, 'two ticks at once send it once');
  assert.equal(sent[0].note.url, `/loops?id=${cid}`);
  assert.match(sent[0].note.body, /Message Sarah about the NVIDIA role/);
  assert.match(sent[0].note.body, /NVIDIA · Software Engineer/);
  const c = (await L.getCapture(db, U, cid)).capture;
  assert.equal(c.status, 'ACTIVE', 'ignoring it keeps it alive');
  assert.equal(+new Date(c.reminder.lastAt), +at(6.1));
  // 17:06 + 6h = 23:06 New York is inside quiet hours, so the next one is the next morning at 8 (12:06Z).
  assert.equal(+new Date(c.reminder.nextAt), +at(21.1), "8:06: the first quarter hour after quiet hours, keeping its minute");
});

test('quiet hours: nothing is sent overnight, and it goes out at 8 am', async () => {
  const cid = await reviewed();
  await L.confirmCapture(db, U, cid, { reminderHours: 6 }, new Date('2026-10-30T20:00:00Z')); // 4 pm → 10 pm = quiet
  const doc = await db.collection('captures').findOne({ _id: cid });
  assert.equal(doc.reminder.nextAt.toISOString(), '2026-10-31T12:00:00.000Z', '8:00 in New York');
  const { sent, send } = sender();
  assert.equal((await L.tickReminders(db, U, { now: new Date('2026-10-31T06:00:00Z'), send })).sent, 0);
  assert.equal((await L.tickReminders(db, U, { now: new Date('2026-10-31T12:01:00Z'), send })).sent, 1);
});

test('snooze moves the next reminder; done stops reminders for good', async () => {
  const cid = await reviewed();
  await L.confirmCapture(db, U, cid, {}, T0);
  const { sent, send } = sender();
  await L.snoozeCapture(db, U, cid, { hours: 2 }, at(1));
  assert.equal(await status(cid), 'SNOOZED');
  assert.equal((await L.tickReminders(db, U, { now: at(2), send })).sent, 0);
  assert.equal((await L.tickReminders(db, U, { now: at(3.1), send })).sent, 1);
  assert.equal(await status(cid), 'ACTIVE');
  await L.doneCapture(db, U, cid, {}, at(3.2));
  const c = (await L.getCapture(db, U, cid)).capture;
  assert.equal(c.status, 'COMPLETED');
  assert.ok(c.tasks.every((t) => t.done));
  assert.equal(c.reminder.nextAt, null);
  assert.equal((await L.tickReminders(db, U, { now: at(100), send })).sent, 0);
  await assert.rejects(L.snoozeCapture(db, U, cid, { hours: 1 }), L.LoopsError);
  // Dismissed ones stay quiet too.
  const d = await reviewed();
  await L.confirmCapture(db, U, d, {}, T0);
  await L.dismissCapture(db, U, d, at(1));
  assert.equal((await L.tickReminders(db, U, { now: at(100), send })).sent, 0);
});

test('a capture with several tasks completes with its last one', async () => {
  const cid = await reviewed({ tasks: [{ title: 'A', description: null, priority: 'high' }, { title: 'B', description: null, priority: 'low' }] });
  await L.confirmCapture(db, U, cid, {}, T0);
  await L.doneCapture(db, U, cid, { taskId: 't1' }, at(1));
  assert.equal(await status(cid), 'ACTIVE');
  await L.doneCapture(db, U, cid, { taskId: 't2' }, at(2));
  assert.equal(await status(cid), 'COMPLETED');
});

test('a failed push is recorded and retried in five minutes; no device is a skip, not a failure', async () => {
  const cid = await reviewed();
  await L.confirmCapture(db, U, cid, {}, T0);
  const failing = async () => ({ sent: 0, failed: 1 });
  assert.equal((await L.tickReminders(db, U, { now: at(6.1), send: failing })).failed, 1);
  let c = (await L.getCapture(db, U, cid));
  assert.equal(+new Date(c.capture.reminder.nextAt), +at(6.1) + 5 * 60_000);
  assert.ok(c.events.some((e) => e.type === 'reminder_failed'));
  const throwing = async () => { throw new Error('Web Push is not configured'); };
  assert.equal((await L.tickReminders(db, U, { now: at(6.2), send: throwing })).failed, 1);
  const none = async () => ({ sent: 0, failed: 0 });
  assert.equal((await L.tickReminders(db, U, { now: at(6.4), send: none })).failed, 0);
  c = await L.getCapture(db, U, cid);
  assert.ok(c.events.some((e) => e.type === 'reminder_skipped'));
});

test('entities: linked only when sure, candidates when not, nothing is ever created', async () => {
  await db.collection('network_sources').insertMany([{ _id: 's1', type: 'company', name: 'NVIDIA' }]);
  await db.collection('network_people').insertMany([
    { _id: 'p1', name: 'Sarah Chen', company: 'NVIDIA' }, { _id: 'p2', name: 'Sarah Lopez', company: 'Stripe' }, { _id: 'p3', name: 'David Kim', company: 'Stripe' }, { _id: 'p4', name: 'David Park', company: 'Stripe' },
  ]);
  await db.collection('jobs').insertMany([{ job_url: 'https://x/1', title: 'Software Engineer', company: 'NVIDIA, Inc.' }, { job_url: 'https://x/2', title: 'Software Engineer, Infra', company: 'NVIDIA' }, { job_url: 'https://x/3', title: 'Chef', company: 'NVIDIA' }]);
  const cid = await reviewed();
  const links = (await L.getCapture(db, U, cid)).capture.links;
  assert.equal(links.linked.sourceId, 's1');
  assert.equal(links.linked.personId, 'p1', 'Sarah at NVIDIA is the one Sarah who works there');
  assert.equal(links.linked.jobUrl, undefined, 'two Software Engineer jobs: you choose');
  assert.equal(links.candidates.jobs.length, 2);
  const amb = await reviewed({ company: 'Stripe', person: 'David', position: null });
  const l2 = (await L.getCapture(db, U, amb)).capture.links;
  assert.equal(l2.linked.personId, undefined);
  assert.equal(l2.candidates.people.length, 2);
  await assert.rejects(L.editCapture(db, U, amb, { link: { personId: 'p1' } }), /not one of the matches/);
  await L.editCapture(db, U, amb, { link: { personId: 'p3' } });
  assert.equal((await L.getCapture(db, U, amb)).capture.links.linked.personId, 'p3');
  assert.equal(await db.collection('network_people').countDocuments(), 4);
});

test('search finds a company across captures; other users see nothing', async () => {
  await reviewed();
  await reviewed({ company: 'Stripe', person: 'David', summary: 'Ask David at Stripe', tasks: [{ title: 'Message David', description: null, priority: 'medium' }] }, 'Ask David about the backend role');
  assert.equal((await L.listCaptures(db, U, { q: 'nvidia' })).captures.length, 1);
  assert.equal((await L.listCaptures(db, U, { q: 'sarah nvidia' })).captures.length, 1);
  assert.equal((await L.listCaptures(db, U, { q: 'stripe', section: 'NEEDS_REVIEW' })).captures.length, 1);
  assert.equal((await L.listCaptures(db, 'other@example.com', { q: 'nvidia' })).captures.length, 0);
  assert.equal((await L.listCaptures(db, U, { q: '.*' })).captures.length, 0, 'search text is never a pattern');
  await assert.rejects(L.getCapture(db, 'other@example.com', (await L.listCaptures(db, U, {})).captures[0].id), L.LoopsError);
});

test('end to end over HTTP: type, Mac reads it, review, confirm; voice upload and range playback; auth required', async () => {
  const server = http.createServer((req, res) => void handleLoops(req, res, new URL(req.url, 'http://x'), { withDb: (fn) => fn(db) }).then((hit) => { if (!hit) { res.writeHead(404); res.end(); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body, headers = { 'X-Atriveo-User': U }) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try {
    assert.equal((await api('GET', '/loops/summary', undefined, {})).status, 401);
    const cid = id();
    assert.equal((await api('POST', '/loops/capture', { id: cid, text: 'Stripe backend role, David from ATO, keep reminding me' })).json.capture.status, 'WAITING_FOR_CODEX');
    // The Mac worker: outbound calls with the token only (no user header).
    const call = workerClient({ base, token: 'unused', workerId: 'test-mac' });
    const { capture } = await call('claim');
    assert.equal(capture.id, cid);
    assert.equal(await processOne(capture, { call, generate: async (provider, request) => { assert.match(request.user, /Stripe backend role/); assert.equal(request.schema.additionalProperties, false); return good({ company: 'Stripe', person: 'David' }); } }), 'completed');
    assert.equal((await api('GET', `/loops/${cid}`)).json.capture.status, 'NEEDS_REVIEW');
    // Codex fails on the next one: it is returned for a retry, not lost.
    const c2 = id();
    await api('POST', '/loops/capture', { id: c2, text: 'another thought' });
    const second = (await call('claim')).capture;
    assert.equal(await processOne(second, { call, generate: async () => { throw new Error('codex is signed out'); } }), 'failed');
    assert.equal(await status(c2), 'WAITING_FOR_CODEX');
    assert.equal((await api('POST', `/loops/${cid}/confirm`, { reminderHours: 3 })).json.capture.status, 'ACTIVE');
    assert.equal((await api('POST', `/loops/${cid}/snooze`, { hours: 2 })).json.capture.status, 'SNOOZED');
    assert.equal((await api('POST', `/loops/${cid}/confirm`, {})).status, 409);
    assert.equal((await api('POST', '/loops/worker/bogus', {}, {})).status, 404);
    // Voice: raw bytes in, range reads out.
    const v = id();
    const up = await fetch(`${base}/loops/capture/audio?id=${v}&durationMs=47000`, { method: 'POST', headers: { 'Content-Type': 'audio/webm', 'X-Atriveo-User': U }, body: Buffer.from('0123456789') });
    assert.equal((await up.json()).capture.status, 'RECORDED');
    const part = await fetch(`${base}/loops/${v}/audio`, { headers: { 'X-Atriveo-User': U, Range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '2345');
    assert.equal((await fetch(`${base}/loops/${v}/audio`, { headers: { 'X-Atriveo-User': 'other@example.com' } })).status, 404);
    assert.equal((await api('GET', '/loops?section=NEEDS_ACTION')).json.captures.length, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

test('reminders carry Done and Snooze buttons and the capture id for the service worker', async () => {
  const cid = await reviewed();
  await L.confirmCapture(db, U, cid, {}, T0);
  const { sent, send } = sender();
  await L.tickReminders(db, U, { now: at(6.1), send });
  assert.deepEqual(sent[0].note.actions, [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 6h' }]);
  assert.deepEqual(sent[0].note.data, { loopId: cid });
  const { safeActions } = await import('../../scripts/web-push.mjs');
  assert.deepEqual(safeActions([{ action: 'done', title: ' Done ' }, { action: 'BAD!', title: 'x' }, { action: 'open', title: '' }, null]), [{ action: 'done', title: 'Done' }]);
  assert.equal(safeActions('nope'), undefined);
  assert.equal(safeActions([]), undefined);
});

test('links resolve to names, and a person or company shows its related thoughts (counts + latest)', async () => {
  await db.collection('network_sources').insertOne({ _id: 's1', type: 'company', name: 'NVIDIA' });
  await db.collection('network_people').insertOne({ _id: 'p1', name: 'Sarah Chen', company: 'NVIDIA' });
  const a = await reviewed();
  const b = await reviewed({}, 'a second thought about Sarah');
  const c = await reviewed({ company: 'Stripe', person: 'Nobody' }, 'unrelated');
  await L.confirmCapture(db, U, a, {}, T0);
  await L.confirmCapture(db, U, b, {}, T0);
  await L.doneCapture(db, U, b, {}, at(1));
  const story = await L.getCapture(db, U, a);
  assert.equal(story.linked.person.name, 'Sarah Chen');
  assert.equal(story.linked.company.name, 'NVIDIA');
  assert.equal((await L.getCapture(db, U, c)).linked.person, undefined);
  const rel = (await L.relatedLoops(db, U, { personId: 'p1' })).related;
  assert.deepEqual([rel.total, rel.open, rel.completed], [2, 1, 1]);
  assert.equal(rel.latest.length, 2);
  assert.equal((await L.relatedLoops(db, U, { sourceId: 's1' })).related.total, 2);
  assert.equal((await L.relatedLoops(db, 'other@example.com', { personId: 'p1' })).related.total, 0, 'only your own thoughts');
  await assert.rejects(L.relatedLoops(db, U, {}), L.LoopsError);
});
