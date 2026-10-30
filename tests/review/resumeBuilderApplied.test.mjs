import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// "Applied?" in the resume builder: the popup's optional link, the record every applied count reads, and the state
// the builder loads back (so the button shows "Applied ✓").
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-applied-'));
process.env.TAILOR_OUT_ROOT = out;
const { BuilderError, loadResume, markResumeApplied, startPasted } = await import('../../scripts/resume-builder.mjs');
const { loadAppliedItems } = await import('../../scripts/applied-core.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const FIX = path.join(import.meta.dirname, 'fixtures', 'builder-run');
const SNAPSHOTS = path.join(import.meta.dirname, '..', '..', 'data', 'snapshots', 'index.jsonl');

test('Applied? records the link (optional), counts once, and loads back as applied', { timeout: 300_000 }, async () => {
  const snapshots = fs.existsSync(SNAPSHOTS) ? fs.readFileSync(SNAPSHOTS) : null;
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('t');
    const { source } = await startPasted(db, { jd: fs.readFileSync(path.join(FIX, 'jd.txt'), 'utf8'), company: 'Example Co', title: 'Software Engineer', location: 'Austin, TX' });
    assert.equal((await loadResume(db, { pasted: source.pasted })).applied, null);

    await assert.rejects(markResumeApplied(db, { source, link: 'not a link' }), BuilderError);
    await assert.rejects(markResumeApplied(db, { source, link: 'ftp://example.com/job' }), BuilderError);
    await assert.rejects(markResumeApplied(db, { source: { kind: 'pasted', pasted: 'abcdef0123' } }), BuilderError);
    assert.equal(await db.collection('job_swipes').countDocuments(), 0, 'a refused request records nothing');

    // No link: still recorded (under this resume), with the posting's company and title.
    const first = await markResumeApplied(db, { source }, new Date('2026-10-30T15:00:00Z'));
    assert.equal(first.applied.link, null);
    // The same resume again, now with a link: still one record, the first applied time kept, the link saved.
    const second = await markResumeApplied(db, { source, link: 'boards.greenhouse.io/example/jobs/1' }, new Date('2026-10-30T16:00:00Z'));
    assert.equal(second.applied.at, '2026-10-30T15:00:00.000Z');
    assert.equal(second.applied.link, 'https://boards.greenhouse.io/example/jobs/1');
    assert.equal(await db.collection('job_swipes').countDocuments({ direction: 'applied' }), 1, 'never counted twice');

    const back = await loadResume(db, { pasted: source.pasted });
    assert.ok(back.applied, 'the builder loads it as applied');
    const items = await loadAppliedItems(db);
    assert.equal(items.length, 1, 'the applied count reads it once');
    const row = await db.collection('job_swipes').findOne({ direction: 'applied' });
    assert.equal(row.apply_link, 'https://boards.greenhouse.io/example/jobs/1');
    assert.equal(row.company, 'Example Co');
    assert.equal(row.source, 'resume-builder');
  } finally {
    await client.close();
    await mongo.stop();
    if (snapshots) fs.writeFileSync(SNAPSHOTS, snapshots);
  }
});
