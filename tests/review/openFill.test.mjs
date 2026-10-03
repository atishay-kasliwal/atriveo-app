import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readyForApproval, readyForYou, reviewQueue } from '../../scripts/applications-analytics.mjs';
import { handleFillRoute, isLocalExtensionRequest, runManualFill } from '../../scripts/fill-routes.mjs';

// Open & Fill in the dashboard: Ashby/Lever applications waiting for you to submit, the sidecar's
// local-only fill routes, and the built Ready page (local fixtures; nothing is submitted anywhere).

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

test('built Ready page: Open & Fill instead of Approve for Ashby/Lever; arms, then opens the form in a new tab', async () => {
  const { chromium } = requireEngine('playwright');
  const manualRow = { id: 'm1', company: 'Test Ashby', companyKey: 'test-ashby', title: 'Software Engineer', location: null, ats: 'ashby', url: 'https://jobs.ashbyhq.com/test/x', priority: 5, updatedAt: '2026-10-03T19:00:00Z', filledAt: '2026-10-03T18:00:00Z', resumeFile: 'r.pdf', answered: 6, readyAtCompany: 1, companySubmittedToday: false, openFill: null };
  const formUrl = 'https://jobs.ashbyhq.com/test/1f0e2d3c-4b5a-4968-8776-655443322110/application';
  const queue = { ok: true, generatedAt: '2026-10-03T19:00:00Z', counts: { unanswered: 0, questions: 0, ready: 1 }, ready: [], approved: [], manual: [manualRow], worker: { online: false, updatedAt: '2026-10-03T19:00:00Z' }, killSwitch: { enabled: true, reason: null } };
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const run = async ({ extension }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const actions = [];
      const opened = [];
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test reviewer', email: 'test@example.test' } } });
        if (url.pathname === '/applications/review-queue') return route.fulfill({ json: queue });
        if (url.pathname === '/applications/detail') return route.fulfill({ status: 404, json: { ok: false, error: 'not in this test' } });
        if (url.pathname === '/applications/action') {
          const body = route.request().postDataJSON();
          actions.push(body);
          return route.fulfill({ json: { ok: true, action: body.action, url: formUrl, expiresAt: '2026-10-03T19:15:00Z' } });
        }
        if (url.hostname === 'jobs.ashbyhq.com') { opened.push(url.href); return route.fulfill({ contentType: 'text/html', body: '<title>form</title>' }); }
        if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
        return route.abort();
      });
      if (extension) {
        // Stands in for the extension's dashboard script: marks the page, answers the arm request.
        await context.addInitScript(() => {
          const mark = () => document.documentElement?.setAttribute('data-atriveo-fill', '0.1.0');
          mark();
          document.addEventListener('readystatechange', mark);
          window.addEventListener('message', (e) => {
            if (e.source === window && e.data?.source === 'atriveo-dashboard' && e.data.type === 'arm') {
              window.__armed = e.data;
              window.postMessage({ source: 'atriveo-fill', type: 'armed', nonce: e.data.nonce, reply: { ok: true } }, location.origin);
            }
          });
        });
      }
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/ready`);
      await page.getByText('You submit these').waitFor();
      return { context, page, actions, opened };
    };

    // Without the extension: listed, explained, no way to approve it, and Open & Fill is off.
    const without = await run({ extension: false });
    await without.page.locator('.rv-row', { hasText: 'Test Ashby' }).click();
    const openButton = without.page.getByRole('button', { name: 'Open & Fill' });
    assert.equal(await openButton.isDisabled(), true);
    await without.page.getByText('needs the Atriveo Fill extension').waitFor();
    assert.equal(await without.page.getByRole('button', { name: 'Approve and submit' }).count(), 0);
    assert.match(await without.page.locator('.rv-bar-actions .rv-primary').textContent(), /Approve all \(0\)/);
    await without.context.close();

    // With it: one click arms the application (version included), tells the extension, opens the form.
    const withExt = await run({ extension: true });
    await withExt.page.locator('.rv-row', { hasText: 'Test Ashby' }).click();
    const popup = withExt.context.waitForEvent('page');
    await withExt.page.getByRole('button', { name: 'Open & Fill' }).click();
    const tab = await popup;
    await tab.waitForURL(formUrl);
    assert.deepEqual(withExt.actions, [{ action: 'open_and_fill', applicationId: 'm1', expectedUpdatedAt: '2026-10-03T19:00:00Z' }]);
    assert.deepEqual(await withExt.page.evaluate(() => ({ url: window.__armed.url, applicationId: window.__armed.applicationId })), { url: formUrl, applicationId: 'm1' });
    await withExt.page.getByText(/Atriveo Fill fills it and stops/).waitFor();
    assert.ok(!withExt.actions.some((a) => a.action === 'approve_submit'));
    await withExt.context.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
