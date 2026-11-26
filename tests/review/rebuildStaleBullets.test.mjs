import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { staleBullets, staleFiles, rebuildStaleJobs } from '../../scripts/rebuild-stale-bullets.mjs';

// After a bank change, the resumes that still print an old bullet (scripts/rebuild-stale-bullets.mjs). A made-up bank,
// temporary folders and an in-memory Mongo; nothing is queued for real.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const bank = { acs: [
  { id: 'AC-1', variants: [{ facet: 'default', text: 'Solved a hang, passing 500 runs.' }] },
  { id: 'AC-2', variants: [{ facet: 'default', text: 'Repaired 2 paths with 28 tests.' }] },
  { id: 'AC-3', tracks: ['retired'], variants: [{ facet: 'default', text: 'Old.' }] },
] };
const comp = (bullets) => ({ composition: { experience: [], projects: [{ role: 'open-source', bullets }] } });

test('a bullet is stale when it was retired, removed or reworded; spacing alone is not a change', () => {
  assert.deepEqual(staleBullets(comp([{ ac_id: 'AC-1', facet: 'default', text: 'Solved a hang,  passing 500 runs.' }]), bank), []);
  assert.deepEqual(staleBullets(comp([
    { ac_id: 'AC-2', facet: 'default', text: 'Repaired 3 paths with 29 tests.' }, { ac_id: 'AC-3', facet: 'default', text: 'Old.' }, { ac_id: 'AC-9', facet: 'default', text: 'Gone.' },
  ]), bank).map((s) => s.why), ['reworded', 'retired', 'removed from the bank']);
  assert.deepEqual(staleBullets(comp([{ ac_id: 'AC-3', text: 'Old.' }]), bank, { only: 'atriveo' }), [], 'another role is left out');
});

test('job resumes: stale ones are queued, applied and edited ones are only listed; masters are reported from files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-'));
  const job = (name, bullets, edited = false) => {
    const dir = path.join(root, '2026-11-25', name); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'composition.json'), JSON.stringify(comp(bullets)));
    if (edited) fs.writeFileSync(path.join(dir, 'builder.json'), '{}');
    return path.join(dir, 'Atishay Kasliwal.pdf');
  };
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try {
    const db = client.db('stale'), now = new Date();
    const rows = [['a', [{ ac_id: 'AC-1', text: 'Solved a hang, passing 500 runs.' }]], ['b', [{ ac_id: 'AC-3', text: 'Old.' }]], ['c', [{ ac_id: 'AC-3', text: 'Old.' }]], ['d', [{ ac_id: 'AC-2', text: 'Repaired 3 paths with 29 tests.' }], true]];
    await db.collection('jobs').insertMany(rows.map(([n, b, e]) => ({ job_url: `https://jobs.test/${n}`, company: n, title: 'SWE', run_at: now, resume: { status: 'success', pdf_path: job(n, b, e) } })));
    await db.collection('applications').insertOne({ url: 'https://jobs.test/c' });
    const queued = [];
    const enqueue = async (_db, j) => { queued.push(j.job_url); return {}; };
    let r = await rebuildStaleJobs(db, { bank, enqueue });
    assert.deepEqual([r.looked_at, r.current, r.stale, r.queued, queued.length], [4, 1, 3, 0, 0], 'report only');
    r = await rebuildStaleJobs(db, { bank, enqueue, apply: true });
    assert.deepEqual(queued, ['https://jobs.test/b']);
    assert.deepEqual([r.applied.map((x) => x.company), r.edited.map((x) => x.company)], [['c'], ['d']]);
    assert.equal(r.by_bullet['AC-3 retired'], 2);

    const master = path.join(root, 'general', 'Software Engineer'); fs.mkdirSync(master, { recursive: true });
    fs.writeFileSync(path.join(master, 'composition.json'), JSON.stringify(comp([{ ac_id: 'AC-2', text: 'Repaired 3 paths with 29 tests.' }])));
    assert.deepEqual(staleFiles(root, bank).map((x) => [x.kind, x.name, x.stale[0].why]), [['general', 'Software Engineer', 'reworded']]);
  } finally { await client.close(); await mongod.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
