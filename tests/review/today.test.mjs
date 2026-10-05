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
const view = { ok: true, generatedAt: at, killSwitch: null, worker: { online: true, updatedAt: at }, counts: { unanswered: 4, questions: 9, ready: 3 } };
const READY = { ...view, ready: [readyRow('r1', 'Stripe'), readyRow('r2', 'Ramp'), readyRow('m1', 'Spotify', { ats: 'lever' })], manual: [{ ...readyRow('m1', 'Spotify', { ats: 'lever' }), openFill: null }], approved: [] };
const UNANSWERED = { ...view, unanswered: [queued('u1', 'Rogo', 4), queued('u2', 'Vercel', 5), queued('c1', 'Anthropic', 0), queued('d1', 'Figma', 3, { readyForReview: 3, needsInput: 0 }), queued('u3', 'Tailscale', 2)] };
// The sidecar sends the first cards (with each job's link) alongside the queue.
const question = (fieldKey, label, extra = {}) => ({ fieldKey, fingerprint: fieldKey, label, type: 'text', required: true, options: [], canonicalKey: null, sensitive: null, reason: 'UNKNOWN', detail: null, ...extra });
// Rogo: one question with a suggestion (drafted) and one with nothing to start from.
// Rogo, Vercel, Tailscale share "How did you hear about us?" (each its own options) and each has its own question.
const heard = (options) => question('hear', 'How did you hear about us?', { type: 'select', options });
const QUESTIONS = {
  u1: [question('q1', 'Years of Python?', { answerProposal: { state: 'ready_for_review', answer: '5', family: 'x', source: 'bank', reason: 'r' } }), question('q2', 'Which team excites you?'), heard(['LinkedIn', 'Other']), question('co', 'Company name')],
  u2: [heard(['Linkedin Jobs', 'Referral']), question('q3', 'Why Vercel?', { type: 'textarea' }), question('opt', 'Twitter', { required: false })],
  u3: [heard(['Job board', 'Friend']), question('q4', 'Where are you based?')],
};
const card = (q) => ({ ...q, ats: 'ashby', url: `https://jobs.example.test/${q.id}`, questions: QUESTIONS[q.id] ?? [] });
UNANSWERED.cards = UNANSWERED.unanswered.map(card);

async function fixture() {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  const calls = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/applications/review-queue') {
      const v = url.searchParams.get('view');
      if (v === 'linkedin') return route.fulfill({ json: { ok: true, generatedAt: at, linkedin: LINKEDIN } });
      return route.fulfill({ json: v === 'ready' ? READY : v === 'counts' ? view : v === 'cards' ? { ok: true, generatedAt: at, cards: UNANSWERED.cards.filter((c) => (url.searchParams.get('ids') ?? '').split(',').includes(c.id)) } : UNANSWERED });
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
    await page.getByText('8 applications waiting for you', { exact: true }).waitFor();
    const order = await page.locator('.td-card .td-id strong').allTextContents();
    assert.deepEqual(order, ['Spotify', 'Stripe', 'Ramp', 'Anthropic', 'Figma'], 'everything you can Open & Fill first; questions nobody answered last');
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'no page scroll');
    await page.getByRole('button', { name: 'Next applications' }).click();
    assert.deepEqual(await page.locator('.td-card .td-id strong').allTextContents(), ['Rogo', 'Vercel', 'Tailscale']);
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

test('Open & Fill on a drafted or approved card opens its job page and sends nothing', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/`);
    const figma = page.getByRole('article', { name: 'Figma: Answers drafted' });
    await figma.getByRole('button', { name: 'Open & Fill' }).click();
    await page.getByText(/Opened Figma\. Click Apply with Atriveo/).waitFor();
    await page.getByRole('article', { name: 'Anthropic: Answers approved' }).getByRole('button', { name: 'Open & Fill' }).click();
    await page.getByText(/Opened Anthropic\./).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://jobs.example.test/d1', 'https://jobs.example.test/c1']);
    assert.equal(calls.length, 0, 'opening the job page changes nothing in the engine');
    assert.equal(await figma.count(), 0, 'the opened card slides out');
  } finally { await f.close(); }
});

test('Answer opens To answer: each question once, shared ones saved for every job, nothing already drafted', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/`);
    await page.getByRole('button', { name: 'Next applications' }).click();
    await page.getByRole('article', { name: 'Rogo: Needs your answers' }).getByRole('button', { name: /^Answer/ }).click();
    await page.waitForURL(/\/unanswered\?app=u1$/);
    const shared = page.getByRole('region', { name: 'Asked by several jobs' });
    const heard = shared.getByRole('article', { name: 'How did you hear about us?' });
    await heard.waitFor();
    assert.equal(await heard.locator('.qs-count').textContent(), '3');
    const text = await page.locator('.qs-columns').innerText();
    assert.doesNotMatch(text, /Years of Python/, 'a drafted answer is not shown');
    assert.doesNotMatch(text, /Company name/, 'resume fields are left to Atriveo Fill');
    assert.doesNotMatch(text, /Twitter/, 'optional questions are hidden until asked for');
    // One click on a choice: saved for each job with its own matching option; Tailscale offers none.
    await heard.getByRole('button', { name: 'LinkedIn', exact: true }).click();
    await page.getByText('Saved for 2 jobs · 1 need a different choice').waitFor();
    const answers = calls.filter((c) => c.action === 'answer');
    assert.deepEqual(answers.map((c) => [c.applicationId, c.answers[0].value, c.answers[0].scope]).sort(), [['u1', 'LinkedIn', 'global'], ['u2', 'Linkedin Jobs', 'global']]);
    // A job-specific question: type and press Enter.
    const single = page.getByRole('region', { name: 'Only for one job' });
    await single.getByRole('article', { name: 'Which team excites you?' }).getByRole('textbox').fill('Inference');
    await page.keyboard.press('Enter');
    await page.getByText('✓ 3 answered for 2 jobs this session').waitFor();
    assert.equal(await single.getByRole('article', { name: 'Which team excites you?' }).count(), 0, 'an answered question leaves the list');
    assert.deepEqual(calls.at(-1), { action: 'answer', applicationId: 'u1', answers: [{ fingerprint: 'q2', label: 'Which team excites you?', type: 'text', canonicalKey: null, sensitive: null, value: 'Inference', scope: 'global' }] });
    await page.getByLabel(/Show optional/).check();
    await single.getByRole('article', { name: 'Twitter' }).waitFor();
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

test('with Atriveo Fill 0.5, Open & Fill hands the job to the extension, which opens and fills it', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    // Stand-in for the extension's dashboard script: answers "apply" like 0.5 does.
    await page.addInitScript(() => {
      window.__asked = [];
      document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-atriveo-fill-apply', '1'));
      window.addEventListener('message', (e) => {
        if (e.data?.source !== 'atriveo-dashboard') return;
        window.__asked.push({ type: e.data.type, url: e.data.url, applicationId: e.data.applicationId });
        window.postMessage({ source: 'atriveo-fill', type: 'armed', nonce: e.data.nonce, reply: { ok: true } }, location.origin);
      });
    });
    await page.goto(`${f.base}/`);
    await page.getByRole('article', { name: 'Figma: Answers drafted' }).getByRole('button', { name: 'Open & Fill' }).click();
    await page.getByText(/Opened Figma\. Atriveo is filling it now/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__asked), [{ type: 'apply', url: 'https://jobs.example.test/d1', applicationId: 'd1' }]);
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'the extension opens the tab, not the page');
    assert.equal(calls.length, 0);
  } finally { await f.close(); }
});

test('Select all Open & Fill queues every fillable card and opens them one at a time through the extension', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    // Stand-in for Atriveo Fill 0.7.1: queue-capable, and each "apply" answers once its fill is done.
    await page.addInitScript(() => {
      window.__asked = [];
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.setAttribute('data-atriveo-fill-apply', '2'); document.documentElement.setAttribute('data-atriveo-fill-queue', '1'); });
      window.addEventListener('message', (e) => {
        if (e.data?.source !== 'atriveo-dashboard') return;
        window.__asked.push({ type: e.data.type, applicationId: e.data.applicationId, wait: e.data.wait });
        setTimeout(() => window.postMessage({ source: 'atriveo-fill', type: 'armed', nonce: e.data.nonce, reply: { ok: true, auto: { state: 'filled', message: 'Filled 3.' } } }, location.origin), 50);
      });
    });
    await page.goto(`${f.base}/`);
    await page.getByRole('button', { name: /^Select all Open & Fill \(\d+\)$/ }).click();
    await page.getByRole('button', { name: /^Open & Fill selected \(\d+\)$/ }).click();
    // Spotify (You submit) takes the verified path; this fake sidecar gives it no form, so the queue pauses on it.
    await page.getByRole('button', { name: 'Skip & continue' }).click();
    await page.getByText(/Queue finished/).waitFor();
    const asked = await page.evaluate(() => window.__asked);
    const applies = asked.filter((a) => a.type === 'apply');
    assert.deepEqual(applies.map((a) => a.applicationId).sort(), ['c1', 'd1'], 'the approved and drafted cards, each through the extension');
    assert.ok(applies.every((a) => a.wait === true), 'each waits for its fill before the next');
    assert.ok(calls.every((c) => c.action !== 'approve_submit'), 'nothing is submitted or approved');
  } finally { await f.close(); }
});

test('Skip on a question skips its job; on a shared question, every job that asks it', async () => {
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.goto(`${f.base}/unanswered`);
    const single = page.getByRole('region', { name: 'Only for one job' });
    await single.getByRole('article', { name: 'Why Vercel?' }).getByRole('button', { name: 'Skip job' }).click();
    await page.getByText('1 job skipped').waitFor();
    assert.deepEqual(calls.at(-1), { action: 'skip', applicationId: 'u2', note: 'skipped on To answer: Why Vercel?' });
    // Vercel is gone everywhere: the shared question now lists only Rogo and Tailscale.
    const heard = page.getByRole('region', { name: 'Asked by several jobs' }).getByRole('article', { name: 'How did you hear about us?' });
    assert.equal(await heard.locator('.qs-count').textContent(), '2');
    await heard.getByRole('button', { name: 'Skip all 2 jobs' }).click();
    await page.getByText('3 jobs skipped').waitFor();
    assert.deepEqual(calls.filter((c) => c.action === 'skip').map((c) => c.applicationId).sort(), ['u1', 'u2', 'u3']);
    assert.ok(calls.every((c) => c.action === 'skip'), 'skipping answers nothing');
  } finally { await f.close(); }
});

test('within Open & Fill: North Carolina first, then the newest posting; score and age on the card; Discard', async () => {
  const saved = UNANSWERED.unanswered.map((q) => ({ ...q }));
  Object.assign(UNANSWERED.unanswered.find((q) => q.id === 'c1'), { location: 'New York, NY', postedAt: '2026-10-04T10:00:00.000Z', score: 72 });
  Object.assign(UNANSWERED.unanswered.find((q) => q.id === 'd1'), { location: 'Raleigh, NC', postedAt: '2026-09-20T10:00:00.000Z', score: 20 });
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
  } finally { await f.close(); UNANSWERED.unanswered.splice(0, UNANSWERED.unanswered.length, ...saved); }
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

test('Mark applied on an On LinkedIn card records it and takes it off Today', async () => {
  LINKEDIN = PENDO;
  const f = await fixture(); const { page, calls } = f;
  try {
    await page.route('**/applications/job-applied', (route) => { calls.push({ applied: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); });
    await page.goto(`${f.base}/`);
    const card = page.getByRole('article', { name: 'Pendo: On LinkedIn' });
    await card.getByRole('button', { name: /Mark applied/ }).click();
    await page.getByText('Marked Pendo as applied.').waitFor();
    assert.deepEqual(calls.filter((c) => c.applied), [{ applied: { jobUrl: 'https://www.linkedin.com/jobs/view/111' } }]);
    assert.equal(await card.count(), 0);
  } finally { await f.close(); LINKEDIN = []; }
});
