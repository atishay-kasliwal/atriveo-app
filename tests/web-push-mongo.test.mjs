import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { ensurePushIndexes, saveSubscription } from '../scripts/web-push.mjs';
import { deliverEvent, pollPushEvents } from '../scripts/push-events.mjs';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
test('Mongo indexes enforce ownership, multiple devices, event leases and polling deduplication', async t => {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db = client.db('push_test'); await ensurePushIndexes(db);
  const sub = { endpoint: 'https://web.push.apple.com/device1', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } };
  await Promise.all([saveSubscription(db, 'owner@example.com', sub), saveSubscription(db, 'owner@example.com', sub)]);
  await saveSubscription(db, 'owner@example.com', { ...sub, endpoint: 'https://web.push.apple.com/device2' });
  assert.equal(await db.collection('push_subscriptions').countDocuments({ userId: 'owner@example.com' }), 2);
  await assert.rejects(saveSubscription(db, 'other@example.com', sub), { code: 11000 });
  await db.collection('push_subscriptions').deleteOne({ endpoint: sub.endpoint, userId: 'other@example.com' });
  assert.equal(await db.collection('push_subscriptions').countDocuments(), 2);
  let count = 0; const send = async () => { count++; return { sent: 2, failed: 0 }; };
  await Promise.all(Array.from({ length: 5 }, () => deliverEvent(db, 'owner@example.com', 'same-event', { title: 'Test' }, { send })));
  assert.equal(count, 1);
  const now = new Date('2026-10-28T14:00:00Z'); const userId = 'owner@example.com';
  await pollPushEvents(db, userId, { now, send });
  await db.collection('inbox_events').insertMany([{ _id: 'interview', receivedAt: now.toISOString(), kind: 'interview', applicationId: 'app1' }, { _id: 'offer', receivedAt: now.toISOString(), kind: 'offer' }, { _id: 'dismissed', receivedAt: now.toISOString(), kind: 'offer', state: 'dismissed' }]);
  await db.collection('outreach').insertOne({ _id: 'reply1', reply: { at: now.toISOString() }, company: 'Example' });
  await pollPushEvents(db, userId, { now, send }); assert.equal(count, 4);
  await pollPushEvents(db, userId, { now, send }); assert.equal(count, 4);
  await pollPushEvents(db, 'other@example.com', { now, send }); assert.equal(count, 4);
  await db.collection('app_settings').insertOne({ _id: 'daily_goal', goal: 1 });
  await db.collection('job_swipes').insertOne({ job_url: 'https://example.com/job', direction: 'applied', applied_at: now.toISOString() });
  await pollPushEvents(db, userId, { now, send }); assert.equal(count, 5);
  await pollPushEvents(db, userId, { now, send }); assert.equal(count, 5);
  const tomorrow = '2026-10-30T03:59:00.000Z'; // Oct 29, 11:59 PM NY
  await db.collection('assessments').insertMany([
    { _id: 'due-tomorrow', company: 'Example', status: 'open', deadlineAt: tomorrow },
    { _id: 'finished', company: 'Finished', status: 'done', deadlineAt: tomorrow },
    { _id: 'dismissed', company: 'Dismissed', status: 'dismissed', deadlineAt: tomorrow },
  ]);
  await pollPushEvents(db, userId, { now, send }); assert.equal(count, 6, 'only the open assessment alerts');
  await pollPushEvents(db, userId, { now: new Date(+now + 60000), send }); assert.equal(count, 6, 'no repeat on the next minute');
  await Promise.all([pollPushEvents(db, userId, { now: new Date('2026-10-29T00:00:00Z'), send }), pollPushEvents(db, userId, { now: new Date('2026-10-29T00:00:00Z'), send })]);
  assert.equal(count, 7, 'one daily summary across concurrent pollers');
  await pollPushEvents(db, userId, { now: new Date('2026-10-29T01:00:00Z'), send }); assert.equal(count, 7, 'summary remains deduplicated on restart');
  // Finishing the assessment suppresses its due-date reminder.
  await db.collection('assessments').updateOne({ _id: 'due-tomorrow' }, { $set: { status: 'done' } });
  await pollPushEvents(db, userId, { now: new Date('2026-10-29T19:00:00Z'), send }); assert.equal(count, 7);
  let attempts = 0;
  const retry = async () => { attempts++; return { sent: 0, failed: 1 }; };
  await deliverEvent(db, userId, 'retry', {}, { now, send: retry });
  await deliverEvent(db, userId, 'retry', {}, { now, send: retry }); assert.equal(attempts, 1);
  await deliverEvent(db, userId, 'retry', {}, { now: new Date(+now + 121000), send: retry }); assert.equal(attempts, 2);
});

 test('progress pushes collapse jumps, preserve the old goal ID and send each milestone once', async t => {
  const mongod = await MongoMemoryServer.create(); const client = new MongoClient(mongod.getUri()); await client.connect();
  t.after(async () => { await client.close(); await mongod.stop(); });
  const db=client.db('milestones'), userId='owner@example.com', now=new Date('2026-10-28T18:00:00Z');
  await db.collection('push_subscriptions').insertOne({userId});
  await db.collection('app_settings').insertOne({_id:'daily_goal',goal:4});
  const sent=[], send=async (_db,_user,n)=>{sent.push(n.tag);return {sent:1,failed:0};};
  const add=async n=>db.collection('job_swipes').insertOne({job_url:`https://example.com/${n}`,direction:'applied',applied_at:now.toISOString()});
  await add(1); await pollPushEvents(db,userId,{now,send});
  await add(2); await pollPushEvents(db,userId,{now,send});
  await add(3); await add(4); await pollPushEvents(db,userId,{now,send});
  for(let i=5;i<=16;i++) await add(i);
  await Promise.all([pollPushEvents(db,userId,{now,send}),pollPushEvents(db,userId,{now,send})]);
  await pollPushEvents(db,userId,{now,send});
  assert.deepEqual(sent,['first:2026-10-28','half:2026-10-28','goal:2026-10-28','m3:2026-10-28']);
  assert.equal((await db.collection('push_deliveries').findOne({_id:`${userId}:m2:2026-10-28`})).silent,true);
 });
