import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// "Applied?" on the resume builder, in a real browser at desktop and phone width (the page has two layouts and the popup must be in both).
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOB = 'https://example.com/jobs/1';
const loaded = (applied = null) => ({
  ok: true, source: { kind: 'job', jobUrl: JOB, company: 'Acme', title: 'Software Engineer', location: null }, headerTitle: 'Software Engineer', email: 'test@example.org', city: 'New York, NY',
  skills: ['Backend: Python, SQL'], sections: [{ role: 'acme', kind: 'experience', label: 'Acme', bullets: [{ ac_id: 'AC-001', facet: 'swe', text: 'Built the billing service for 40K users, cutting invoice errors by 30%.' }], stack: null, stackAuto: [] }],
  options: { acme: [] }, roles: [{ role: 'acme', kind: 'experience', label: 'Acme' }], track: 'software-engineer', minProjects: 2,
  current: { pdfPath: '/tmp/none.pdf', edited: false, generatedPdfPath: null, pages: 1, room: 0 }, jd: null,
  layout: { name: 'Test Applicant', phone: null, linkedin: null, github: null, education: [], roles: { acme: { name: 'Acme', dates: '2024 -- 2026', place: 'New York, NY', order: 1, title: 'Engineer' } }, projects: {}, sbTitleOverrides: {} },
  ats: { posting: false, match: null, ready: null, note: null }, applied,
});

async function fixture(t, { viewport, fail = false, applied = null }) {
  const posts = [], errors = [];
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'), f = path.join(root, 'dist-apply', u.pathname);
    const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(root, 'dist-apply/index.html');
    r.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'); r.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  page.setDefaultTimeout(10000); page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const rq = route.request(), u = new URL(rq.url());
    if (u.origin === base && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/applications/')) return route.continue();
    if (u.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'T', email: 'a@example.org' } } });
    if (u.pathname.endsWith('/resume-builder/load')) return route.fulfill({ json: loaded(applied) });
    if (u.pathname.endsWith('/resume-builder/applied')) {
      posts.push(rq.postDataJSON());
      return fail ? route.fulfill({ status: 400, json: { ok: false, error: 'This job has no resume yet.' } }) : route.fulfill({ json: { ok: true, applied: { at: new Date().toISOString(), link: rq.postDataJSON().link } } });
    }
    if (u.pathname.startsWith('/api/loops')) return route.fulfill({ status: 404, json: { ok: false } });
    if (u.origin === base || u.origin === 'http://localhost:8787') return route.fulfill({ json: { ok: true } });
    return route.abort();
  });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  return { page, base, posts, errors };
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  test(`Applied? opens its popup, records the link and turns into Applied ✓ (${name})`, async (t) => {
    const f = await fixture(t, { viewport }); const { page } = f;
    await page.goto(`${f.base}/resume_builder?job=${encodeURIComponent(JOB)}`);
    if (name === 'phone') await page.getByRole('button', { name: /more|menu|⋯|…/i }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Applied?' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Mark applied' });
    await dialog.waitFor();
    await dialog.getByText('Software Engineer · Acme').waitFor();
    await page.getByLabel(/Link you applied through/).fill('https://boards.greenhouse.io/acme/1');
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await page.getByText(/Marked Acme as applied/).waitFor();
    assert.deepEqual(f.posts, [{ source: { kind: 'job', jobUrl: JOB, company: 'Acme', title: 'Software Engineer', location: null }, link: 'https://boards.greenhouse.io/acme/1' }]);
    assert.equal(await dialog.count(), 0, 'the popup closes');
    // The button now reads Applied ✓ (on a phone it lives in the ⋯ menu, which is closed here).
    if (name === 'desktop') assert.equal(await page.getByRole('button', { name: 'Applied ✓' }).isDisabled(), true);
    assert.deepEqual(f.errors, []);
  });
}

test('the link is optional, and a refusal from the server is shown in the popup', async (t) => {
  const f = await fixture(t, { viewport: { width: 1440, height: 900 }, fail: true }); const { page } = f;
  await page.goto(`${f.base}/resume_builder?job=${encodeURIComponent(JOB)}`);
  await page.getByRole('button', { name: 'Applied?' }).click();
  await page.getByRole('dialog', { name: 'Mark applied' }).getByRole('button', { name: 'Submit' }).click();
  await page.getByText('This job has no resume yet.').waitFor();
  assert.equal(f.posts[0].link, null);
  assert.equal(await page.getByRole('dialog', { name: 'Mark applied' }).count(), 1, 'it stays open so you can retry');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Mark applied' }).count(), 0);
});

test('an already-applied resume shows Applied ✓ and cannot be marked again', async (t) => {
  const f = await fixture(t, { viewport: { width: 1440, height: 900 }, applied: { at: new Date().toISOString(), link: null } }); const { page } = f;
  await page.goto(`${f.base}/resume_builder?job=${encodeURIComponent(JOB)}`);
  const done = page.getByRole('button', { name: 'Applied ✓' });
  await done.waitFor();
  assert.equal(await done.isDisabled(), true);
});
