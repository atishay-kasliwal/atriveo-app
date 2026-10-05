import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { reviewQueue } from '../../scripts/applications-analytics.mjs';

// The review queue carries job-pipeline's facts for Today: best match score and earliest posting/found dates
// across the jobs documents for the application's job_urls. Real in-memory Mongo.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

test('unanswered rows carry score, postedAt and foundAt from jobs, and no job_urls', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const url = 'https://jobs.ashbyhq.com/acme/1';
    await db.collection('applications').insertOne({ _id: 'a1', company: 'Acme', title: 'Engineer', location: 'Raleigh, NC', status: 'NEEDS_REVIEW', jobUrls: [url], priority: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
      submission: { attemptedAt: null }, review: { reason: 'QUESTIONS', pending: [{ fingerprint: 'f', label: 'Why?', type: 'text' }] } });
    await db.collection('jobs').insertMany([
      { job_url: url, score_pct: 40, date_posted: '2026-09-30', run_at: '2026-10-01T02:00:00Z' },
      { job_url: url, score_pct: 65, date_posted: 'null', run_at: '2026-09-30T05:00:00Z' },
    ]);
    const { unanswered } = await reviewQueue(db, { view: 'unanswered' });
    assert.equal(unanswered.length, 1);
    const r = unanswered[0];
    assert.equal(r.score, 65);
    assert.equal(r.postedAt, '2026-09-30T00:00:00.000Z');
    assert.equal(r.foundAt, '2026-09-30T05:00:00.000Z');
    assert.equal(r.location, 'Raleigh, NC');
    assert.equal(r.jobUrls, undefined);
  } finally { await client.close(); await mongo.stop(); }
});
