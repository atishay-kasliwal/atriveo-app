import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { handleFillRoute } from '../../scripts/fill-routes.mjs';
import { applyHereDocs } from '../../scripts/apply-here-docs.mjs';
import { claimNextJob } from '../../scripts/resume-queue.mjs';
import { loadBullets } from '../../scripts/tailor-bank.mjs';

// Apply with Atriveo's Resume and Cover letter routes on this backend: playatriveo checks first (a stand-in
// `run` here), then the real compile queue (enqueueJob, on an in-memory Mongo) and the real cover letter
// generator (tectonic). Nothing reaches a real database or an employer.

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const JD = 'Build and run payment services in Python and Go. Own reliability, testing and deployment. '.repeat(10);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const request = (route, body) => {
  const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', headers: { origin: 'chrome-extension://atriveo' } });
  const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } };
  return { req, res, url: new URL(`http://127.0.0.1${route}`) };
};

async function withDb(fn) {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try { await fn(client.db('apply_here_docs')); } finally { await client.close(); await mongod.stop(); }
}

test('tailoring: queued for the Oracle resume compiler, after playatriveo\'s check, never over a finished build', async () => {
  await withDb(async (db) => {
    const jobUrl = 'https://job-boards.greenhouse.io/examplecorp/jobs/1';
    await db.collection('jobs').insertMany([{ job_url: jobUrl, company: 'Example Corp', title: 'Engineer' }, { job_url: 'done', company: 'Example Corp', title: 'Engineer', resume: { status: 'success', pdf_path: '/x/Jane Doe.pdf' } }]);
    const asked = [];
    const docs = applyHereDocs({ withMongo: (fn) => fn(db), outRoot: os.tmpdir(), bank: [], workerId: () => 'oracle-atriveo' });
    const run = async (r) => { asked.push(r); return r.applicationId === 'not-yours' ? { ok: false, error: "This application isn't open in your browser any more." } : { ok: true, jobUrl: r.applicationId === 'finished' ? 'done' : jobUrl, company: 'Example Corp', title: 'Engineer', location: null }; };

    const call = async (body) => { const { req, res, url } = request('/applications/fill-tailor', body); await handleFillRoute(req, res, url, run, docs); return res; };
    const refused = await call({ applicationId: 'not-yours', expectedUpdatedAt: 't' });
    assert.equal(refused.status, 400);
    assert.equal((await db.collection('jobs').findOne({ job_url: jobUrl })).resume, undefined, 'nothing queued when the check refuses');

    const ok = await call({ applicationId: 'a1', expectedUpdatedAt: 't' });
    assert.deepEqual(ok.body, { ok: true, jobUrl, skipped: false });
    assert.deepEqual(asked.at(-1), { op: 'tailor_check', applicationId: 'a1', expectedUpdatedAt: 't' });
    const queued = (await db.collection('jobs').findOne({ job_url: jobUrl })).resume;
    assert.equal(queued.status, 'queued');
    assert.equal(queued.owner, 'oracle-atriveo');
    assert.equal(queued.source, 'extension');
    assert.equal(await claimNextJob(db, 'dashboard-container-1234', 60), null, 'a worker with another id never takes it');
    assert.equal((await claimNextJob(db, 'oracle-atriveo', 60)).job_url, jobUrl, 'the Oracle compiler claims it');

    const again = await call({ applicationId: 'finished', expectedUpdatedAt: 't' });
    assert.equal(again.body.reason, 'already_success');
    assert.equal((await db.collection('jobs').findOne({ job_url: 'done' })).resume.pdf_path, '/x/Jane Doe.pdf', 'a finished resume is never replaced');
  });
});

test('cover letter: the real template generator writes a new letter in a new folder, never over an existing one, then it is recorded as a draft', async () => {
  await withDb(async (db) => {
    const jobUrl = 'https://jobs.lever.co/examplecorp/1';
    await db.collection('descriptions').insertOne({ job_url: jobUrl, description: JD });
    const resumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-run-'));
    const existing = path.join(resumeDir, 'Jane Doe - Cover Letter.pdf');
    fs.writeFileSync(existing, '%PDF-1.4 an older letter');
    const before = sha(existing);
    const asked = [];
    const run = async (r) => { asked.push(r); return r.op === 'cover_check' ? { ok: true, jobUrl, company: 'Example Corp', title: 'Software Engineer', resumeDir } : { ok: true, draft: { path: r.path, status: 'draft' }, updatedAt: 'u2' }; };
    const docs = applyHereDocs({ withMongo: (fn) => fn(db), outRoot: os.tmpdir(), bank: loadBullets() });
    const { req, res, url } = request('/applications/fill-cover', { applicationId: 'a1', expectedUpdatedAt: 'u1' });
    await handleFillRoute(req, res, url, run, docs);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const recorded = asked.find((r) => r.op === 'cover_recorded');
    assert.ok(recorded, 'recorded as a draft by playatriveo');
    assert.ok(recorded.path.startsWith(path.join(resumeDir, 'cover-letters') + path.sep), recorded.path);
    assert.match(path.basename(recorded.path), / - Cover Letter\.pdf$/);
    assert.ok(fs.readFileSync(recorded.path).subarray(0, 4).toString() === '%PDF');
    assert.equal(sha(existing), before, 'the existing letter is untouched');
    assert.deepEqual(res.body, { ok: true, draft: { path: recorded.path, status: 'draft' }, updatedAt: 'u2' });
  });
});

test('the other document routes reach playatriveo with exactly their fields; only the extension may call them', async () => {
  const asked = [];
  const run = async (r) => { asked.push(r); return { ok: true }; };
  for (const [route, body] of [
    ['/applications/fill-resume', { applicationId: 'a', document: 'cover_letter' }],
    ['/applications/fill-documents', { applicationId: 'a', extra: 'ignored' }],
    ['/applications/fill-file', { applicationId: 'a', path: '/p.pdf' }],
    ['/applications/fill-select-resume', { applicationId: 'a', expectedUpdatedAt: 'u', path: '/p.pdf', sha256: 'f'.repeat(64), acceptBasic: 'yes' }],
    ['/applications/fill-cover-accept', { applicationId: 'a', expectedUpdatedAt: 'u', path: '/c.pdf', sha256: 'e'.repeat(64) }],
    ['/applications/fill-cover-clear', { applicationId: 'a', expectedUpdatedAt: 'u' }],
  ]) { const { req, res, url } = request(route, body); await handleFillRoute(req, res, url, run); assert.equal(res.status, 200, route); }
  assert.deepEqual(asked, [
    { op: 'resume', applicationId: 'a', document: 'cover_letter' },
    { op: 'documents', applicationId: 'a' },
    { op: 'file', applicationId: 'a', path: '/p.pdf' },
    { op: 'select_resume', applicationId: 'a', expectedUpdatedAt: 'u', path: '/p.pdf', sha256: 'f'.repeat(64), acceptBasic: false },
    { op: 'cover_accept', applicationId: 'a', expectedUpdatedAt: 'u', path: '/c.pdf', sha256: 'e'.repeat(64) },
    { op: 'cover_clear', applicationId: 'a', expectedUpdatedAt: 'u' },
  ]);
  const { req, res, url } = request('/applications/fill-tailor', { applicationId: 'a' });
  req.headers = { origin: 'chrome-extension://atriveo', 'cf-ray': 'x' };
  await handleFillRoute(req, res, url, run);
  assert.equal(res.status, 403, 'never through the relay');
  const noDocs = request('/applications/fill-cover', { applicationId: 'a' });
  await handleFillRoute(noDocs.req, noDocs.res, noDocs.url, async () => ({ ok: true }));
  assert.match(noDocs.res.body.error, /isn't available on this server/);
});
