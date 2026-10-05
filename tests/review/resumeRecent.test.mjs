import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { queueRecentResumes } from '../../scripts/resume-recent.mjs';
import { claimNextJob } from '../../scripts/resume-queue.mjs';

// The recent-jobs resume pass (scripts/resume-recent.mjs), on an in-memory Mongo.

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

async function withDb(fn) {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try { await fn(client.db('recent')); } finally { await client.close(); await mongod.stop(); }
}

const now = Date.parse('2026-10-05T00:30:00Z');
const at = (iso) => ({ run_at: new Date(iso), session_id: iso.slice(0, 19) + 'Z' });

test('queues only jobs first seen and posted inside the window; dequeues older ones; keeps built resumes and jobs', async () => {
  await withDb(async (db) => {
    await db.collection('jobs').insertMany([
      { job_url: 'fresh-li', company: 'A', title: 'SWE', score_pct: 70, ...at('2026-10-04T21:52:40') },
      { job_url: 'fresh-strong', company: 'B', title: 'AI', score_pct: 90, ...at('2026-10-05T00:25:17') },
      // seen Oct 2, scraped again today: a new doc with today's run_at, still an old job
      { job_url: 'rescraped', company: 'C', title: 'SWE', score_pct: 95, ...at('2026-10-02T18:00:00'), resume: { status: 'queued', owner: 'oracle-atriveo', source: 'hourly' } },
      { job_url: 'rescraped', company: 'C', title: 'SWE', score_pct: 95, ...at('2026-10-05T00:25:17') },
      // a board found today, posting first published two weeks ago
      { job_url: 'gh-old', company: 'D', title: 'SWE', site: 'greenhouse', date_posted: '2026-09-20', score_pct: 99, ...at('2026-10-04T15:11:55') },
      { job_url: 'gh-new', company: 'E', title: 'SWE', site: 'greenhouse', date_posted: '2026-10-04', score_pct: 60, ...at('2026-10-04T21:52:40') },
      { job_url: 'built', company: 'F', title: 'SWE', score_pct: 80, ...at('2026-10-04T21:52:40'), resume: { status: 'success', pdf_path: '/x/f.pdf', owner: 'oracle-atriveo' } },
      { job_url: 'mac-queued', company: 'G', title: 'SWE', score_pct: 50, ...at('2026-10-05T00:25:17'), resume: { status: 'queued', owner: 'mac', source: 'hourly' } },
      { job_url: 'old-built', company: 'H', title: 'SWE', score_pct: 85, ...at('2026-09-30T10:00:00'), resume: { status: 'success', pdf_path: '/x/h.pdf' } },
      { job_url: 'old-stuck', company: 'I', title: 'SWE', score_pct: 85, ...at('2026-09-30T10:00:00'), resume: { status: 'running', lease_until: new Date('2026-10-04T22:00:00Z') } },
      { job_url: 'no-go', company: 'J', title: 'SWE', score_pct: 85, ...at('2026-10-04T21:52:40'), resume: { status: 'failed', failure_reason: 'no-go' } },
      // LinkedIn: id order is creation order. 'li/100' was seen before the cutoff, so 'li/90' is an old posting relisted today
      { job_url: 'https://www.linkedin.com/jobs/view/100', company: 'L', title: 'SWE', score_pct: 10, ...at('2026-10-03T12:00:00') },
      { job_url: 'https://www.linkedin.com/jobs/view/90', company: 'M', title: 'SWE', score_pct: 98, ...at('2026-10-04T21:52:40') },
      { job_url: 'https://www.linkedin.com/jobs/view/101', company: 'N', title: 'SWE', score_pct: 40, ...at('2026-10-04T21:52:40') },
      { job_url: 'ext', company: 'K', title: 'x', source: 'extension', created_at: '2026-10-05T00:08:04Z' },
    ]);
    const quiet = () => {};
    const dry = await queueRecentResumes({ db, owner: 'oracle-atriveo', now, log: quiet });
    assert.equal(dry.cutoff, '2026-10-04T00:30:00.000Z');
    assert.equal(dry.recent, 7);
    assert.equal(dry.linkedinIdFloor, 100);
    assert.equal(dry.excludedRelisted, 1);
    assert.equal(dry.excludedRescraped, 1);
    assert.equal(dry.excludedPostedEarlier, 1);
    assert.deepEqual(dry.queue, ['fresh-strong', 'fresh-li', 'gh-new', 'mac-queued', 'https://www.linkedin.com/jobs/view/101']);
    assert.equal(dry.olderDequeued, 2);
    assert.equal((await db.collection('jobs').findOne({ job_url: 'old-stuck' })).resume.status, 'running', 'dry run changes nothing');

    const res = await queueRecentResumes({ db, owner: 'oracle-atriveo', now, apply: true, log: quiet });
    assert.equal(res.queued, 5);
    assert.equal(res.olderDequeued, 2);
    assert.equal(await db.collection('jobs').countDocuments(), 15, 'no job is deleted');
    const resume = async (u) => (await db.collection('jobs').find({ job_url: u }).toArray()).map((j) => j.resume?.status ?? null);
    assert.deepEqual(await resume('rescraped'), [null, null]);
    assert.deepEqual(await resume('old-stuck'), [null]);
    assert.deepEqual(await resume('gh-old'), [null]);
    assert.deepEqual(await resume('old-built'), ['success'], 'built resumes outside the window are kept');
    assert.equal((await db.collection('jobs').findOne({ job_url: 'built' })).resume.pdf_path, '/x/f.pdf');
    assert.deepEqual(await resume('no-go'), ['failed']);
    assert.equal(await claimNextJob(db, 'mac', 60), null, 'the Mac copy moved to this backend');
    const order = [];
    for (let j; (j = await claimNextJob(db, 'oracle-atriveo', 60));) order.push([j.job_url, j.resume.source]);
    assert.deepEqual(order, [['fresh-strong', 'recent'], ['fresh-li', 'recent'], ['gh-new', 'recent'], ['mac-queued', 'recent'], ['https://www.linkedin.com/jobs/view/101', 'recent']]);
  });
});

test('rejects a non-positive window', async () => {
  await assert.rejects(queueRecentResumes({ db: null, hours: 0, log: () => {} }), /positive/);
});
