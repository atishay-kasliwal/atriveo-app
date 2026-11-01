// The phone screens (under 760px): at three phone widths every page fits the screen, sits between the top bar and the
// bottom tabs, and the phone tabs do what the desktop buttons do. Built dist-apply; every API is answered here.
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
const WIDTHS = [320, 375, 414];
// The phone screens, plus desktop pages that open inside the phone shell and render on these replies.
const PAGES = ['/', '/job-matching', '/applied', '/network', '/today', '/staffing', '/resume_builder', '/loops', '/settings'];
const hours = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const matchingJob = (i) => ({
  id: `https://jobs.example/m${i}`, key: (i + 1).toString(16).padStart(16, '0'), title: `Backend Engineer ${i}`, company: `Northwind ${i}`, location: 'Remote', postedAt: hours(3), foundAt: null,
  postingUrl: `https://jobs.example/m${i}`, jd: { full: '', about: 'Build backend services in Python.', requirements: ['Python'], duties: [], work: null, salary: null },
  fit: { score: 80, ledger: { required: { matched: 3, total: 4 }, skills: [{ label: 'Python', class: 'required', status: 'met' }] }, knockouts: { verdict: 'clear', items: [] } },
});
const appliedRow = (key, company, h, outcome = null) => ({ key, company, title: 'Engineer', location: 'Remote', appliedAt: hours(h), via: 'Apply with Atriveo', postingUrl: null, outcome, mailCount: 0 });

function reply(u) {
  const p = u.pathname;
  if (p.endsWith('/applications/matching-queue')) return { ok: true, total: 2, jobs: [matchingJob(0), matchingJob(1)], companies: [], stats: { opened: 0, skipped: 0, saved: 1, remaining: 2 }, preference: { active: false, limit: 0 } };
  if (p.endsWith('/staffing/workspace')) return { ok: true, total: 0, jobs: [], counts: { recommended: 0, saved: 0 } };
  if (p.endsWith('/applications/applied')) return { ok: true, total: 2, counts: { replied: 1, interview: 1 }, last7: 2, allTime: 2, rows: [appliedRow('a:one', 'Stripe', 2, { status: 'interview', at: hours(1) }), appliedRow('a:two', 'Datadog', 30)] };
  if (p.endsWith('/applications/applied-summary')) return { ok: true, dayKey: new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 10), today: 2, days: [] };
  if (p.endsWith('/network/reminders')) return { ok: true, reminders: [{ key: 'due:p1:x', kind: 'due', personId: 'p1', title: 'Follow up with Dana Reyes, Staff Engineer at a company with a long name', detail: 'Due today' }] };
  if (p.endsWith('/network')) return { ok: true, people: [{ id: 'p1', name: 'Dana Reyes', role: 'Engineer', company: 'Northwind', email: 'dana@example.org', phone: '+15550100', linkedin: 'dana' }], sources: [], links: [] };
  if (p.endsWith('/api/loops/summary')) return { ok: true, counts: { NEEDS_ACTION: 0 }, worker: { lastSeenAt: null }, open: [] };
  if (p.endsWith('/api/prefs')) return { companies: [], keywords: [] };
  return { ok: true, total: 0, counts: { fillable: 0, ready: 0 }, rows: [], items: [], jobs: [], days: [], people: [], sources: [], links: [], maps: [], events: [], reminders: [], drafts: [], replies: {}, hidden: [], runs: [], fillable: [], ready: [], approved: [], manual: [], inBrowser: [], linkedin: [], open: [] };
}

async function open(t, width) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, new URL(req.url, 'http://localhost').pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000);
  const writes = [];
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === '/api/auth/me') return route.fulfill({ json: { user: { name: 'Test Applicant', email: 'test@example.org' } } });
    const local = u.origin === base && fs.existsSync(path.join(root, u.pathname)) && fs.statSync(path.join(root, u.pathname)).isFile();
    if (local || (u.origin === base && req.resourceType() === 'document')) return route.continue();
    if (/fonts\.|jobs\.example/.test(u.hostname)) return route.abort();
    if (req.method() !== 'GET') { let body = null; try { body = req.postDataJSON(); } catch { /* not JSON */ } writes.push({ path: u.pathname, body }); }
    return route.fulfill({ json: reply(u) });
  });
  t.after(async () => { await browser.close(); server.close(); });
  return { page, base, writes };
}

for (const width of WIDTHS) {
  test(`at ${width}px every page fits between the top bar and the tabs, with no sideways scroll`, async (t) => {
    const { page, base } = await open(t, width);
    for (const route of PAGES) {
      await page.goto(base + route); await page.locator('.ph-tabs').waitFor(); await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        if (!document.querySelector('.ph-top')) return { missing: true };
        const top = document.querySelector('.ph-top').getBoundingClientRect(), tabs = document.querySelector('.ph-tabs').getBoundingClientRect(), main = document.querySelector('.ph-main').getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth - innerWidth, topH: top.height, tabsBottom: tabs.bottom, tabsTop: tabs.top, mainBottom: main.bottom, h: innerHeight, desktopHeader: Boolean(document.querySelector('.apply-header')) };
      });
      assert.ok(!m.missing, `${route}: no phone top bar`);
      assert.ok(m.scroll <= 1, `${route}: sideways scroll of ${m.scroll}px`);
      assert.ok(m.topH <= 56, `${route}: top bar ${m.topH}px`);
      assert.ok(Math.abs(m.tabsBottom - m.h) <= 1, `${route}: tabs end at ${m.tabsBottom}`);
      assert.ok(m.mainBottom <= m.tabsTop + 1, `${route}: the page runs under the tabs`);
      assert.equal(m.desktopHeader, false, `${route}: desktop header on a phone`);
    }
  });
}

test('the phone tabs write what the desktop buttons write', async (t) => {
  const { page, base, writes } = await open(t, 375);
  await page.goto(base + '/job-matching');
  await page.getByRole('button', { name: 'Save for the laptop' }).click();
  await page.waitForFunction(() => document.querySelector('.ph-card:not(.is-behind) h2')?.textContent === 'Backend Engineer 1');
  assert.deepEqual(writes.at(-1), { path: '/applications/job-decision', body: { jobUrl: 'https://jobs.example/m0', decision: 'later' } });

  await page.goto(base + '/applied');
  await page.locator('.ph-event', { hasText: 'Datadog' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Rejected' }).click();
  await page.getByText('Marked rejected.').waitFor();
  assert.deepEqual(writes.at(-1), { path: '/applications/applied-outcome', body: { key: 'a:two', status: 'rejected' } });

  await page.goto(base + '/network');
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a[href^="mailto:"]')) e.preventDefault(); }, true));
  await page.getByRole('link', { name: 'Email' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, I emailed them' }).click();
  await page.getByText('Logged: you emailed Dana Reyes.').waitFor();
  assert.deepEqual(writes.at(-1), { path: '/network/history', body: { id: 'p1', type: 'email', text: '' } });
});
