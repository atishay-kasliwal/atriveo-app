import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Today's "Do now" strip in headless Chromium: the built console, a stand-in /api/loops, and an empty queue so only the strip is under test.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = 3_600_000, ago = (h) => new Date(Date.now() - h * H).toISOString(), ahead = (h) => new Date(Date.now() + h * H).toISOString();
const item = (id, task, waitingH, nextH, company = 'NVIDIA') => ({ id, view: { summary: task, company, position: 'Software Engineer', person: 'Sarah' }, firstTask: task, waitingSince: ago(waitingH), nextAt: nextH <= 0 ? ago(-nextH) : ahead(nextH), status: 'ACTIVE' });

async function fixture(t, { open = [], summaryDelay = 0, html = false, viewport = { width: 1440, height: 900 } } = {}) {
  const state = { open: structuredClone(open), calls: [], queueAt: 0 }, errors = [];
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
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === base && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/applications/')) return route.continue();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test Applicant', email: 'applicant@example.org' } } });
    if (url.pathname.startsWith('/api/loops')) {
      if (html) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
      if (req.method() === 'POST') { state.calls.push(url.pathname); state.open = state.open.filter((o) => !url.pathname.includes(o.id)); return route.fulfill({ json: { ok: true } }); }
      if (summaryDelay) await new Promise((r) => setTimeout(r, summaryDelay));
      return route.fulfill({ json: { ok: true, counts: { NEEDS_ACTION: state.open.length }, worker: { lastSeenAt: null }, open: state.open } });
    }
    if (url.pathname === '/applications/review-queue') { state.queueAt ||= Date.now(); return route.fulfill({ json: { ok: true, generatedAt: new Date().toISOString(), counts: { fillable: 0, ready: 0 }, fillable: [], ready: [], manual: [], worker: null } }); }
    if (url.origin === base) return route.fulfill({ json: { ok: true } });
    return route.abort();
  });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  return { page, base, state, errors };
}
const shot = (page, name) => process.env.LOOPS_SHOTS ? page.screenshot({ path: path.join(process.env.LOOPS_SHOTS, `${name}.png`) }) : null;

test('Do now shows what matters first (due before waiting), at most three, and Done updates it', async (t) => {
  const f = await fixture(t, { open: [item('cap_a0000001', 'Update the Stripe resume', 30, 4, 'Stripe'), item('cap_b0000001', 'Message Sarah about the NVIDIA role', 18, -1), item('cap_c0000001', 'Email the Datadog recruiter', 9, 2, 'Datadog'), item('cap_d0000001', 'Ask David for a referral', 3, 5, 'Plaid')] });
  await f.page.goto(f.base + '/');
  const strip = f.page.getByRole('region', { name: 'Do now' });
  await strip.waitFor();
  const titles = await strip.locator('.dn-text b').allTextContents();
  assert.equal(titles.length, 3);
  assert.equal(titles[0], 'Message Sarah about the NVIDIA role', 'the one whose reminder is due comes first');
  await strip.getByText('+1 more · All loops').waitFor();
  await strip.getByText(/NVIDIA · Software Engineer · Sarah · Waiting 18h/).waitFor();
  await shot(f.page, 'today-strip');
  await strip.getByRole('button', { name: 'Done' }).first().click();
  await f.page.waitForFunction(() => !document.body.innerText.includes('Message Sarah about the NVIDIA role'));
  assert.deepEqual(f.state.calls, ['/api/loops/cap_b0000001/done']);
  await strip.getByRole('link', { name: 'Update the Stripe resume' }).click();
  assert.match(f.page.url(), /\/loops\?id=cap_a0000001$/);
  assert.deepEqual(f.errors, []);
});

test('nothing open: no strip at all; Loops unreachable: no strip and no errors', async (t) => {
  const none = await fixture(t);
  await none.page.goto(none.base + '/');
  await none.page.getByText('Nothing is waiting for you.').waitFor();
  assert.equal(await none.page.locator('.dn').count(), 0);
  const down = await fixture(t, { html: true });
  await down.page.goto(down.base + '/');
  await down.page.getByText('Nothing is waiting for you.').waitFor();
  assert.equal(await down.page.locator('.dn').count(), 0);
  assert.deepEqual(down.errors, []);
});

test('Today does not wait for Loops: the cards load while the strip is still coming', async (t) => {
  const f = await fixture(t, { open: [item('cap_a0000001', 'Message Sarah', 18, -1)], summaryDelay: 2500 });
  await f.page.goto(f.base + '/');
  await f.page.getByText('Nothing is waiting for you.').waitFor();
  assert.equal(await f.page.locator('.dn').count(), 0, 'the strip is not there yet');
  await f.page.getByRole('region', { name: 'Do now' }).waitFor();
});

test('on a phone the strip shows the first item, fits, and has reachable buttons', async (t) => {
  const f = await fixture(t, { open: [item('cap_a0000001', 'Message Sarah', 18, -1), item('cap_b0000001', 'Email Datadog', 9, 2)], viewport: { width: 390, height: 800 } });
  await f.page.goto(f.base + '/');
  const strip = f.page.getByRole('region', { name: 'Do now' });
  await strip.waitFor();
  assert.equal(await strip.locator('.dn-item:visible').count(), 1);
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.ok((await strip.getByRole('button', { name: 'Done' }).boundingBox()).height >= 30);
  await shot(f.page, 'today-strip-phone');
});
