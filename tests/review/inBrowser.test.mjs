import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { inBrowserRow, overviewSummary, returnToWorkerBlock, reviewQueue } from '../../scripts/applications-analytics.mjs';

// Applications open in your browser (Apply with Atriveo, playatriveo owner "extension") in the dashboard:
// never in the Unanswered / Ready / Today action lists, listed as "Applying in your browser" with only the
// actions the backend accepts (Return to worker when allowed, Skip). Engine-owned rows are unchanged.
// Real in-memory Mongo for the data, the built console for the pages; nothing leaves the machine.

const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date('2026-10-04T15:00:00.000Z');
const resume = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ib-')), 'Jane Doe.pdf');
fs.writeFileSync(resume, '%PDF-1.4');

const pending = (label) => ({ fingerprint: label, fieldKey: label, label, type: 'textarea', required: true, reason: 'UNKNOWN_QUESTION', detail: 'A written answer: yours' });
const base = (id, extra = {}) => ({
  _id: id, applicationKey: `greenhouse:${id}`, duplicateKey: `co ${id}|engineer|`, company: `Co ${id}`, companyKey: `co ${id}`, title: 'Engineer', location: null, ats: 'greenhouse',
  applyUrl: `https://job-boards.greenhouse.io/co/jobs/${id}`, finalUrl: null, priority: 1, status: 'NEEDS_REVIEW', lease: null, createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: `2026-10-04T1${id.length % 9}:00:00.000Z`, lifecycle: { reviewAt: '2026-10-04T12:00:00.000Z' }, attempts: [], attemptCount: 0, history: [], questions: [],
  resume: { path: resume, fileName: 'Jane Doe.pdf', sha256: 'abc' },
  submission: { attemptedAt: null, submittedAt: null, approvalRequestedAt: null, approvalInAttemptAt: null, validation: { passed: true }, formSignature: 'sig', certification: { status: 'CERTIFIED' } },
  ...extra,
});
const inBrowser = (id, extra = {}, submission = {}) => base(id, {
  owner: 'extension', review: { reason: 'IN_EXTENSION', detail: 'Open in your browser', since: '2026-10-04T12:00:00.000Z', pending: [pending('Why us?')], failedChecks: [] },
  extension: { startedAt: '2026-10-04T12:00:00.000Z', takenOverFrom: null, pageUrl: 'https://job-boards.greenhouse.io/co/jobs/1', preview: null },
  ...extra, submission: { ...base(id).submission, ...submission },
});
const seed = () => [
  // The worker's: questions waiting (Unanswered), approval waiting (Ready).
  base('eq', { review: { reason: 'UNKNOWN_QUESTION', detail: 'questions', since: 't', pending: [pending('Why us?')], failedChecks: [] } }),
  base('ea', { review: { reason: 'SUBMIT_APPROVAL', detail: 'ready', since: 't', pending: [], failedChecks: [] } }),
  // Yours in the browser: one can go back to the worker, one was just filled (its page may still be submitted).
  inBrowser('xb', { title: 'Engineer (browser)' }),
  inBrowser('xf', { title: 'Engineer (filled)' }, { manualFill: { armedAt: '2026-10-04T14:30:00.000Z', planServedAt: '2026-10-04T14:30:00.000Z', filledAt: '2026-10-04T14:31:00.000Z', report: { filled: 9, mismatched: [], missing: [], yours: 1 } } }),
];

test('Return to worker is offered exactly when playatriveo would allow it', () => {
  const ok = inBrowser('a');
  const exists = (p) => p === resume;
  assert.equal(returnToWorkerBlock(ok, now, exists), null);
  const cases = [
    [{ ...ok, status: 'APPLIED' }, /already applied/],
    [{ ...ok, status: 'SUBMITTING' }, /being submitted/],
    [{ ...ok, status: 'APPLYING' }, /being filled/],
    [{ ...ok, lease: { workerId: 'w', until: 'x' } }, /being filled/],
    [{ ...ok, submission: { ...ok.submission, attemptedAt: '2026-10-04T13:00:00.000Z' } }, /Submit was already attempted/],
    [{ ...ok, review: { ...ok.review, reason: 'SPAM_BLOCKED' } }, /Submit was already attempted/],
    [inBrowser('b', {}, { manualFill: { armedAt: '2026-10-04T14:00:00.000Z', planServedAt: '2026-10-04T14:00:00.000Z' } }), /may still submit it/],
    [{ ...ok, status: 'SKIPPED' }, /isn't open in your browser/],
    [{ ...ok, owner: undefined }, /already belongs to the worker/],
    [{ ...ok, resume: { path: '' } }, /no resume file/],
  ];
  for (const [r, why] of cases) assert.match(returnToWorkerBlock(r, now, exists) ?? 'ALLOWED', why);
  // A fill session older than four hours is over; a takeover from review needs no resume (it goes back to review).
  assert.equal(returnToWorkerBlock(inBrowser('c', {}, { manualFill: { armedAt: '2026-10-04T10:00:00.000Z', planServedAt: '2026-10-04T10:00:00.000Z' } }), now, exists), null);
  assert.equal(returnToWorkerBlock({ ...ok, resume: { path: '' }, extension: { ...ok.extension, before: { status: 'NEEDS_REVIEW', review: { reason: 'UNKNOWN_QUESTION' } } } }, now, exists), null);
  assert.deepEqual(inBrowserRow(ok, now, exists), { ...inBrowserRow(ok, now, exists), state: 'Applying in your browser', canReturn: true, returnBlock: null, pending: 1 });
});

test('the review queue leaves your browser\'s applications out of every action list and lists them separately', async () => {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try {
    const db = client.db('ib');
    await db.collection('applications').insertMany(seed());
    const unanswered = await reviewQueue(db, { view: 'unanswered', cards: 10, now });
    assert.deepEqual(unanswered.unanswered.map((r) => r.id), ['eq'], 'only the worker\'s application waits on the Unanswered page');
    assert.deepEqual(unanswered.cards.map((r) => r.id), ['eq']);
    assert.equal((await reviewQueue(db, { view: 'cards', ids: ['xb', 'xf'], now })).cards.length, 0, 'no question cards (with Approve) for them');
    const ready = await reviewQueue(db, { view: 'ready', now });
    assert.deepEqual(ready.ready.map((r) => r.id), ['ea'], 'Ready lists the worker\'s approval only');
    assert.equal(ready.manual.length, 0);
    assert.equal(ready.counts.inBrowser, 2);
    const byId = Object.fromEntries(ready.inBrowser.map((r) => [r.id, r]));
    assert.equal(byId.xb.canReturn, true);
    assert.equal(byId.xf.canReturn, false);
    assert.match(byId.xf.returnBlock, /may still submit it/);
    const counts = await reviewQueue(db, { view: 'counts', now });
    assert.equal(counts.counts.unanswered, 1);
    assert.equal(counts.counts.ready, 1);
    // The Overview's attention list says what it is, with the same Return to worker answer.
    const summary = await overviewSummary(db, {});
    const row = summary.attention.find((h) => h.id === 'xb');
    assert.equal(row.owner, 'extension');
    assert.equal(row.inBrowser.canReturn, true);
    assert.equal(summary.attention.find((h) => h.id === 'eq').owner, 'engine');
    assert.equal(summary.attention.find((h) => h.id === 'eq').inBrowser, undefined, 'engine rows unchanged');
    globalThis.__ib = { ready: JSON.parse(JSON.stringify(ready)), summary: JSON.parse(JSON.stringify(summary)) };
  } finally {
    await client.close();
    await mongod.stop();
  }
});

async function console_(json, actionReply = () => ({ ok: true })) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const calls = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/applications/action') { const body = route.request().postDataJSON(); calls.push(body); return route.fulfill({ json: actionReply(body) }); }
    const reply = json(url);
    if (reply) return route.fulfill({ json: reply });
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  return { page, calls, errors, base: `http://127.0.0.1:${port}`, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}

test('Ready page: "Applying in your browser" with only Return to worker (when allowed) and Skip', async () => {
  const { ready } = globalThis.__ib;
  const f = await console_((url) => url.pathname === '/applications/review-queue' ? ready : url.pathname === '/applications/detail' ? { ok: true, id: 'ea', company: 'Co ea', title: 'Engineer', ats: 'greenhouse', status: 'NEEDS_REVIEW', url: 'https://x.test', owner: 'engine', inBrowser: null, resume: {}, questions: [], timeline: [], attempts: [], submission: {}, failure: null } : null);
  try {
    await f.page.goto(`${f.base}/ready`);
    const section = f.page.getByRole('region', { name: 'Applying in your browser' });
    await section.waitFor();
    const rows = section.locator('.ib-row');
    assert.equal(await rows.count(), 2);
    const xb = section.locator('.ib-row[data-id="xb"]');
    const xf = section.locator('.ib-row[data-id="xf"]');
    for (const row of [xb, xf]) {
      for (const name of [/Approve/, /Open & Fill/, /Fill and verify/, /Retry/, /Continue/, /Save answers/]) assert.equal(await row.getByRole('button', { name }).count(), 0, `${name} is never offered`);
    }
    assert.equal(await xb.getByRole('button', { name: 'Return to worker' }).isEnabled(), true);
    assert.equal(await xf.getByRole('button', { name: 'Return to worker' }).isDisabled(), true);
    await xf.getByText(/Return to worker: You filled it in your browser/).waitFor();
    // The worker's approval is still offered as before, and only for its own row.
    await f.page.getByRole('button', { name: /Co ea/ }).first().waitFor();
    assert.equal(await f.page.locator('.rv-rows button.rv-row').count(), 1);

    assert.equal(f.calls.length, 0, 'looking sends nothing');
    await xb.getByRole('button', { name: 'Return to worker' }).click();
    await f.page.getByText('Co xb is back with the worker. Nothing was approved.').waitFor();
    assert.deepEqual(f.calls, [{ action: 'return_to_worker', applicationId: 'xb', expectedUpdatedAt: ready.inBrowser.find((r) => r.id === 'xb').updatedAt }]);
    await xb.getByRole('button', { name: 'Skip' }).click();
    assert.equal(f.calls.length, 1, 'Skip asks first');
    await xb.locator('.rv-confirm').getByRole('button', { name: 'Skip' }).click();
    await f.page.waitForTimeout(200);
    assert.equal(f.calls.at(-1).action, 'skip');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Overview: an application open in your browser says so, and its review offers only Return to worker and Skip', async () => {
  const { summary } = globalThis.__ib;
  const f = await console_((url) => url.pathname === '/applications/analytics'
    ? (url.searchParams.get('view') === 'history' ? { ok: true, generatedAt: now.toISOString(), rows: summary.attention, total: summary.attention.length, skip: 0, limit: 25 } : summary)
    : url.pathname === '/applications/review-queue' ? { ok: true, generatedAt: now.toISOString(), cards: [], counts: { unanswered: 1, questions: 1, ready: 1 }, unanswered: [] } : null);
  try {
    await f.page.goto(`${f.base}/stats`);
    const attention = f.page.getByRole('region', { name: /Needs your attention/ });
    await attention.waitFor();
    const row = attention.locator('li', { hasText: 'Co xb' });
    await row.getByText('Applying in your browser').waitFor();
    assert.equal(await row.getByRole('button', { name: 'Retry' }).count(), 0);
    await row.getByRole('button', { name: 'Review' }).click();
    const drawer = f.page.getByRole('dialog', { name: 'Review Co xb' });
    await drawer.getByText(/You opened it with Apply with Atriveo/).waitFor();
    const buttons = await drawer.locator('.apps-drawer-body button').allInnerTexts();
    assert.deepEqual(buttons.sort(), ['Return to worker', 'Skip']);
    // The worker's own application keeps its usual review actions.
    await drawer.getByRole('button', { name: 'Close review' }).click();
    await attention.locator('li', { hasText: 'Co eq' }).getByRole('button', { name: 'Review' }).click();
    await f.page.getByRole('dialog', { name: 'Review Co eq' }).getByRole('button', { name: 'Retry without changes' }).waitFor();
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
