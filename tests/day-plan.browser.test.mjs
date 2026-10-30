import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve('dist-apply');
const stamp = '2026-10-01T12:00:00.000Z';
// The Network person is named after a speaker already in the public schedule, found at run time, so no real name lives in this test.
const schedule = JSON.parse(fs.readFileSync('src/apply/atoSchedule.ts', 'utf8').replace(/^[\s\S]*?ATO_SESSIONS: AtoSession\[\] = /, '').replace(/;\s*$/, ''));
const day2 = schedule.filter(s => s.date === '2026-10-20'), day1 = schedule.filter(s => s.date === '2026-10-19');
const talk = day2.find(s => s.speakers.length && s.room);
const person = (id, name, tags, nextFollowUp = null) => ({ id, name, role: 'Engineer', company: talk.company, city: '', photoId: null, watchJobs: false, email: '', linkedin: '', phone: '', notes: '', sourceId: null, via: null, color: null, tags, lastContact: null, nextFollowUp, history: [], archived: false, createdAt: stamp, updatedAt: stamp });

async function open(t, width = 1400) {
  const errors = [], writes = [];
  const data = { sources: [{ id: 's1', name: talk.company || 'Acme', type: 'company', about: 'Hiring at ATO: Engineer (Hiring)', color: null, createdAt: stamp }], people: [person('p1', talk.speakers[0], ['ATO 2026', 'Priority A'], '2026-10-29')] };
  const server = http.createServer((req, res) => {
    const requested = path.join(root, new URL(req.url, 'http://localhost').pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/auth/me') return route.fulfill({ json: { user: { name: 'Test Applicant', email: 'test@example.org' } } });
    if (u.origin !== base && u.pathname.startsWith('/network')) {
      if (route.request().method() !== 'GET') { writes.push(u.pathname); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: u.pathname === '/network' ? data : { ok: true, reminders: [], items: [], maps: [] } });
    }
    if (u.origin !== base) return route.fulfill({ json: { ok: true } });
    return route.continue();
  });
  t.after(async () => { await browser.close(); server.close(); });
  await page.goto(`${base}/day-plan`);
  return { page, errors, writes };
}

test('the day plan shows each day, marks Network speakers, and keeps an agenda without writing anything', async t => {
  const { page, errors, writes } = await open(t);
  await page.waitForSelector('.dp-block');
  assert.equal(await page.locator('.dp-block').count(), day2.length, 'Tuesday starts selected');
  await page.getByRole('button', { name: 'Mon Oct 19' }).click();
  assert.equal(await page.locator('.dp-block').count(), day1.length);
  await page.getByRole('button', { name: 'Tue Oct 20' }).click();

  assert.ok(await page.locator('.dp-meet-row', { hasText: talk.speakers[0] }).isVisible(), 'the Network person is under Meet today');
  assert.ok(await page.locator('.dp-tier.is-A').first().isVisible());
  assert.equal(await page.locator('.dp-block.is-top').count() > 0, true, 'their talk carries the Network ring');
  assert.equal(await page.locator('.dp-hire').count() > 0, true, 'a company hiring at the job board gets a dot');

  await page.locator('.dp-meet-row', { hasText: talk.speakers[0] }).first().click();
  assert.ok(await page.locator('.dp-card h3', { hasText: 'From your Network' }).isVisible());
  assert.match(await page.locator('.dp-person').first().getAttribute('href'), /^\/network\?person=p1$/);
  await page.getByRole('button', { name: 'Add to agenda' }).click();
  assert.equal(await page.locator('.dp-block.is-mine').count(), 1);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('ato-day-plan-agenda'))), [talk.id]);
  await page.reload(); await page.waitForSelector('.dp-block');
  assert.equal(await page.locator('.dp-block.is-mine').count(), 1, 'the agenda survives a reload');

  await page.locator('.dp-time input').fill(String(talk.start)); // the slider moves the "At" list
  assert.ok(await page.locator('.dp-now li', { hasText: talk.title }).first().isVisible());
  assert.deepEqual(writes, [], 'nothing was written to Network');
  assert.deepEqual(errors, []);
});

test('on a phone the panel stacks under the lanes and the page does not overflow sideways', async t => {
  const { page, errors } = await open(t, 390);
  await page.waitForSelector('.dp-block');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways page scroll');
  assert.ok(await page.locator('.dp-side').isVisible());
  assert.deepEqual(errors, []);
});
