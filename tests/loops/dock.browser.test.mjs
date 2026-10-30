import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The Loops capture dock in a real browser (headless Chromium, never the user's Chrome): the built console with a stand-in /api/loops.
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function fixture(t, { viewport = { width: 1440, height: 900 }, open = [], fail = false, fakeMic = true } = {}) {
  const calls = [], errors = [], state = { fail, open: structuredClone(open) };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const requested = path.join(root, 'dist-apply', url.pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: fakeMic ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : [] });
  const context = await browser.newContext({ viewport, permissions: fakeMic ? ['microphone'] : [] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const req = route.request();
    if (url.origin === base && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/applications/')) return route.continue();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test Applicant', email: 'applicant@example.org' } } });
    if (url.pathname.startsWith('/api/loops')) {
      const body = req.method() === 'POST' ? (req.headers()['content-type']?.startsWith('audio/') ? { bytes: req.postDataBuffer()?.length } : req.postDataJSON()) : null;
      if (url.pathname !== '/api/loops/summary') calls.push({ method: req.method(), path: url.pathname + url.search, type: req.headers()['content-type'], body });
      if (url.pathname === '/api/loops/summary') return route.fulfill({ json: { ok: true, counts: { NEEDS_ACTION: state.open.length }, worker: { lastSeenAt: null }, open: state.open } });
      if (state.fail) return route.fulfill({ status: 502, json: { error: 'Loops backend unreachable' } });
      if (/\/done$/.test(url.pathname)) { state.open = []; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { ok: true, capture: { status: 'WAITING_FOR_CODEX' } } });
    }
    if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: new Date().toISOString(), counts: { fillable: 0, ready: 0 }, fillable: [], ready: [], manual: [], worker: null } });
    if (url.origin === base) return route.fulfill({ json: { ok: true } });
    return route.abort();
  });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  return { page, base, calls, errors, state };
}
const openItem = { id: 'cap_000001', view: { summary: 'Reach out to Sarah', company: 'NVIDIA', position: 'Software Engineer', person: 'Sarah' }, firstTask: 'Message Sarah about the NVIDIA role', waitingSince: new Date(Date.now() - 18 * 3600_000).toISOString(), nextAt: new Date(Date.now() - 1000).toISOString(), status: 'ACTIVE' };
const shot = (page, name) => process.env.LOOPS_SHOTS ? page.screenshot({ path: path.join(process.env.LOOPS_SHOTS, `${name}.png`) }) : null;
const ready = (page) => page.getByRole('button', { name: /^Capture a thought/ }).waitFor();
const shortcut = process.platform === 'darwin' ? 'Meta+Shift+Space' : 'Control+Shift+Space';

test('the ring is on every screen, quiet, and the shortcut opens it with the text box focused', async (t) => {
  const f = await fixture(t); const { page } = f;
  for (const route of ['/', '/network', '/resume_builder', '/job-matching', '/outreach']) {
    await page.goto(f.base + route);
    await page.getByRole('button', { name: 'Capture a thought' }).waitFor();
    await shot(page, `rest${route.replace(/\W/g, '-')}`);
  }
  assert.equal(await page.getByRole('dialog').count(), 0, 'nothing is open by default');
  await page.keyboard.press(shortcut);
  await page.getByRole('dialog', { name: 'Capture a thought' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'cd-text');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Capture a thought', 'focus returns to the ring');
  assert.deepEqual(f.errors, []);
});

test('typing: shortcut, type, Enter; Shift+Enter is a new line; the thought is posted once with a client id', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/network');
  await ready(page);
  await page.keyboard.press(shortcut);
  await page.keyboard.type('Stripe backend role, David from ATO');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('keep reminding me');
  assert.equal(f.calls.length, 0, 'Shift+Enter does not submit');
  await page.keyboard.press('Enter');
  await page.getByText('Kept.').waitFor();
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  assert.equal(c.path, '/api/loops/capture');
  assert.match(c.body.id, /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(c.body.text, 'Stripe backend role, David from ATO\nkeep reminding me');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.keyboard.press(shortcut);
  assert.equal(await page.locator('#cd-text').inputValue(), '', 'the box is empty after a capture');
});

test('voice: Speak shows the timer and waveform, Finish uploads the audio; Cancel keeps nothing', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.goto(f.base + '/');
  await page.getByRole('button', { name: 'Capture a thought' }).click();
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.getByText('Listening').waitFor();
  await page.waitForTimeout(1600);
  await shot(page, 'recording');
  assert.notEqual(await page.getByRole('timer').textContent(), '0:00');
  assert.ok(await page.locator('canvas.cd-wave').evaluate((c) => c.width > 0));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#cd-text').waitFor();
  assert.equal(f.calls.length, 0, 'a cancelled recording is not sent');
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.getByText('Listening').waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Kept.').waitFor();
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].path, /^\/api\/loops\/capture\/audio\?id=[A-Za-z0-9_-]{8,64}&durationMs=\d+$/);
  assert.match(f.calls[0].type, /^audio\//);
  assert.ok(f.calls[0].body.bytes > 800);
});

test('no microphone: a plain message, the text box stays, no refresh needed', async (t) => {
  const f = await fixture(t, { fakeMic: false }); const { page } = f;
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); });
  await page.goto(f.base + '/');
  await ready(page);
  await page.keyboard.press(shortcut);
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.getByText('Mic unavailable. Type it instead.').waitFor();
  await page.keyboard.type('typed instead');
  await page.keyboard.press('Enter');
  await page.getByText('Kept.').waitFor();
  assert.equal(f.calls[0].body.text, 'typed instead');
});

test('microphone permission denied says so and keeps typing available', async (t) => {
  const f = await fixture(t, { fakeMic: false }); const { page } = f;
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
  await page.goto(f.base + '/');
  await ready(page);
  await page.keyboard.press(shortcut);
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.getByText('Microphone access is blocked. Type it instead.').waitFor();
  assert.equal(await page.locator('#cd-text').isEnabled(), true);
});

test('server unreachable: the thought is saved on this device and sent later; nothing is lost', async (t) => {
  const f = await fixture(t, { fail: true }); const { page } = f;
  await page.goto(f.base + '/');
  await ready(page);
  await page.keyboard.press(shortcut);
  await page.keyboard.type('do not lose this');
  await page.keyboard.press('Enter');
  await page.getByText('Saved on this device.').waitFor();
  const queued = await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open('atriveo-loops', 1); r.onsuccess = () => { const q = r.result.transaction('pending').objectStore('pending').getAll(); q.onsuccess = () => resolve(q.result.map((p) => p.text)); }; }));
  assert.deepEqual(queued, ['do not lose this']);
  f.state.fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => new Promise((resolve) => { const r = indexedDB.open('atriveo-loops', 1); r.onsuccess = () => { const q = r.result.transaction('pending').objectStore('pending').count(); q.onsuccess = () => resolve(q.result === 0); }; }));
  assert.equal(f.calls.filter((c) => c.path === '/api/loops/capture').pop().body.text, 'do not lose this');
});

test('unfinished intentions: a small count on the ring, listed in the dock with Done', async (t) => {
  const f = await fixture(t, { open: [openItem] }); const { page } = f;
  await page.goto(f.base + '/');
  const ring = page.getByRole('button', { name: 'Capture a thought. 1 unfinished.' });
  await ring.waitFor();
  assert.equal((await ring.locator('.cd-count').textContent()).trim(), '1');
  assert.ok(await ring.evaluate((el) => el.classList.contains('is-due')), 'past its reminder time: the dot breathes');
  await ring.click();
  const dock = page.getByRole('dialog', { name: 'Capture a thought' });
  await dock.getByText('Message Sarah about the NVIDIA role').waitFor();
  await dock.getByText(/NVIDIA · Software Engineer · Waiting 18h/).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'open-with-loop');
  await dock.getByRole('button', { name: 'Done' }).click();
  assert.ok(f.calls.some((c) => c.path === '/api/loops/cap_000001/done'));
  await page.waitForFunction(() => !document.querySelector('.cd-open'));
});

test('on a phone: fits the screen, does not cover the page header, touch targets are large', async (t) => {
  const f = await fixture(t, { viewport: { width: 390, height: 780 }, open: [openItem] }); const { page } = f;
  await page.goto(f.base + '/resume_builder');
  const ring = page.getByRole('button', { name: /Capture a thought/ });
  await ring.click();
  await page.waitForTimeout(450); // the panel opens by growing from the ring
  const box = await page.getByRole('dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'inside the viewport');
  assert.ok(box.y >= 0, 'not above the viewport');
  const speak = await page.getByRole('button', { name: 'Speak' }).boundingBox();
  assert.ok(speak.height >= 36, `Speak is ${speak.height}px tall`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
  await shot(page, 'phone');
});

test('Loops not deployed yet (the API answers with the site page): the console works and the dock still takes typing', async (t) => {
  const f = await fixture(t); const { page } = f;
  await page.route('**/api/loops/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Atriveo</title>' }));
  await page.goto(f.base + '/network');
  await ready(page);
  await page.keyboard.press(shortcut);
  await page.keyboard.type('still keep this');
  await page.keyboard.press('Enter');
  await page.getByText('Saved on this device.').waitFor();
  assert.deepEqual(f.errors, [], 'no page errors');
});
