import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { discover, extractContacts, publicAddress, websiteUrl } from '../../scripts/outreach/discovery.mjs';
import { createOutreachRoutes } from '../../scripts/outreach/routes.mjs';
import { backendFixture } from './fixture.mjs';

test('public discovery rejects local addresses and preserves evidence and block boundaries', async () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.throws(() => websiteUrl('http://localhost')); assert.throws(() => websiteUrl('http://192.168.1.1')); assert.throws(() => websiteUrl('https://user:pass@acme.com'));
  const result = extractContacts('<p>Apply to careers@acme.com.</p><p>Accommodation: help@acme.com.</p><a href="/careers">Jobs</a>', 'https://acme.com', 'acme.com');
  assert.deepEqual(result.contacts.map(c => c.email), ['careers@acme.com', 'help@acme.com']);
  assert.deepEqual(result.links, ['https://acme.com/careers']);
  const found = await discover('https://acme.com', '', async url => ({ url, html: '<p>Email jobs@acme.com.</p><a href="/careers">Careers</a>' }));
  assert.equal(found.contacts.length, 1); assert.equal(found.pages.length, 2);
});

test('website approval binds exact words, person, resume and schedule; edit clears approval', async t => {
  const f = await backendFixture(t); await f.service.saveSettings({ paused: false });
  let { draft } = await f.service.create({ jobUrl: f.job.jobUrl });
  ({ draft } = await f.service.save({ ...draft, contact: { email: 'jane@acme.com', type: 'recruiter' } }));
  await assert.rejects(f.service.action({ id: draft.id, revision: draft.revision, action: 'approve' }), /Mark this job applied/);
  await f.applied(); ({ draft } = await f.service.detail(draft.id));
  await assert.rejects(f.service.action({ id: draft.id, revision: draft.revision, action: 'approve' }), /Confirm this recruiter/);
  ({ draft } = await f.service.save({ ...draft, identityConfirmed: true }));
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'upload', name: 'Resume.pdf', base64: Buffer.from('%PDF-1.4\nfixture').toString('base64') }));
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'approve', scheduledAt: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(draft.status, 'queued'); await f.service.tick(); assert.equal(f.sent.length, 0);
  const approved = await f.store.get(draft.id); assert.ok(approved.approval.digest);
  const old = draft; ({ draft } = await f.service.save({ ...draft, body: 'Updated message' }));
  assert.equal((await f.store.get(draft.id)).approval, null);
  await assert.rejects(f.service.save({ ...old, body: 'Stale edit' }), /changed in another window/);
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'approve', scheduledAt: new Date(Date.now() + 60000).toISOString() }));
  await f.db.collection('outreach').updateOne({ _id: draft.id }, { $set: { notBefore: new Date(Date.now() - 1000).toISOString() } });
  await Promise.all([f.service.tick(), f.service.tick()]); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].body, 'Updated message'); assert.equal(f.sent[0].attachment.fileName, 'Resume.pdf');
  await f.service.tick(); assert.equal(f.sent.length, 1);
});

test('exclusion evidence overrides manual hiring label and fabricated discovery is rejected by HTTP', async t => {
  const f = await backendFixture(t); let { draft } = await f.service.create({ jobUrl: f.job.jobUrl });
  ({ draft } = await f.service.save({ ...draft, website: 'https://acme.com', websiteConfirmed: true }));
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'discover_result', discovery: { contacts: [{ email: 'careers@acme.com', sourceUrl: 'https://acme.com/careers', evidence: 'For accommodation please email careers@acme.com.' }], pages: [], errors: [], portalOnly: false, checkedAt: new Date().toISOString() } }));
  assert.equal(draft.discovery.contacts[0].type, 'blocked');
  ({ draft } = await f.service.save({ ...draft, contact: { email: 'careers@acme.com', type: 'hiring' } })); assert.equal(draft.status, 'blocked');
  const handler = createOutreachRoutes(f.run); const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/outreach/action`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'discover_result' }) }); assert.equal(response.status, 400);
  const foreign = await fetch(url, { method: 'POST', headers: { Origin: 'https://attacker.com', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(foreign.status, 403);
});

test('automatic hiring mail waits ten minutes and cancellation prevents requeuing; info inbox stays manual', async t => {
  const f = await backendFixture(t); await f.applied(); await f.service.saveSettings({ paused: false, autoHiring: true });
  let { draft } = await f.service.create({ jobUrl: f.job.jobUrl });
  ({ draft } = await f.service.save({ ...draft, website: 'https://acme.com', websiteConfirmed: true, autoWhenApplied: true }));
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'discover_result', discovery: { contacts: [{ email: 'careers@acme.com', evidence: 'Apply: careers@acme.com.', sourceUrl: 'https://acme.com/careers' }], pages: [], errors: [], portalOnly: false, checkedAt: new Date().toISOString() } }));
  ({ draft } = await f.service.save({ ...draft, contact: { email: 'careers@acme.com', type: 'hiring' } }));
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'upload', name: 'Resume.pdf', base64: Buffer.from('%PDF-1.4\nfixture').toString('base64') }));
  const before = Date.now(); await f.service.tick(); ({ draft } = await f.service.detail(draft.id));
  assert.equal(draft.status, 'queued'); assert.ok(Date.parse(draft.scheduledAt) >= before + 600000); assert.equal(f.sent.length, 0);
  ({ draft } = await f.service.action({ id: draft.id, revision: draft.revision, action: 'cancel' }));
  await f.service.tick(); assert.equal((await f.service.detail(draft.id)).draft.status, 'needs_review');
  ({ draft } = await f.service.save({ ...draft, autoWhenApplied: true, contact: { email: 'info@acme.com', type: 'general' } }));
  await f.service.tick(); assert.equal((await f.service.detail(draft.id)).draft.status, 'needs_review'); assert.equal(f.sent.length, 0);
});

test('invalid templates do not change settings and no-email postings cannot be approved through a manual contact', async t => {
  const f = await backendFixture(t);
  await assert.rejects(f.service.saveSettings({ paused: false, subjectTemplate: 'Hello {{unknown}}', bodyTemplate: 'Message' }), /doesn't know/);
  assert.equal(f.service.settings().paused, true);
  await f.service.saveSettings({ paused: false }); await f.applied();
  await f.db.collection('descriptions').insertOne({ job_url: f.job.jobUrl, description: 'Please do not email applications. Use the portal.' });
  let { draft } = await f.service.create({ jobUrl: f.job.jobUrl });
  ({ draft } = await f.service.save({ ...draft, contact: { email: 'info@acme.com', type: 'general' } }));
  await assert.rejects(f.service.action({ id: draft.id, revision: draft.revision, action: 'approve' }), /does not permit outreach/);
});


test('JSON process bridge persists and reads a draft using only the isolated test database', async t => {
  const f = await backendFixture(t);
  const engine = process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo');
  fs.copyFileSync(path.join(engine, 'config/profile.example.yaml'), path.join(f.directory, 'profile.yaml'));
  fs.writeFileSync(path.join(f.directory, 'engine.yaml'), 'mongo:\n  dbName: outreach_web\noutreach:\n  enabled: false\n');
  const run = (op, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(engine, 'src/cli/outreachWeb.ts')], { cwd: engine, env: { ...process.env, PLAYATRIVEO_HOME: f.directory, MONGO_URI: f.mongoUri, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.resume(); child.on('error', reject);
    child.on('close', () => { try { resolve(JSON.parse(output)); } catch { reject(new Error('Bridge did not return JSON')); } });
    child.stdin.end(JSON.stringify({ op, input }));
  });
  const created = await run('create', { jobUrl: f.job.jobUrl }); assert.equal(created.ok, true); assert.equal(created.draft.company, f.job.company);
  const listed = await run('list', {}); assert.equal(listed.drafts.length, 1); assert.equal(listed.drafts[0].id, created.draft.id);
});
