import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

// Staffing resumes go through the resume queue like every other job: Create resume returns at once and the
// Oracle worker (owner oracle-atriveo) builds it, so the page never waits and other cards stay usable.
process.env.RESUME_WORKER_ID = 'oracle-atriveo';
const { mutate, list, queueRecommended, PRIORITY_CLICKED, PRIORITY_STAFFING } = await import('../../scripts/staffing-workspace.mjs');
const { claimNextJob } = await import('../../scripts/resume-queue.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');

const jd = 'Build services in Python and React. '.repeat(20);
const posting = (id, extra = {}) => ({ _id: id, job_url: `https://jobs.test/${id}`, title: `Engineer ${id}`, company: 'Example Corp', location: 'Remote', description: jd, expired: false, first_seen_at: `2026-10-0${extra.day || 1}T10:00:00Z`, ...extra });

async function withDb(fn) {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try { await fn(client.db('staffing_queue')); } finally { await client.close(); await mongod.stop(); }
}

test('Create resume queues the job for the worker and returns at once; the fast lane claims it', () => withDb(async db => {
  await db.collection('staffing_jobs').insertOne(posting('a'));
  await db.collection('jobs').insertOne({ job_url: 'https://jobs.test/a', site: 'staffing', company: 'Example Corp', title: 'Engineer a' });
  const r = await mutate(db, 'prepare', { id: 'a' });
  assert.deepEqual(r, { ok: true, queued: true, resume_status: 'queued' });
  const { resume } = await db.collection('jobs').findOne({ job_url: 'https://jobs.test/a' });
  assert.equal(resume.status, 'queued'); assert.equal(resume.priority, PRIORITY_CLICKED); assert.equal(resume.owner, 'oracle-atriveo'); assert.equal(resume.source, 'staffing');
  assert.equal((await db.collection('descriptions').findOne({ job_url: 'https://jobs.test/a' })).description, jd);
  assert.equal((await mutate(db, 'prepare', { id: 'a' })).resume_status, 'queued', 'a second click is harmless');
  const page = await list(db, new URLSearchParams('view=recommended'));
  assert.equal(page.jobs[0].resume_status, 'queued');
  assert.ok(await claimNextJob(db, 'oracle-atriveo', 60, { minPriority: 1001 }), 'the fast lane builds clicked jobs');
  assert.equal((await mutate(db, 'prepare', { id: 'a' })).resume_status, 'running');
}));

test('a job from Browse with no jobs row gets one, so the worker can build it', () => withDb(async db => {
  await db.collection('staffing_jobs').insertOne(posting('b'));
  assert.equal((await mutate(db, 'prepare', { id: 'b' })).queued, true);
  const row = await db.collection('jobs').findOne({ job_url: 'https://jobs.test/b' });
  assert.equal(row.site, 'staffing'); assert.equal(row.resume.status, 'queued');
}));

test('auto-queue takes new Recommended jobs without a resume, newest first, below the fast lane; a click moves one up', () => withDb(async db => {
  await db.collection('staffing_jobs').insertMany([
    posting('old', { day: 1 }), posting('new', { day: 5 }), posting('done', { day: 3 }), posting('auth', { day: 4, description: `${jd} US citizen only.` }), posting('passed', { day: 2 }), posting('browse-only', { day: 6 }),
  ]);
  await db.collection('jobs').insertMany(['old', 'new', 'auth', 'passed'].map(id => ({ job_url: `https://jobs.test/${id}`, site: 'staffing', company: 'Example Corp', title: `Engineer ${id}` }))
    .concat({ job_url: 'https://jobs.test/done', site: 'staffing', resume: { status: 'success', pdf_path: '/resumes/done.pdf' } }));
  await mutate(db, 'decision', { id: 'passed', state: 'passed' });
  assert.equal(await queueRecommended(db), 2);
  const queued = await db.collection('jobs').find({ 'resume.status': 'queued' }).toArray();
  assert.deepEqual(queued.map(j => j.job_url).sort(), ['https://jobs.test/new', 'https://jobs.test/old']);
  assert.ok(queued.every(j => j.resume.priority === PRIORITY_STAFFING));
  assert.equal(await claimNextJob(db, 'oracle-atriveo', 60, { minPriority: 1001 }), null, 'the fast lane stays free for clicks');
  assert.equal(await queueRecommended(db), 0, 'a second sweep queues nothing new');
  await mutate(db, 'prepare', { id: 'old' });
  assert.equal((await db.collection('jobs').findOne({ job_url: 'https://jobs.test/old' })).resume.priority, PRIORITY_CLICKED);
}));

test('the workspace leaves out skipped companies and gives each card its role track and resume match', () => withDb(async db => {
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staffing-match-'));
  const pdf = path.join(dir, 'Atishay Kasliwal.pdf');
  fs.writeFileSync(pdf, '%PDF');
  fs.writeFileSync(path.join(dir, 'ats-score.json'), JSON.stringify({ job_match: { score: 64.6, requirement_counts: { required: { matched: 4, total: 6 }, preferred: { matched: 1, total: 2 } } } }));
  await db.collection('staffing_jobs').insertMany([posting('keep', { title: 'Software Engineer' }), posting('drop', { company: 'Skipped Staffing LLC' })]);
  await db.collection('jobs').insertMany([
    { job_url: 'https://jobs.test/keep', site: 'staffing', score_pct: 80, resume: { status: 'success', pdf_path: pdf } },
    { job_url: 'https://jobs.test/drop', site: 'staffing', score_pct: 80 },
  ]);
  const page = await list(db, new URLSearchParams('view=recommended&skip=skipped staffing'));
  assert.deepEqual(page.jobs.map(j => j._id), ['keep']);
  assert.equal(page.counts.recommended, 1, 'counts leave skipped companies out too');
  assert.equal(page.jobs[0].track, 'software-engineer');
  assert.deepEqual(page.jobs[0].resume_match, { score: 65, required: { matched: 4, total: 6 }, preferred: { matched: 1, total: 2 } });
  fs.rmSync(dir, { recursive: true, force: true });
}));

test('the workspace filters like Today: track, Mixed in turn, every search word, North Carolina first, then newest; a page is limit long', () => withDb(async db => {
  await db.collection('staffing_jobs').insertMany([
    posting('swe-old', { title: 'Software Engineer', day: 1 }),
    posting('swe-new', { title: 'Backend Software Engineer', day: 5 }),
    posting('swe-nc', { title: 'Software Engineer', location: 'Durham, NC', day: 2 }),
    posting('ai', { title: 'AI Engineer', day: 3 }),
    posting('ds', { title: 'Data Scientist', day: 4 }),
  ]);
  await db.collection('jobs').insertMany(['swe-old', 'swe-new', 'swe-nc', 'ai', 'ds'].map(id => ({ job_url: `https://jobs.test/${id}`, site: 'staffing', score_pct: 70 })));
  const ids = async q => (await list(db, new URLSearchParams(q))).jobs.map(j => j._id);
  assert.deepEqual(await ids('view=recommended'), ['swe-nc', 'swe-new', 'ds', 'ai', 'swe-old']);
  assert.deepEqual(await ids('view=recommended&track=software-engineer'), ['swe-nc', 'swe-new', 'swe-old']);
  assert.deepEqual(await ids('view=recommended&track=mixed'), ['swe-nc', 'ds', 'ai', 'swe-new', 'swe-old']);
  assert.deepEqual(await ids('view=recommended&q=software backend'), ['swe-new']);
  const page = await list(db, new URLSearchParams('view=recommended&limit=2&offset=2'));
  assert.deepEqual(page.jobs.map(j => j._id), ['ds', 'ai']);
  assert.equal(page.total, 5);
  assert.equal(page.track_counts.all, 5); assert.equal(page.track_counts['software-engineer'], 3); assert.equal(page.track_counts['ai-engineer'], 1);
}));
