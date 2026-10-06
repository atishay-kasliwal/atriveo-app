import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { addResumeEta } from '../../scripts/applications-analytics.mjs';

// Today's "Resume in ~10 min": per card, from its job's resume state, the queue ahead of it and the worker's pace.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const now = new Date('2026-10-06T17:00:00Z');
const at = (minAgo) => new Date(now.getTime() - minAgo * 60_000).toISOString();

test('syncing, building, queued (jobs ahead × the worker\'s pace), failed and not queued', async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const job = (job_url, status, extra = {}) => ({ job_url, score_pct: 50, resume: { status, owner: 'mac', priority: 1000, ...extra } });
    await db.collection('jobs').insertMany([
      // The Mac built one every 4 minutes for the last 20 minutes (and was idle before that).
      ...[0, 4, 8, 12, 16, 20, 120].map((m, i) => job(`done-${i}`, 'success', { updated_at: at(m) })),
      job('built', 'success', { updated_at: at(1) }),
      job('busy', 'running'),
      job('ahead-1', 'queued', { priority: 1001 }), { ...job('ahead-2', 'queued'), score_pct: 90 }, job('mine', 'queued'), { ...job('behind', 'queued'), score_pct: 10 },
      job('broken', 'failed'),
    ]);
    const rows = [
      { url: 'built', resumeReady: false }, { url: 'busy', resumeReady: false }, { _jobUrls: ['mine'], resumeReady: false },
      { url: 'broken', resumeReady: false }, { url: 'nothing', resumeReady: false }, { url: 'ready', resumeReady: true },
    ];
    await addResumeEta(db, rows, now);
    assert.deepEqual(rows.map((r) => r.resumeEta ?? null), [
      { state: 'syncing', minutes: 2 },
      { state: 'building', minutes: 5 },
      { state: 'queued', ahead: 2, minutes: 20 },
      { state: 'failed', minutes: null },
      { state: 'not_queued', minutes: null },
      null,
    ]);
    assert.ok(rows.every((r) => !('_jobUrls' in r)));
  } finally { await client.close(); await mongo.stop(); }
});
