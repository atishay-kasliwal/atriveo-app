import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The /loops page in headless Chromium: the built console against an in-memory stand-in for /api/loops.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = 3_600_000, ago = (h) => new Date(Date.now() - h * H).toISOString();
const task = (id, title, done = false) => ({ id, title, description: null, priority: 'high', done, doneAt: null });
const cap = (id, status, over = {}) => ({ id, inputType: 'TEXT', status, createdAt: ago(20), updatedAt: ago(1), completedAt: null, confirmedAt: null, text: 'raw thought', audio: null, view: null, structured: null, edited: false, links: null, tasks: [], reminder: { intervalHours: null, nextAt: null, lastAt: null, count: 0 }, error: null, attempts: 0, ...over });
const view = (company, position, person, summary) => ({ summary, company, position, person, intent: 'Ask for help with the application', context: ['Met at All Things Open', 'Recently graduated'] });
const seed = () => [
  cap('cap_active01', 'ACTIVE', { text: 'I found an SWE role at NVIDIA and Sarah works there', confirmedAt: ago(18), view: view('NVIDIA', 'Software Engineer', 'Sarah', 'Reach out to Sarah'), tasks: [task('t1', 'Message Sarah about the NVIDIA role'), task('t2', 'Update my resume for NVIDIA')], reminder: { intervalHours: 6, nextAt: new Date(Date.now() + 2 * H).toISOString(), lastAt: ago(4), count: 2 } }),
  cap('cap_review01', 'NEEDS_REVIEW', { text: 'Stripe backend role, David from ATO', view: view('Stripe', 'Backend Engineer', 'David', 'Ask David about Stripe'), tasks: [task('t1', 'Message David about Stripe')], reminder: { intervalHours: 6, nextAt: null, lastAt: null, count: 0 }, links: { linked: {}, candidates: { people: [{ id: 'p3', name: 'David Kim', company: 'Stripe' }, { id: 'p4', name: 'David Park', company: 'Stripe' }], jobs: [], companies: [] } } }),
  cap('cap_wait0001', 'WAITING_FOR_CODEX', { text: 'remind me to follow up with the Datadog recruiter' }),
  cap('cap_voice001', 'RECORDED', { inputType: 'VOICE', text: null, audio: { mime: 'audio/webm', bytes: 9000, durationMs: 47000 } }),
  cap('cap_failed01', 'FAILED', { text: 'broken one', error: { stage: 'codex', message: 'Codex is signed out.' } }),
  cap('cap_done0001', 'COMPLETED', { completedAt: ago(30), view: view('Google', 'SRE', null, 'Applied'), tasks: [{ ...task('t1', 'Apply to Google SRE', true), doneAt: ago(30) }] }),
];
const EVENTS = (c) => [{ type: 'captured', at: c.createdAt, data: { inputType: c.inputType } }, ...(c.status !== 'WAITING_FOR_CODEX' && c.status !== 'RECORDED' ? [{ type: 'processed', at: ago(19), data: {} }] : []), ...(c.confirmedAt ? [{ type: 'confirmed', at: c.confirmedAt, data: { intervalHours: 6 } }, { type: 'reminder_sent', at: ago(4), data: {} }] : [])];

async function fixture(t, { viewport = { width: 1440, height: 900 }, empty = false } = {}) {
  const state = { caps: empty ? [] : seed(), calls: [] }, errors = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const requested = path.join(root, 'dist-apply', url.pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', (e) => errors.push(e.message));
  const find = (id) => state.caps.find((c) => c.id === id);
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === base && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/applications/')) return route.continue();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test Applicant', email: 'applicant@example.org' } } });
    if (url.pathname.startsWith('/api/loops')) {
      const parts = url.pathname.split('/').filter(Boolean).slice(2), ok = (body = {}) => route.fulfill({ json: { ok: true, ...body } });
      if (req.method() === 'POST') state.calls.push({ path: url.pathname, body: req.postDataJSON() });
      if (parts[0] === 'summary') return ok({ counts: {}, worker: { lastSeenAt: ago(3) }, open: [] });
      if (!parts.length) {
        const q = (url.searchParams.get('q') ?? '').toLowerCase(), st = url.searchParams.get('status');
        return ok({ captures: state.caps.filter((c) => (!st || c.status === st) && (!q || JSON.stringify([c.view, c.text, c.tasks]).toLowerCase().includes(q))) });
      }
      const c = find(parts[0]);
      if (!c) return route.fulfill({ status: 404, json: { ok: false, error: 'That capture was not found' } });
      if (req.method() === 'GET' && parts.length === 1) return ok({ capture: c, events: EVENTS(c), linked: c.id === 'cap_active01' ? { person: { id: 'p1', name: 'Sarah Chen', company: 'NVIDIA' }, company: { id: 's1', name: 'NVIDIA' } } : {} });
      const body = req.postDataJSON() ?? {};
      if (parts[1] === 'edit') { if (body.person) c.view.person = body.person; if (body.tasks) c.tasks = body.tasks.map((t, i) => ({ ...task(`t${i + 1}`, t.title) })); }
      if (parts[1] === 'confirm') { c.status = 'ACTIVE'; c.confirmedAt = new Date().toISOString(); c.reminder = { ...c.reminder, intervalHours: body.reminderHours, nextAt: new Date(Date.now() + body.reminderHours * H).toISOString() }; }
      if (parts[1] === 'done') { if (body.taskId) { c.tasks = c.tasks.map((t) => (t.id === body.taskId ? { ...t, done: true } : t)); if (c.tasks.every((t) => t.done)) { c.status = 'COMPLETED'; c.completedAt = new Date().toISOString(); } } else { c.tasks = c.tasks.map((t) => ({ ...t, done: true })); c.status = 'COMPLETED'; c.completedAt = new Date().toISOString(); } }
      if (parts[1] === 'snooze') { c.status = 'SNOOZED'; c.reminder.nextAt = new Date(Date.now() + body.hours * H).toISOString(); }
      if (parts[1] === 'dismiss') c.status = 'DISMISSED';
      if (parts[1] === 'retry') { c.status = 'WAITING_FOR_CODEX'; c.error = null; }
      if (parts[1] === 'reopen') c.status = c.status === 'DISMISSED' ? 'NEEDS_REVIEW' : 'ACTIVE';
      if (parts[1] === 'transcript') { c.status = 'WAITING_FOR_CODEX'; c.text = body.text; }
      return ok({ capture: c });
    }
    if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: new Date().toISOString(), counts: { fillable: 0, ready: 0 }, fillable: [], ready: [], manual: [], worker: null } });
    if (url.origin === base) return route.fulfill({ json: { ok: true } });
    return route.abort();
  });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  return { page, base, state, errors };
}
const shot = (page, name) => process.env.LOOPS_SHOTS ? page.screenshot({ path: path.join(process.env.LOOPS_SHOTS, `${name}.png`) }) : null;

test('sections put unfinished intentions first, with honest copy for each waiting state', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops');
  await page.getByRole('heading', { name: 'Loops', level: 1 }).waitFor();
  await page.getByRole('option', { name: /NVIDIA · Software Engineer/ }).waitFor();
  await page.getByRole('option', { name: /Google · SRE/ }).waitFor();
  const headings = await page.locator('.lp-group h2').allTextContents();
  assert.deepEqual(headings.map((h) => h.replace(/\d+$/, '')), ['Needs action', 'Needs review', 'Waiting for your Mac', 'Completed']);
  await page.getByText('1 still open · 1 to review · 3 waiting for your Mac').waitFor();
  await page.getByText(/Your Mac was last seen 3h ago/).waitFor();
  await page.getByRole('option', { name: /NVIDIA · Software Engineer/ }).waitFor();
  await shot(page, 'list');
  await page.getByRole('option', { name: /Datadog/ }).click();
  await page.getByText('Waiting for your Mac.').waitFor();
  await page.getByText(/Last seen 3h ago/).waitFor();
  await page.getByRole('option', { name: /Recording · 0:47/ }).click();
  await page.getByText('Recording saved.').waitFor();
  assert.equal(await page.locator('audio[aria-label="Original recording"]').count(), 1);
  await page.getByRole('option', { name: /broken one/ }).click();
  await page.getByText(/Codex is signed out/).waitFor();
  assert.deepEqual(f.errors, []);
});

test('an open intention tells its story and finishing it completes it', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops');
  await page.getByRole('option', { name: /NVIDIA/ }).click();
  assert.match(page.url(), /\/loops\?id=cap_active01$/);
  await page.getByRole('heading', { name: 'NVIDIA · Software Engineer', level: 2 }).waitFor();
  await page.getByText(/next nudge in 2h/).waitFor();
  await page.getByText('Reminding every 6 hours').waitFor();
  await page.getByText('Reminder sent').waitFor();
  await page.getByText('Original thought').waitFor();
  await page.getByText('Met at All Things Open').waitFor();
  await page.getByText('Linked in Atriveo: Sarah Chen in your Network · NVIDIA').waitFor();
  await shot(page, 'story');
  await page.getByRole('button', { name: 'Mark done: Message Sarah about the NVIDIA role' }).click();
  await page.getByRole('button', { name: 'Message Sarah about the NVIDIA role, done' }).waitFor();
  assert.equal(f.state.caps[0].status, 'ACTIVE', 'one task done, the loop is still open');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.startsWith('Completed'));
  assert.equal(f.state.caps[0].status, 'COMPLETED');
});

test('snooze moves the next nudge', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops?id=cap_active01');
  await page.getByRole('button', { name: 'Remind me in…' }).click();
  await page.getByRole('menuitem', { name: 'Tomorrow' }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.includes('Snoozed'));
  assert.deepEqual(f.state.calls.at(-1), { path: '/api/loops/cap_active01/snooze', body: { hours: 24 } });
  await page.getByText(/next nudge in 24h/).waitFor();
});

test('review: correct a few things and confirm in one step; nothing is active before that', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops?id=cap_review01');
  await page.getByRole('form', { name: 'Review' }).waitFor();
  assert.equal(f.state.caps[1].status, 'NEEDS_REVIEW');
  await page.getByLabel('Person', { exact: true }).fill('David Kim');
  await page.getByLabel('Task 1', { exact: true }).fill('Message David about the Stripe backend role');
  await page.getByLabel('Person in your Network').selectOption('p3');
  await page.getByLabel('Remind me every').selectOption('3');
  await shot(page, 'review');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.startsWith('Open'));
  const calls = f.state.calls.map((c) => c.path.replace('/api/loops/cap_review01', ''));
  assert.deepEqual(calls, ['/edit', '/confirm']);
  const edit = f.state.calls[0].body;
  assert.equal(edit.person, 'David Kim');
  assert.deepEqual(edit.link, { personId: 'p3' });
  assert.equal(edit.company, undefined, 'only what changed is sent');
  assert.equal(f.state.calls[1].body.reminderHours, 3);
});

test('search finds a company or a word across every state, and says so when nothing matches', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops');
  await page.getByLabel('Search loops').fill('nvidia');
  await page.getByRole('option', { name: /NVIDIA · Software Engineer/ }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.lp-row').length === 1);
  assert.equal(await page.locator('.lp-group').count(), 0, 'results are one flat list');
  await page.getByLabel('Search loops').fill('datadog');
  await page.getByRole('option', { name: /Datadog/ }).waitFor();
  await page.getByLabel('Search loops').fill('zzzz');
  await page.getByText('Nothing matches that.').waitFor();
  await page.getByLabel('Search loops').fill('');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Status').selectOption('COMPLETED');
  await page.waitForFunction(() => document.querySelectorAll('.lp-row').length === 1);
  await page.getByRole('option', { name: /Google · SRE/ }).waitFor();
});

test('failed and waiting captures can be retried or typed in; completed ones reopened', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/loops?id=cap_failed01');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.startsWith('Waiting for your Mac'));
  await page.goto(f.base + '/loops?id=cap_voice001');
  await page.getByLabel('Type what you said').fill('Follow up with Priya about the referral');
  await page.getByRole('button', { name: 'Use this text' }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.startsWith('Waiting for your Mac'));
  await page.goto(f.base + '/loops?id=cap_done0001');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.waitForFunction(() => document.querySelector('.lp-state')?.textContent?.startsWith('Open'));
});

test('empty and unknown states are calm, not broken', async (t) => {
  const f = await fixture(t, { empty: true }); const { page } = f;
  await page.goto(f.base + '/loops');
  await page.getByText('Nothing captured yet.').waitFor();
  await page.getByText(/Press Ctrl\/⌘ Shift Space/).waitFor();
  await page.goto(f.base + '/loops?id=cap_nothere1');
  await page.getByText('That capture was not found').waitFor();
  assert.deepEqual(f.errors, []);
});

test('Loops is in the nav, and on a phone the list and a capture each get the whole screen', async (t) => {
  const f = await fixture(t, { viewport: { width: 390, height: 800 } }); const { page } = f;
  await page.goto(f.base + '/loops');
  await page.getByRole('link', { name: 'Loops', exact: true }).waitFor();
  assert.equal(await page.locator('.lp-detail').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole('option', { name: /NVIDIA/ }).click();
  await page.getByRole('button', { name: '← Loops' }).waitFor();
  assert.equal(await page.locator('.lp-list').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await shot(page, 'phone-story');
  await page.getByRole('button', { name: '← Loops' }).click();
  await page.getByRole('option', { name: /NVIDIA/ }).waitFor();
});
