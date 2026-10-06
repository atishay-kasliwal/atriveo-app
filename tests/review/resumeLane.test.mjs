import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { claimNextJob } from '../../scripts/resume-queue.mjs';

// The fast lane (RESUME_MIN_PRIORITY=1001) claims only the extension's Tailor requests; the main worker
// claims everything, best priority first. Real in-memory Mongo.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const queued = (job_url, priority, owner = 'oracle') => ({ job_url, score_pct: 50, resume: { status: 'queued', owner, priority, lease_until: null } });

test('a lane with minPriority claims only jobs at or above it; the main worker takes the rest', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    await db.collection('jobs').insertMany([queued('bulk-1', 1000), queued('ext-1', 1001), queued('bulk-2', 500), queued('other-machine', 1001, 'mac')]);
    const fast = await claimNextJob(db, 'oracle', 900, { minPriority: 1001 });
    assert.equal(fast.job_url, 'ext-1');
    assert.equal(await claimNextJob(db, 'oracle', 900, { minPriority: 1001 }), null, 'no bulk work for the fast lane, and never another machine\'s');
    assert.equal((await claimNextJob(db, 'oracle', 900)).job_url, 'bulk-1');
    assert.equal((await claimNextJob(db, 'oracle', 900)).job_url, 'bulk-2');
  } finally { await client.close(); await mongo.stop(); }
});

test('jobs at a company you skip (company_rules) stay queued, unbuilt, until it is removed', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    await db.collection('jobs').insertMany([{ ...queued('skip-me', 1000), company: 'Ampcus Inc' }, { ...queued('keep', 500), company: 'Ampcus Incorporated Labs' }]);
    await db.collection('company_rules').insertOne({ _id: 'ampcus', names: ['ampcus inc'], keys: ['ampcus'], mode: 'manual' });
    assert.equal((await claimNextJob(db, 'oracle', 900)).job_url, 'keep');
    assert.equal(await claimNextJob(db, 'oracle', 900), null);
    await db.collection('company_rules').deleteMany({});
    assert.equal((await claimNextJob(db, 'oracle', 900)).job_url, 'skip-me');
  } finally { await client.close(); await mongo.stop(); }
});
