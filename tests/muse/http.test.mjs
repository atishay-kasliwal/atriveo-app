import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { handleMuse } from '../../scripts/muse-http.mjs';

const token = 'synthetic-test-token';
const hash = createHash('sha256').update(token).digest('hex');
test('dedicated bearer authentication only reaches the two read/draft routes', async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (await handleMuse(req, res, new URL(req.url, 'http://localhost'), { hash, run: async input => { calls.push(input); return { ok: true }; } })) return;
    res.writeHead(401); res.end('Dashboard credential required');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Bearer ${token}` };
  try {
    assert.equal((await fetch(`${base}/integrations/muse/questions`)).status, 401);
    assert.equal((await fetch(`${base}/integrations/muse/questions`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/integrations/muse/questions?limit=2`, { headers: auth })).status, 200);
    assert.deepEqual(calls[0], { operation: 'questions', query: { limit: '2' } });
    assert.equal((await fetch(`${base}/integrations/muse/drafts`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: 'test' }) })).status, 200);
    assert.deepEqual(calls[1], { operation: 'drafts', body: { applicationId: 'test' } });
    for (const route of ['/applications/action', '/applications/review-queue', '/scrape/start', '/health']) assert.equal((await fetch(base + route, { headers: auth })).status, 401);
    assert.equal((await fetch(`${base}/integrations/muse/approve_submit`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/integrations/muse/questions`, { method: 'POST', headers: auth })).status, 405);
    assert.equal((await fetch(`${base}/integrations/muse/drafts`, { method: 'POST', headers: auth, body: '{}' })).status, 415);
    assert.equal((await fetch(`${base}/integrations/muse/drafts`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: 'invalid' })).status, 400);
    assert.equal((await fetch(`${base}/integrations/muse/drafts`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: 'x'.repeat(200001) })).status, 413);
    assert.equal(calls.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('missing configured hash fails closed and internal errors are sanitized', async () => {
  const server = http.createServer(async (req, res) => handleMuse(req, res, new URL(req.url, 'http://localhost'), { hash: req.url.endsWith('disabled') ? undefined : hash, run: async () => { throw new Error('secret internal detail'); } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const disabled = await fetch(base + '/integrations/muse/disabled', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(disabled.status, 401);
    const failed = await fetch(base + '/integrations/muse/questions', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes('secret internal detail'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
