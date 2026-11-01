import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { tickSavedNudges } from '../scripts/saved-nudges.mjs';
import { deliverEvent, pollPushEvents } from '../scripts/push-events.mjs';
import { postingKey } from '../scripts/staffing-workspace.mjs';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const user = 'owner@example.com', H = 3_600_000;
const start = new Date('2026-11-01T12:00:00Z');
const at = (h) => new Date(+start + h * H);

async function world(t) {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('saved_nudges_test');
  const sent = [];
  const tick = (now) => tickSavedNudges(db, user, { now, deliver: (id, n) => deliverEvent(db, user, id, n, { now, send: async () => { sent.push({ id, ...n }); return { sent: 1, failed: 0 }; } }) });
  await tick(start); // the first run sets the start line
  return { db, sent, tick };
}
const save = (db, url, h) => db.collection('job_swipes').updateOne({ job_url: url }, { $set: { job_url: url, direction: 'later', swiped_at: at(h).toISOString(), source: 'job-matching' } }, { upsert: true });

test('a saved job is nudged once at 3, 6 and 13 hours, with its company and title', async (t) => {
  const { db, sent, tick } = await world(t);
  const url = 'https://jobs.example/a';
  await db.collection('jobs').insertOne({ job_url: url, company: 'Northwind', title: 'Backend Engineer' });
  await save(db, url, 0);
  for (let m = 0; m <= 15 * 60; m += 10) await tick(new Date(+start + m * 60000));
  assert.deepEqual(sent.map((s) => s.body), ['Saved 3 hours ago. Apply now.', 'Still not applied, 6 hours since you saved it.', 'Last reminder: saved 13 hours ago.']);
  assert.equal(sent[0].title, 'Northwind · Backend Engineer');
  assert.equal(sent[0].url, '/job-matching?saved=1');
  assert.deepEqual(sent[0].actions.map((a) => a.action), ['applied', 'skip']);
  assert.deepEqual(sent[0].data.savedJob, { source: 'matching', jobUrl: url });
  assert.equal(new Set(sent.map((s) => s.id)).size, 3);
});

test('no nudge once you applied, skipped or undid the save, or for saves made before it was turned on', async (t) => {
  const { db, sent, tick } = await world(t);
  await db.collection('job_swipes').insertOne({ job_url: 'https://jobs.example/old', direction: 'later', swiped_at: at(-1).toISOString() });
  for (const u of ['marked', 'engine', 'skipped', 'undone']) await save(db, `https://jobs.example/${u}`, 0);
  await db.collection('job_swipes').updateOne({ job_url: 'https://jobs.example/marked' }, { $set: { direction: 'applied' } });
  await db.collection('applications').insertOne({ status: 'APPLIED', jobUrls: ['https://jobs.example/engine'] });
  await db.collection('job_swipes').updateOne({ job_url: 'https://jobs.example/skipped' }, { $set: { direction: 'left' } });
  await db.collection('job_swipes').deleteOne({ job_url: 'https://jobs.example/undone' });
  await tick(at(3)); await tick(at(6)); await tick(at(13));
  assert.deepEqual(sent, []);
});

test('applying between nudges stops the rest', async (t) => {
  const { db, sent, tick } = await world(t);
  const url = 'https://jobs.example/b';
  await save(db, url, 0);
  await tick(at(3));
  await db.collection('applications').insertOne({ status: 'APPLIED', url });
  await tick(at(6)); await tick(at(13));
  assert.equal(sent.length, 1);
});

test('a Staffing save is nudged with the Staffing buttons; Applied or Passed stops it', async (t) => {
  const { db, sent, tick } = await world(t);
  const url = 'https://staffing.example/job/1', other = 'https://staffing.example/job/2';
  for (const u of [url, other]) {
    await db.collection('staffing_jobs').insertOne({ _id: postingKey(u), job_url: u, company: 'Acme Staffing', title: 'Data Analyst' });
    await db.collection('staffing_decisions').insertOne({ _id: postingKey(u), job_url: u, state: 'saved', updated_at: at(0) });
  }
  await db.collection('staffing_decisions').updateOne({ _id: postingKey(other) }, { $set: { state: 'passed' } });
  await tick(at(3));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/staffing?view=saved');
  assert.deepEqual(sent[0].data.savedJob, { source: 'staffing', jobUrl: url, staffingId: postingKey(url) });
  await db.collection('staffing_decisions').updateOne({ _id: postingKey(url) }, { $set: { state: 'applied' } });
  await tick(at(6));
  assert.equal(sent.length, 1);
});

test('nudges missed while the server was down: only the latest is sent, and none after it is 3 hours late', async (t) => {
  const { db, sent, tick } = await world(t);
  await save(db, 'https://jobs.example/c', 0);
  await save(db, 'https://jobs.example/d', 0.5);
  await tick(at(7)); // c and d both passed 3 and 6 while down
  assert.deepEqual(sent.map((s) => s.body), ['Still not applied, 6 hours since you saved it.', 'Still not applied, 6 hours since you saved it.']);
  await tick(at(8)); assert.equal(sent.length, 2, 'the 3-hour one is not sent late');
  await tick(at(16.4)); // 13h mark for c was at 13, for d at 13.5: c is more than 3 hours late
  assert.equal(sent.length, 3); assert.match(sent[2].id, /:2026-11-01T12:30:00.000Z:13$/);
});

test('saving the same job again starts its nudges over', async (t) => {
  const { db, sent, tick } = await world(t);
  const url = 'https://jobs.example/e';
  await save(db, url, 0); await tick(at(3));
  await save(db, url, 4); await tick(at(7));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body, 'Saved 3 hours ago. Apply now.');
});

test('the push poll sends the nudges', async (t) => {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('saved_nudges_poll');
  await db.collection('push_subscriptions').insertOne({ userId: user, endpoint: 'https://push.example/1' });
  const sent = []; const send = async (_db, _u, n) => { sent.push(n); return { sent: 1, failed: 0 }; };
  await pollPushEvents(db, user, { now: start, send });
  await save(db, 'https://jobs.example/f', 0);
  await pollPushEvents(db, user, { now: at(3), send });
  assert.deepEqual(sent.filter((n) => n.type === 'saved_nudge').map((n) => n.body), ['Saved 3 hours ago. Apply now.']);
});
