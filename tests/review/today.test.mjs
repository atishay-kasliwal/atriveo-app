import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = '2026-10-04T12:00:00.000Z';

// Built console + fake sidecar: the Today screen's cards, order, actions, and that nothing is sent without a click.
const readyRow = (id, company, extra = {}) => ({ id, company, companyKey: company.toLowerCase(), title: 'Software Engineer', location: 'NY', ats: 'greenhouse', url: 'https://blocked.test', priority: 0, updatedAt: at, filledAt: at, resumeFile: 'resume.pdf', answered: 12, readyAtCompany: 1, companySubmittedToday: false, priorityTags: ['Strong match'], ...extra });
const queued = (id, company, n, extra = {}) => ({ id, company, title: 'Backend Engineer', updatedAt: at, n, readyForReview: Math.max(0, n - 1), needsInput: n ? 1 : 0, actionRequired: 0, ...extra });
// A LinkedIn posting with a resume ready and no application (only the LinkedIn test lists it).
let LINKEDIN = [];
const PENDO = [{ id: 'https://www.linkedin.com/jobs/view/111', url: 'https://www.linkedin.com/jobs/view/111', company: 'Pendo', title: 'Software Engineer', location: 'Raleigh, NC', score: 66, postedAt: null, foundAt: at, track: 'software-engineer', resumeFile: 'Pendo/Jane Doe.pdf', resumePath: '/Users/x/Documents/tailored-resumes/Pendo/Jane Doe.pdf' }];
const view = { ok: true, generatedAt: at, killSwitch: null, worker: { online: true, updatedAt: at }, counts: { fillable: 2, ready: 3 } };
const READY = { ...view, ready: [readyRow('r1', 'Stripe'), readyRow('r2', 'Ramp'), readyRow('m1', 'Spotify', { ats: 'lever' })], manual: [{ ...readyRow('m1', 'Spotify', { ats: 'lever' }), openFill: null }], approved: [] };
// Blocked applications Open & Fill can take: every answer approved (c1) or drafted (d1). Ones needing an answer never reach Today.
// Each row brings its ATS and link, so Open & Fill doesn't wait for anything else.
const link = (id) => ({ ats: 'ashby', url: `https://jobs.example.test/${id}` });
const FILLABLE = { ...view, fillable: [queued('c1', 'Anthropic', 0, link('c1')), queued('d1', 'Figma', 3, { readyForReview: 3, ...link('d1') })] };

async function fixture() {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  const calls = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/applications/review-queue') {
      const v = url.searchParams.get('view');
      if (v === 'linkedin') return route.fulfill({ json: { ok: true, generatedAt: at, linkedin: LINKEDIN } });
      return route.fulfill({ json: v === 'ready' ? READY : v === 'counts' ? view : v === 'fillable' ? FILLABLE : { ok: false, error: `unexpected view ${v}` } });
    }
    if (url.pathname === '/applications/action') { calls.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  // Atriveo Fill 0.4 is installed; record the tabs the page opens instead of opening them.
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-atriveo-fill', '0.4.2')); window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  return { page, calls, errors, base: `http://127.0.0.1:${port}`, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}

test('Today shows what needs you, closest to submission first, five at a time, without page scroll', async () => {
  const f = await fixture(); const { page, calls, errors } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await page.getByText('5 applications waiting for you', { exact: true }).waitFor();
    const order = await page.locator('.td-card .td-id strong').allTextContents();
    assert.deepEqual(order, ['Spotify', 'Stripe', 'Ramp', 'Anthropic', 'Figma'], 'you submit, approve, then Open & Fill; no cards that need answers');
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'no page scroll');
    assert.equal(await page.getByRole('button', { name: /Need answers/ }).count(), 0, 'no Need answers pill');
    assert.equal(calls.length, 0, 'looking sends nothing');
    assert.deepEqual(errors, []);
  } finally { await f.close(); }
});

test('each card runs only its own action; Approve all lists what goes out and waits for confirm', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('article', { name: 'Stripe: Approve to submit' }).getByRole('button', { name: 'Approve submit' }).click();
    await page.getByText(/Approved Stripe\./).waitFor();
    assert.deepEqual(calls.at(-1), { action: 'approve_submit', applicationId: 'r1', expectedUpdatedAt: at });
    await page.getByRole('button', { name: /^Approve all \d+ ready$/ }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.match(await dialog.innerText(), /Ramp/);
    const before = calls.length;
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(calls.length, before, 'cancel sends nothing');
    assert.ok(calls.every((c) => c.action !== 'open_and_fill'));

  } finally { await f.close(); }
});

test('Open on a drafted or approved card opens its job page and sends nothing', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/`);
    const figma = page.getByRole('article', { name: 'Figma: Answers drafted' });
    // Open & Fill needed the Atriveo Fill extension, which Apply with Atriveo replaced: the card opens its page, answers stay under Answers.
    assert.equal(await page.getByRole('button', { name: 'Open & Fill' }).count(), 0);
    await figma.getByRole('button', { name: /^Open/ }).click();
    await page.getByText(/Opened Figma\. Its answers are under Answers/).waitFor();
    await page.getByRole('article', { name: 'Anthropic: Answers approved' }).getByRole('button', { name: /^Open/ }).click();
    await page.getByText(/Opened Anthropic\./).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://jobs.example.test/d1', 'https://jobs.example.test/c1']);
    assert.equal(calls.length, 0, 'opening the job page changes nothing in the engine');
    assert.equal(await figma.count(), 0, 'the opened card slides out');
  } finally { await f.close(); }
});

test('the retired answer pages send old links, deep links included, to Today', async () => {
  const f = await fixture(); const { page, errors } = f;
  try {
    for (const old of ['/unanswered?app=u1', '/answers']) {
      await page.goto(`${f.base}${old}`);
      await page.waitForURL((u) => u.pathname === '/');
      await page.getByRole('article', { name: 'Figma: Answers drafted' }).waitFor();
    }
    assert.equal(await page.getByRole('link', { name: /To answer/ }).count(), 0, 'no To answer link in the header');
    assert.equal(await page.getByRole('button', { name: /^Answer/ }).count(), 0, 'no Answer button on any card');
    assert.deepEqual(errors, []);
  } finally { await f.close(); }
});

test('Fill and verify all lists the approved forms and starts them only on confirm, never submitting', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('button', { name: 'Fill and verify all 1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill and verify all approved applications' });
    assert.match(await dialog.innerText(), /Anthropic/);
    assert.equal(calls.length, 0);
    await dialog.getByRole('button', { name: 'Fill and verify 1' }).click();
    await page.getByText(/Started filling 1 of 1/).waitFor();
    assert.deepEqual(calls, [{ action: 'continue_application', applicationId: 'c1', expectedUpdatedAt: at }]);
  } finally { await f.close(); }
});

test('within Open & Fill: North Carolina first, then the newest posting; score and age on the card; Discard', async () => {
  const saved = FILLABLE.fillable.map((q) => ({ ...q }));
  Object.assign(FILLABLE.fillable.find((q) => q.id === 'c1'), { location: 'New York, NY', postedAt: '2026-10-04T10:00:00.000Z', score: 72 });
  Object.assign(FILLABLE.fillable.find((q) => q.id === 'd1'), { location: 'Raleigh, NC', postedAt: '2026-09-20T10:00:00.000Z', score: 20 });
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.route('**/applications/action', (route) => {
      const body = route.request().postDataJSON(); calls.push(body);
      return route.fulfill({ json: body.operation === 'preview' ? { ok: true, targets: body.ids.map((id) => ({ id, updatedAt: at })) } : { ok: true, discarded: body.targets.map((t) => t.id), errors: [] } });
    });
    await page.goto(`${f.base}/`);
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    const names = await page.locator('.td-card .td-id strong').allTextContents();
    assert.deepEqual(names.slice(3, 5), ['Figma', 'Anthropic'], 'the North Carolina job comes before a newer New York one');
    const anthropic = page.getByRole('article', { name: 'Anthropic: Answers approved' });
    assert.equal(await anthropic.locator('.td-score').textContent(), '72');
    assert.match(await page.getByRole('article', { name: 'Figma: Answers drafted' }).locator('.td-loc').textContent(), /★ Raleigh, NC/);
    await anthropic.getByRole('button', { name: 'Discard' }).click();
    await page.getByText('Discarded 1').waitFor();
    assert.deepEqual(calls.filter((c) => c.action === 'discard_applications').map((c) => c.operation), ['preview', 'confirm']);
    assert.equal(await anthropic.count(), 0, 'a discarded card leaves Today');
  } finally { await f.close(); FILLABLE.fillable.splice(0, FILLABLE.fillable.length, ...saved); }
});

test('LinkedIn postings show as On LinkedIn cards: the button opens the posting, Discard records it as not interested', async () => {
  LINKEDIN = PENDO;
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.route('**/applications/job-dismiss', (route) => { calls.push({ dismiss: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); });
    await page.goto(`${f.base}/`);
    const card = page.getByRole('article', { name: 'Pendo: On LinkedIn' });
    await card.waitFor();
    assert.equal(await card.getByRole('link', { name: /Open on LinkedIn/ }).getAttribute('href'), 'https://www.linkedin.com/jobs/view/111');
    assert.match(await card.locator('.td-loc').textContent(), /Raleigh, NC/);
    // Its tailored resume opens straight from the file (no application to review).
    await card.getByRole('button', { name: /Resume/ }).click();
    assert.match(await page.locator('.pdf-modal-overlay iframe, .pdf-modal-overlay embed, .pdf-modal-overlay object').first().getAttribute('src').catch(() => page.locator('.pdf-modal-overlay').innerHTML()), /serve-pdf\?path=.*Pendo/);
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Discard' }).click();
    await page.getByText('Discarded 1').waitFor();
    assert.deepEqual(calls.filter((c) => c.dismiss), [{ dismiss: { jobUrl: 'https://www.linkedin.com/jobs/view/111' } }]);
    assert.ok(calls.every((c) => c.dismiss || c.action !== 'discard_applications'), 'a LinkedIn posting is not an application');
  } finally { await f.close(); LINKEDIN = []; }
});

// Apply with Atriveo (playatriveo extension 1.9.0+): answers the page's companion messages as the real one does.
const fakeCompanion = () => {
  window.__companion = [];
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || m?.channel !== 'atriveo-companion-v1' || m.source !== 'workspace') return;
    window.__companion.push({ action: m.action, job: m.kit?.job?.id ?? null, resume: m.kit?.resume?.sha256 ?? null });
    window.postMessage({ channel: 'atriveo-companion-v1', source: 'extension', id: m.id, ok: true, panelOpened: m.action === 'OPEN' }, location.origin);
  });
};
const SHA = 'a'.repeat(64);

test('Open Link hands the posting and its exact tailored resume to the Apply with Atriveo panel', async () => {
  LINKEDIN = [{ ...PENDO[0], resumeSha256: SHA }];
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.addInitScript(fakeCompanion);
    await page.route('**/applications/application-kit', (route) => {
      const body = route.request().postDataJSON(); calls.push({ kit: body });
      return route.fulfill({ json: { ok: true, kit: { version: 1, id: '00000000-0000-4000-8000-000000000001', expiresAt: '2099-01-01T00:00:00.000Z', job: { id: body.jobUrl, applyUrl: body.jobUrl }, resume: { sha256: body.resumeSha256 } } } });
    });
    await page.goto(`${f.base}/`);
    const card = page.getByRole('article', { name: 'Pendo: On LinkedIn' });
    await card.getByRole('link', { name: /Open Link/ }).click();
    await page.getByText(/Opened Pendo with its tailored resume in the Atriveo panel/).waitFor();
    assert.deepEqual(calls.filter((c) => c.kit), [{ kit: { jobUrl: 'https://www.linkedin.com/jobs/view/111', resumeSha256: SHA } }]);
    const sent = await page.evaluate(() => window.__companion);
    assert.ok(sent.some((m) => m.action === 'OPEN' && m.job === 'https://www.linkedin.com/jobs/view/111' && m.resume === SHA), JSON.stringify(sent));
    assert.ok(!(await page.evaluate(() => window.__opened)).includes('https://www.linkedin.com/jobs/view/111'), 'the extension opens the job tab, not the page');
  } finally { await f.close(); LINKEDIN = []; }
});

test('Open Link without the extension opens the posting in a plain tab and says why', async () => {
  LINKEDIN = [{ ...PENDO[0], resumeSha256: SHA }];
  const f = await fixture(); const { page } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('article', { name: 'Pendo: On LinkedIn' }).getByRole('link', { name: /Open Link/ }).click();
    await page.getByText(/Opened Pendo without the Atriveo panel/).waitFor({ timeout: 15000 });
    assert.ok((await page.evaluate(() => window.__opened)).includes('https://www.linkedin.com/jobs/view/111'));
  } finally { await f.close(); LINKEDIN = []; }
});

test('Mark applied on an On LinkedIn card records it and takes it off Today', async () => {
  LINKEDIN = PENDO;
  const f = await fixture(); const { page, calls } = f;
  try {
    let saved = 2;
    await page.route('**/applications/analytics?**', route => route.fulfill({ json: { ok: true, range: { applied: 1, linkedinApplied: saved }, daily: [] } }));
    await page.route('**/applications/job-applied', (route) => { calls.push({ applied: route.request().postDataJSON() }); saved++; return route.fulfill({ json: { ok: true } }); });
    await page.goto(`${f.base}/`);
    await page.getByLabel('Applied today: 3 of 15').waitFor();
    const card = page.getByRole('article', { name: 'Pendo: On LinkedIn' });
    await card.getByRole('button', { name: /Mark applied/ }).click();
    await page.getByText('Marked Pendo as applied.').waitFor();
    assert.deepEqual(calls.filter((c) => c.applied), [{ applied: { jobUrl: 'https://www.linkedin.com/jobs/view/111' } }]);
    assert.equal(await card.count(), 0);
    await page.getByLabel('Applied today: 4 of 15').waitFor();
    // A subsequent refresh already includes the saved mark; it must stay at four.
    await page.reload();
    await page.getByLabel('Applied today: 4 of 15').waitFor();
  } finally { await f.close(); LINKEDIN = []; }
});

test('Easy Apply LinkedIn postings carry a chip and sit after company-site ones', async () => {
  LINKEDIN = [{ ...PENDO[0], id: 'https://www.linkedin.com/jobs/view/1', url: 'https://www.linkedin.com/jobs/view/1', company: 'Easyco', applyType: 'easy_apply' },
    { ...PENDO[0], id: 'https://www.linkedin.com/jobs/view/2', url: 'https://www.linkedin.com/jobs/view/2', company: 'Siteco', applyType: 'offsite' }];
  const f = await fixture(); const { page } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('article', { name: 'Siteco: On LinkedIn' }).waitFor();
    const names = await page.locator('.td-card .td-id strong').allTextContents();
    assert.ok(names.indexOf('Siteco') < names.indexOf('Easyco') || !names.includes('Easyco'), 'company-site posting first');
    if (names.includes('Easyco')) assert.equal(await page.getByRole('article', { name: 'Easyco: On LinkedIn' }).getByText('Easy Apply', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('article', { name: 'Siteco: On LinkedIn' }).getByText('Easy Apply', { exact: true }).count(), 0);
  } finally { await f.close(); LINKEDIN = []; }
});

test('Search narrows Today to a company or role as you type; / jumps in, Esc clears', async () => {
  const f = await fixture(); const { page, calls, errors } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByText('5 applications waiting for you', { exact: true }).waitFor();
    const names = () => page.locator('.td-card .td-id strong').allTextContents();
    await page.keyboard.press('/');
    await page.keyboard.type('ramp');
    assert.deepEqual(await names(), ['Ramp']);
    await page.getByText('1 found', { exact: true }).waitFor();
    // Every word must match the company or the title.
    await page.getByRole('searchbox', { name: 'Search company or role' }).fill('backend f');
    assert.deepEqual(await names(), ['Figma']);
    await page.getByRole('searchbox', { name: 'Search company or role' }).fill('nobody');
    await page.getByText('No company or role matches “nobody”.').waitFor();
    await page.keyboard.press('Escape');
    assert.equal((await names()).length, 5, 'Esc clears the search');
    assert.equal(calls.filter((c) => c.action !== 'skip_companies').length, 0, 'searching sends nothing');
    assert.deepEqual(errors, []);
  } finally { await f.close(); }
});
