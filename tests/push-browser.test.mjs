import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve('dist-apply');
test('push enablement subscribes from the tap and reports registration/save failures', async () => {
const server = http.createServer((req, res) => {
 const pathname = new URL(req.url, 'http://localhost').pathname;
 const requested = path.join(root, pathname);
 const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
 res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
 res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
 for (const scenario of ['success', 'subscription-error', 'save-error']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => { throw e; });
  await page.addInitScript(({ scenario }) => {
    window.pushChecks = { directTap: false, saves: 0, permissionRequests: 0 };
    let inTap = false;
    document.addEventListener('click', () => { inTap = true; setTimeout(() => { inTap = false; }, 0); }, true);
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'default', requestPermission: () => { window.pushChecks.permissionRequests++; throw new Error('Separate permission call must not be used'); } } });
    const sub = { toJSON: () => ({ endpoint: 'https://web.push.apple.com/test', keys: { p256dh: 'test', auth: 'test' } }) };
    const registration = { pushManager: {
      getSubscription: async () => null,
      subscribe: options => {
        window.pushChecks.directTap = inTap;
        if (!inTap) throw new Error('Subscription lost the direct tap');
        if (!(options.applicationServerKey instanceof ArrayBuffer) || options.applicationServerKey.byteLength !== 65) throw new Error('Invalid application key');
        if (scenario === 'subscription-error') return Promise.reject(new DOMException('The string did not match the expected pattern.', 'SyntaxError'));
        return Promise.resolve(sub);
      },
    } };
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function() {} });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => registration, ready: Promise.resolve(registration) } });
  }, { scenario });
  await page.route('**/*', async route => {
   const u = new URL(route.request().url());
   if (u.pathname === '/api/auth/me') return route.fulfill({ json: { user: { name: 'Test', email: 'test@example.com' } } });
   if (u.pathname === '/api/progress/preferences') return route.fulfill({ json: { goal: 15, widget: {} } });
   if (u.pathname.endsWith('/applications/widget')) return route.fulfill({ json: { days: [], dayKey: '2026-10-28', appliedToday: 0, responseEmailsToday: 0, interviewEmailsToday: 0, reviewCount: 0 } });
   if (u.pathname === '/api/push/config') return route.fulfill({ json: { publicKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
   if (u.pathname === '/api/push/subscription') { await page.evaluate(() => window.pushChecks.saves++); return route.fulfill({ status: scenario === 'save-error' ? 503 : 200, json: scenario === 'save-error' ? { error: 'Server temporarily unavailable' } : { ok: true } }); }
   if (u.pathname.startsWith('/api/') || u.origin !== base) return route.fulfill({ json: { ok: true, counts: { fillable: 0, ready: 0 }, worker: null, fillable: [], ready: [], manual: [], approved: [], linkedin: [], daily: [] } });
   return route.continue();
  });
  await page.goto(base + '/settings');
  const enable = page.getByRole('button', { name: 'Enable notifications', exact: true });
  await enable.waitFor({ state: 'visible' });
  await enable.click();

  if (scenario === 'success') {
    await page.getByRole('button', { name: 'Send test notification' }).waitFor();
    assert.equal(await page.evaluate(() => window.pushChecks.saves), 1);
  } else if (scenario === 'subscription-error') {
    await page.getByText('Enable notifications: SyntaxError: The string did not match the expected pattern.').waitFor();
  } else {
    await page.getByText('Save this device: Error: Server temporarily unavailable').waitFor();
  }
  const checks = await page.evaluate(() => window.pushChecks);
  assert.equal(checks.directTap, true);
  assert.equal(checks.permissionRequests, 0);

  await page.close();
 }
} finally { await browser.close(); await new Promise(r => server.close(r)); }

});
