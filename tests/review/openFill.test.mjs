import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readyForApproval, readyForYou, reviewQueue } from '../../scripts/applications-analytics.mjs';
import { handleFillRoute, isLocalExtensionRequest, runManualFill } from '../../scripts/fill-routes.mjs';

// Open & Fill in the dashboard: Ashby/Lever applications waiting for you to submit, the sidecar's
// local-only fill routes (local fixtures; nothing is submitted anywhere).


const doc = (id, reason, extra = {}) => ({
  _id: id, company: `Co ${id}`, companyKey: `co-${id}`, title: 'Engineer', status: 'NEEDS_REVIEW', ats: reason === 'MANUAL_SUBMIT' ? 'ashby' : 'greenhouse',
  applyUrl: `https://example.test/${id}`, priority: 1, updatedAt: '2026-10-03T19:00:00Z', answered: 6, resume: { fileName: 'r.pdf', sha256: 'abc' },
  review: { reason, since: '2026-10-03T18:00:00Z', pending: [], failedChecks: [] },
  submission: { attemptedAt: null, submittedAt: null, validation: { passed: true }, formSignature: 'sig', certification: { status: 'CERTIFIED' }, ...extra },
});

test('Ready view: Ashby/Lever waiting for you are listed for Open & Fill, never for approval', async () => {
  const manual = doc('m1', 'MANUAL_SUBMIT', { manualFill: { armedAt: '2026-10-03T19:01:00Z', filledAt: '2026-10-03T19:02:00Z', report: { filled: 6, mismatched: [], missing: ['x'], yours: 1 } } });
  const approval = doc('a1', 'SUBMIT_APPROVAL');
  assert.equal(readyForYou(manual), true);
  assert.equal(readyForApproval(manual), false);
  assert.equal(readyForYou(approval), false);
  assert.equal(readyForYou({ ...manual, submission: { ...manual.submission, attemptedAt: '2026-10-03T19:03:00Z' } }), false, 'a submit attempt (e.g. spam block) leaves the list');
  assert.equal(readyForYou({ ...manual, submission: { ...manual.submission, certification: { status: 'BLOCKED' } } }), false, 'only certified forms');

  // A stand-in database: only the Ready query's match returns rows.
  const isReadyMatch = (pipeline) => JSON.stringify(pipeline[0]?.$match ?? {}).includes('"review.reason":{"$in":["SUBMIT_APPROVAL","MANUAL_SUBMIT"]}');
  const db = { collection: (name) => ({
    aggregate: (pipeline) => ({ toArray: async () => (name === 'applications' && isReadyMatch(pipeline) ? [manual, approval] : []) }),
    find: () => ({ toArray: async () => [] }),
    findOne: async () => null,
  }) };
  const view = await reviewQueue(db, { view: 'ready', now: new Date('2026-10-03T20:00:00Z') });
  assert.deepEqual(view.ready.map((r) => r.id), ['a1']);
  assert.deepEqual(view.manual.map((r) => r.id), ['m1']);
  assert.deepEqual(view.manual[0].openFill, { armedAt: '2026-10-03T19:01:00Z', filledAt: '2026-10-03T19:02:00Z', filled: 6, toCheck: 1 });
  assert.equal(view.counts.ready, 2, 'the Ready badge counts both');
  assert.deepEqual(view.approved, []);
});

test('fill routes answer only the Atriveo Fill extension on this Mac, never the relay', async () => {
  const calls = [];
  const run = async (request) => { calls.push(request); return { ok: true, echo: request.op }; };
  const server = http.createServer(async (req, res) => {
    if (!(await handleFillRoute(req, res, new URL(req.url, 'http://127.0.0.1'), run))) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ext = { Origin: 'chrome-extension://abcdefghijklmnop' };
  try {
    const plan = await fetch(`${base}/applications/fill-plan?url=${encodeURIComponent('https://jobs.ashbyhq.com/a/b/application')}`, { headers: ext });
    assert.equal(plan.status, 200);
    assert.deepEqual(await plan.json(), { ok: true, echo: 'plan' });
    const event = await fetch(`${base}/applications/fill-event`, { method: 'POST', headers: { ...ext, 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: 'x', event: { type: 'filled' } }) });
    assert.equal(event.status, 200);
    assert.deepEqual(calls.at(-1), { op: 'event', applicationId: 'x', event: { type: 'filled' } });
    const before = calls.length;
    for (const headers of [
      { Origin: 'https://apply.atriveo.com' },                    // the dashboard, through the relay
      { ...ext, 'cf-connecting-ip': '1.2.3.4', 'cf-ray': 'abc' }, // anything that came through Cloudflare
      { ...ext, 'x-forwarded-for': '1.2.3.4' },
      {},
    ]) {
      const r = await fetch(`${base}/applications/fill-resume?id=x`, { headers });
      assert.equal(r.status, 403);
    }
    assert.equal(calls.length, before, 'refused requests never reach playatriveo');
    assert.equal((await fetch(`${base}/applications/review-queue`)).status, 404, 'other routes are not handled here');
    assert.equal(isLocalExtensionRequest({ headers: { origin: 'chrome-extension://x' } }), true);
  } finally {
    server.close();
  }

  // The CLI bridge: JSON on stdin, the last stdout line is the answer.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-cli-'));
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  const tsx = path.join(dir, 'node_modules', '.bin', 'tsx');
  fs.writeFileSync(tsx, '#!/bin/sh\nread -r line\necho "log line"\necho "{\\"ok\\":true,\\"got\\":$line}"\n');
  fs.chmodSync(tsx, 0o755);
  assert.deepEqual(await runManualFill(dir, { op: 'plan', url: 'u' }), { ok: true, got: { op: 'plan', url: 'u' } });
});
