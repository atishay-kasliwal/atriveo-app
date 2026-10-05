import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { dismissJob, reviewQueue } from '../../scripts/applications-analytics.mjs';

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
    assert.equal(r.track, 'software-engineer', 'its title (Engineer) puts it on the software engineer track');
  } finally { await client.close(); await mongo.stop(); }
});

test('LinkedIn postings with a resume and no application are listed until dismissed', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const now = new Date('2026-10-05T12:00:00.000Z');
    const li = (n, extra = {}) => ({ job_url: `https://www.linkedin.com/jobs/view/${n}`, company: `Co ${n}`, title: 'AI Engineer', location: 'Raleigh, NC', score_pct: 60, run_at: new Date('2026-10-05T08:00:00Z'), resume: { status: 'success', pdf_path: `/r/${n}/A.pdf` }, ...extra });
    await db.collection('jobs').insertMany([li(1), li(2), li(3, { resume: { status: 'queued' } }), li(4, { run_at: new Date('2026-09-20T08:00:00Z') }), { ...li(5), job_url: 'https://jobs.ashbyhq.com/x/5' }]);
    await db.collection('applications').insertOne({ _id: 'a2', jobUrls: ['https://www.linkedin.com/jobs/view/2'] });
    let { linkedin } = await reviewQueue(db, { view: 'linkedin', now });
    assert.deepEqual(linkedin.map((j) => j.company), ['Co 1'], 'only #1: #2 has an application, #3 no resume yet, #4 is old, #5 is not LinkedIn');
    assert.equal(linkedin[0].track, 'ai-engineer');
    await dismissJob(db, 'https://www.linkedin.com/jobs/view/1', now);
    ({ linkedin } = await reviewQueue(db, { view: 'linkedin', now }));
    assert.equal(linkedin.length, 0, 'dismissed: gone');
  } finally { await client.close(); await mongo.stop(); }
});
