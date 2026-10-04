import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { rebuildAllResumes } from '../../scripts/rebuild-all-resumes.mjs';
import { draftCoverLetter } from '../../scripts/resume-cover.mjs';
import { claimNextJob } from '../../scripts/resume-queue.mjs';

// The one-off reset (scripts/rebuild-all-resumes.mjs) and the draft cover letter after each resume
// (scripts/resume-cover.mjs), on an in-memory Mongo and temporary folders only.

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function withDb(fn) {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try { await fn(client.db('rebuild')); } finally { await client.close(); await mongod.stop(); }
}

test('dry run changes nothing; --apply empties the resume and cache folders and re-queues every built job from scratch, newest first', async () => {
  await withDb(async (db) => {
    const outRoot = tmp('out-'); const cache = tmp('cache-');
    fs.mkdirSync(path.join(outRoot, '2026-10-01', 'Acme (1stOctober)'), { recursive: true });
    fs.writeFileSync(path.join(outRoot, '2026-10-01', 'Acme (1stOctober)', 'Jane Doe.pdf'), '%PDF');
    fs.mkdirSync(path.join(cache, 'fp1'));
    const now = Date.parse('2026-10-04T12:00:00Z');
    await db.collection('jobs').insertMany([
      { job_url: 'old', company: 'Old', title: 'SWE', batch_time: '2026-09-20T10:00:00Z', resume: { status: 'success', source: 'hourly', pdf_path: '/x/old.pdf', owner: 'mac' } },
      { job_url: 'new', company: 'New', title: 'SWE', batch_time: '2026-10-04T10:00:00Z', resume: { status: 'success', source: 'manual', pdf_path: '/x/new.pdf', owner: 'mac' } },
      { job_url: 'waiting', company: 'W', title: 'SWE', batch_time: '2026-10-04T09:00:00Z', resume: { status: 'queued', source: 'hourly', owner: 'mac' } },
      { job_url: 'broken', company: 'B', title: 'SWE', resume: { status: 'failed', error: 'tex' } },
      { job_url: 'none', company: 'N', title: 'SWE' },
    ]);
    const quiet = () => {};

    const dry = await rebuildAllResumes({ db, outRoot, artifactsRoot: cache, owner: 'oracle-atriveo', now, log: quiet });
    assert.deepEqual(dry, { files: { resumes: 1, cache: 1 }, requeued: 3, cleared: 1 });
    assert.ok(fs.existsSync(path.join(outRoot, '2026-10-01')), 'dry run deletes nothing');
    assert.equal((await db.collection('jobs').findOne({ job_url: 'old' })).resume.pdf_path, '/x/old.pdf');

    await rebuildAllResumes({ db, outRoot, artifactsRoot: cache, owner: 'oracle-atriveo', now, apply: true, log: quiet });
    assert.deepEqual(fs.readdirSync(outRoot), []);
    assert.deepEqual(fs.readdirSync(cache), []);
    const jobs = Object.fromEntries((await db.collection('jobs').find().toArray()).map((j) => [j.job_url, j.resume]));
    for (const k of ['old', 'new', 'waiting']) {
      assert.equal(jobs[k].status, 'queued', k);
      assert.equal(jobs[k].owner, 'oracle-atriveo', k);
      assert.equal(jobs[k].pdf_path, undefined, `${k}: the old file is forgotten`);
    }
    assert.equal(jobs.new.source, 'manual', 'keeps where it came from');
    assert.equal(jobs.broken, undefined);
    assert.equal(jobs.none, undefined);
    assert.equal((await claimNextJob(db, 'mac', 60)), null, 'the Mac worker no longer owns any of them');
    assert.equal((await claimNextJob(db, 'oracle-atriveo', 60)).job_url, 'new', 'newest posting first');
    assert.equal((await claimNextJob(db, 'oracle-atriveo', 60)).job_url, 'waiting');
    assert.equal((await claimNextJob(db, 'oracle-atriveo', 60)).job_url, 'old');
  });
});

test('refuses to empty the filesystem root or the home folder', async () => {
  await assert.rejects(rebuildAllResumes({ db: null, outRoot: '/', artifactsRoot: tmp('c-'), filesOnly: true, log: () => {} }), /refusing/);
  await assert.rejects(rebuildAllResumes({ db: null, outRoot: tmp('o-'), artifactsRoot: os.homedir(), filesOnly: true, log: () => {} }), /refusing/);
});

test('each new resume gets a draft cover letter in its folder; an existing letter is kept; a failure is recorded, not thrown', async () => {
  await withDb(async (db) => {
    await db.collection('jobs').insertMany([{ job_url: 'a', resume: { status: 'success' } }, { job_url: 'b', resume: { status: 'success' } }, { job_url: 'c', resume: { status: 'success' } }]);
    const name = () => 'Jane Doe';
    const built = [];
    const build = ({ company, role, jd, dir, bank }) => { built.push({ company, role, jd, dir, bank: Array.isArray(bank) || typeof bank === 'object' }); const p = path.join(dir, 'Jane Doe - Cover Letter.pdf'); fs.writeFileSync(p, '%PDF'); return { ok: true, pdf: p }; };

    const dirA = tmp('a-');
    const a = await draftCoverLetter(db, { jobUrl: 'a', company: 'Acme', title: 'SWE', jd: 'jd', dir: dirA }, { build, name });
    assert.equal(a.status, 'draft');
    assert.deepEqual(built.map((b) => [b.company, b.role, b.dir]), [['Acme', 'SWE', dirA]]);
    const recA = (await db.collection('jobs').findOne({ job_url: 'a' })).resume;
    assert.equal(recA.status, 'success', 'the resume is untouched');
    assert.equal(recA.cover_letter.status, 'draft');
    assert.equal(recA.cover_letter.pdf_path, path.join(dirA, 'Jane Doe - Cover Letter.pdf'));

    const dirB = tmp('b-');
    fs.writeFileSync(path.join(dirB, 'Jane Doe - Cover Letter.pdf'), 'mine');
    await draftCoverLetter(db, { jobUrl: 'b', company: 'B', title: 'SWE', jd: 'jd', dir: dirB }, { build, name });
    assert.equal(built.length, 1, 'never rebuilt over an existing letter');
    assert.equal(fs.readFileSync(path.join(dirB, 'Jane Doe - Cover Letter.pdf'), 'utf8'), 'mine');

    const c = await draftCoverLetter(db, { jobUrl: 'c', company: 'C', title: 'SWE', jd: 'jd', dir: tmp('c-') }, { build: () => ({ ok: false, err: 'tectonic missing' }), name });
    assert.deepEqual(c, { status: 'failed', error: 'tectonic missing' });
    const recC = (await db.collection('jobs').findOne({ job_url: 'c' })).resume;
    assert.equal(recC.status, 'success');
    assert.equal(recC.cover_letter.status, 'failed');
  });
});
