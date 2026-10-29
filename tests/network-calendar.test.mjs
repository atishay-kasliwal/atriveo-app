import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { listIntelligence, intelligenceAction } from '../scripts/network-intelligence.mjs';
import { listEvents, markEventDone, removeEvent, saveEvent } from '../scripts/network-events.mjs';
import { runEventAlerts } from '../scripts/network-reminders.mjs';
import { NetworkError } from '../scripts/network.mjs';
const { MongoMemoryServer } = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'))('mongodb-memory-server');

const now = new Date('2026-10-29T16:00:00Z');
const MIN = 60_000;
const webEnv = { VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:x@example.com', PUSH_EVENT_USER_ID: 'me@example.com' };

async function setup(t) {
  const mongod = await MongoMemoryServer.create(), client = new MongoClient(mongod.getUri());
  await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('calendar');
  await db.collection('network_people').insertOne({ _id: 'ankit', name: 'Ankit Jain', sourceId: 'amazon', history: [], archived: false });
  return db;
}

test('saving an event checks the title, the time, the reminder choice and the person', async t => {
  const db = await setup(t);
  await assert.rejects(saveEvent(db, { title: '  ', at: '2026-10-30T14:00:00Z' }, now), NetworkError);
  await assert.rejects(saveEvent(db, { title: 'Call', at: 'tomorrow' }, now), /date and time/);
  await assert.rejects(saveEvent(db, { title: 'Call', at: '2026-10-30T14:00:00Z', remind: 5 }, now), /reminder/);
  await assert.rejects(saveEvent(db, { title: 'Call', at: '2026-10-30T14:00:00Z', personId: 'nobody' }, now), /not in your network/);
  const { event } = await saveEvent(db, { title: 'Coffee with Ankit', at: '2026-10-30T14:00:00Z', remind: 60, personId: 'ankit', note: 'Ask about the team' }, now);
  assert.equal(event.at, '2026-10-30T14:00:00.000Z');
  assert.equal(event.done, false);
  assert.equal((await listEvents(db, { now })).events.length, 1);
});

test('an event shows in Network Intelligence from its reminder time, as urgent close to the start, then leaves when done', async t => {
  const db = await setup(t);
  const { event } = await saveEvent(db, { title: 'Coffee with Ankit', at: '2026-10-29T18:00:00Z', remind: 60, personId: 'ankit' }, now);
  const key = `event:${event.id}:${event.at}`;
  assert.equal((await listIntelligence(db, { now })).items.some(i => i.key === key), false, 'not before the reminder window');
  const inWindow = new Date('2026-10-29T17:30:00Z');
  const item = (await listIntelligence(db, { now: inWindow })).items.find(i => i.key === key);
  assert.ok(item, 'shows inside the window');
  assert.equal(item.kind, 'event');
  assert.equal(item.stage, 'urgent');
  assert.deepEqual(item.people, ['ankit']);
  assert.match(item.detail, /Starts .*2:00 PM/);
  const started = (await listIntelligence(db, { now: new Date('2026-10-29T18:10:00Z') })).items.find(i => i.key === key);
  assert.match(started.detail, /^Started /);
  assert.equal((await listIntelligence(db, { now: new Date('2026-10-30T18:30:00Z') })).items.some(i => i.key === key), false, 'drops a day after it starts');
  await intelligenceAction(db, { action: 'event_done', key }, inWindow);
  assert.equal((await listIntelligence(db, { now: inWindow })).items.some(i => i.key === key), false, 'done leaves the dock');
  assert.equal((await listEvents(db, { now: inWindow })).events.length, 0);
});

test('a reminder is sent once, a failed send is retried, and a long-past event is not replayed', async t => {
  const db = await setup(t);
  const { event } = await saveEvent(db, { title: 'Intro call', at: '2026-10-29T16:20:00Z', remind: 15 }, now);
  const calls = [];
  const webPush = async (_db, msg) => { calls.push(msg); return { sent: 1, failed: 0 }; };
  const at = new Date('2026-10-29T16:04:00Z');
  assert.equal((await runEventAlerts({ db, now: at, env: webEnv, webPush })).length, 0, 'not yet in the 15-minute lead time (starts 16:05)');
  const first = await runEventAlerts({ db, now: new Date('2026-10-29T16:05:30Z'), env: webEnv, webPush });
  assert.equal(first.length, 1);
  assert.equal(calls[0].title, 'Reminder: Intro call');
  assert.equal(calls[0].url, `/network?map=main&event=${event.id}`);
  assert.equal((await runEventAlerts({ db, now: new Date('2026-10-29T16:06:30Z'), env: webEnv, webPush })).length, 0, 'sends once');

  const failing = await saveEvent(db, { title: 'Retry me', at: '2026-10-29T16:30:00Z', remind: 0 }, now);
  let attempts = 0;
  const flaky = async () => { attempts += 1; return attempts === 1 ? { sent: 0, failed: 1 } : { sent: 1, failed: 0 }; };
  assert.equal((await runEventAlerts({ db, now: new Date('2026-10-29T16:30:00Z'), env: webEnv, webPush: flaky })).length, 0);
  assert.equal((await runEventAlerts({ db, now: new Date('2026-10-29T16:31:00Z'), env: webEnv, webPush: flaky })).length, 1, 'retried after the failure');
  assert.equal(failing.event.remind, 0);

  await saveEvent(db, { title: 'Long ago', at: '2026-10-29T10:00:00Z', remind: 0 }, now);
  const late = await runEventAlerts({ db, now: new Date('2026-10-29T16:00:00Z'), env: webEnv, webPush });
  assert.equal(late.some(e => e.title === 'Long ago'), false, 'more than two hours late: no alert');
});

test('ntfy alerts carry the title and time when Web Push is not set up', async t => {
  const db = await setup(t);
  await saveEvent(db, { title: 'Phone screen', at: '2026-10-29T16:10:00Z', remind: 15 }, now);
  const published = [];
  const sent = await runEventAlerts({ db, now, env: { NTFY_TOPIC: 'topic' }, publish: async m => { published.push(m); return true; } });
  assert.equal(sent.length, 1);
  assert.match(published[0].message, /Reminder: Phone screen, /);
  await markEventDone(db, sent[0]._id);
  await removeEvent(db, sent[0]._id);
  await assert.rejects(removeEvent(db, sent[0]._id), /gone/);
});
