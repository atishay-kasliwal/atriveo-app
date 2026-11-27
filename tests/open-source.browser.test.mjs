import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The open source page in the built console (npm run test:open-source:browser). The server's answers are stubbed with the
// real view over the real bank; GitHub and everything else is blocked. OSS_VIEW=<file> shows a saved view instead.
process.env.AC_BANK_OVERLAY = '/nonexistent';
const { openSourceView, prId } = await import('../scripts/open-source.mjs');
const { loadBank } = await import('../scripts/ac-bank.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.OSS_SHOTS || '';

function sample() {
  if (process.env.OSS_VIEW) return JSON.parse(fs.readFileSync(process.env.OSS_VIEW, 'utf8'));
  const gh = (id, over) => { const [repo, n] = id.split('#'); return { url: `https://github.com/${repo}/pull/${n}`, repo, owner: repo.split('/')[0], n: Number(n), title: `Pull request ${n}`, state: 'MERGED', openedAt: '2026-11-10T10:00:00Z', endedAt: '2026-11-19T10:00:00Z', add: 120, stars: 15000, lang: 'Go', personal: false, shared: false, code: 80, test: 40, files: 4, tested: true, measured: true, ...over }; };
  const docs = new Map();
  for (const a of loadBank().acs.filter((x) => x.role === 'open-source' && x.oss)) for (const u of a.oss.prs) docs.set(prId(u), { _id: prId(u), gh: gh(prId(u), { state: a.oss.status === 'merged' ? 'MERGED' : a.oss.status === 'open' ? 'OPEN' : 'CLOSED' }) });
  docs.set('new/thing#1', { _id: 'new/thing#1', gh: gh('new/thing#1', { title: 'A new merged change' }) });
  docs.set('new/thing#2', { _id: 'new/thing#2', gh: gh('new/thing#2'), mine: { text: 'Added a thing to new in Go, covered by 4 tests for the cases that failed before.', fits: ['SWE'] } });
  return { ...openSourceView([...docs.values()], { sync: { at: '2026-11-25T19:12:00Z', full: true }, demand: { at: '2026-11-25', postings: 60, roles: { SWE: { n: 60, skills: [['Java', 43], ['Python', 39], ['Go', 12]] } } } }), syncing: false };
}

async function open(viewport, view = sample()) {
  const server = http.createServer((req, res) => {
    const want = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(want) && fs.statSync(want).isFile() ? want : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport }), errors = [], posts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let syncs = 0;
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url()), p = url.pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test', email: 'test@example.test' } } });
    if (p === '/resume-builder/oss') return route.fulfill({ json: syncs ? { ...view, syncing: false, sync: { ...view.sync, at: '2026-11-25T20:00:00Z', added: ['a/b#1'], changed: [] } } : view });
    if (p.startsWith('/resume-builder/oss-')) {
      const body = route.request().postDataJSON(); posts.push({ op: p.split('/').pop(), body });
      if (p.endsWith('oss-sync')) { syncs += 1; return route.fulfill({ json: { ok: true, syncing: true } }); }
      if (p.endsWith('oss-check')) return route.fulfill({ json: { ok: true, issues: String(body.text).startsWith('Simplified') ? [] : ['too short (3 words, min 12)'] } });
      const next = structuredClone(view);
      const pr = next.prs.find((x) => x.id === body.id);
      if (p.endsWith('oss-save') && pr) { if (body.skip) pr.coverage = 'skipped'; if (body.rating) { pr.rating = body.rating; pr.ratedByYou = true; } }
      if (p.endsWith('oss-delete') && pr) pr.coverage = 'deleted';
      if (p.endsWith('oss-approve') && pr) {
        Object.assign(pr, { coverage: 'covered', bullets: ['AC-U001'], text: body.text });
        next.bullets.push({ id: 'AC-U001', source: 'bank', org: '', project: 'thing', text: body.text, fits: body.fits, areas: [], tech: [], prs: [pr.id], shared: false, score: 7, rating: 'good', merged: true, stars: 15000, ready: true, pending: true, company: null, pair: body.pair });
      }
      if (p.endsWith('oss-add')) return route.fulfill({ status: 400, json: { ok: false, error: 'That pull request is already on the page.' } });
      view = next;
      return route.fulfill({ json: next });
    }
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    if (process.env.OSS_VIEW && /github(usercontent)?\.com$/.test(url.hostname)) return route.continue();
    if (p.startsWith('/applications/') || p.startsWith('/resume-builder/')) return route.fulfill({ json: { ok: true } });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/open-source`);
  await page.locator('.os-card').first().waitFor();
  if (process.env.OSS_VIEW) await page.waitForTimeout(2500);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  return { page, errors, posts, shot, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}
/** Panels that hide part of their content: nothing may be cut off without a way to scroll to it. */
const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('.os-page *')].filter((e) => { const s = getComputedStyle(e); return s.overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && !e.closest('svg'); }).map((e) => e.className));

test('board: three columns and a strip, no page scroll, the pie filters, skipped opens and hides', async () => {
  const { page, errors, posts, shot, close } = await open({ width: 1440, height: 900 });
  try {
    assert.deepEqual((await page.locator('.os-col h2').allInnerTexts()).map((t) => t.replace(/\d+/g, '').trim()), ['Not covered', 'Draft ready', 'In the bank']);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth), true, 'no page scroll');
    assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), 'Resumes');
    assert.deepEqual(await clipped(page), []);
    await shot('board');
    const before = await page.locator('.os-card').count();
    await page.locator('.os-tabs button', { hasText: 'DS' }).click();
    await page.locator('.os-legend button', { hasText: 'Resume ready' }).click();
    assert.ok(await page.locator('.os-card').count() < before);
    assert.match(await page.locator('.os-filters').innerText(), /DS, resume ready/);
    await page.getByRole('button', { name: 'Clear resume filter' }).click();
    assert.equal(await page.locator('.os-card').count(), before);
    await page.locator('.os-rail').click();
    assert.match(await page.locator('.os-col').last().innerText(), /Skipped or closed/);
    await page.getByRole('button', { name: 'Hide' }).click();
    await page.getByPlaceholder('Repo, title or language').fill('scipy 26772');
    assert.equal(await page.locator('.os-card').count(), 1);
    await page.locator('.os-card').click();
    assert.match(await page.locator('.os-detail').innerText(), /In the bank as AC-282/);
    await page.locator('.os-detail select').selectOption('average');
    await page.locator('.os-detail').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('scipy/scipy#26772').first().waitFor();
    // A bullet already in the bank is never rewritten from here.
    assert.deepEqual(posts.filter((x) => x.op === 'oss-save').at(-1).body, { id: 'scipy/scipy#26772', rating: 'average' });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('editing a draft, deleting in two steps, sync and a refused add', async () => {
  const { page, errors, posts, close } = await open({ width: 1440, height: 900 });
  try {
    await page.locator('.os-col').first().locator('.os-card').first().click();
    const detail = page.locator('.os-detail');
    await detail.locator('textarea').fill('Too short here');
    await detail.locator('.os-issues').waitFor();
    await detail.locator('.os-pill', { hasText: 'FDE' }).click();
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => true);
    assert.deepEqual([posts.at(-1).op, posts.at(-1).body.text, posts.at(-1).body.fits.includes('FDE')], ['oss-save', 'Too short here', true]);
    await page.locator('.os-detail').getByRole('button', { name: 'Delete' }).click();
    assert.ok(!posts.some((x) => x.op === 'oss-delete'), 'one click never deletes');
    await page.locator('.os-detail').getByRole('button', { name: 'Delete it?' }).click();
    await page.waitForTimeout(300);
    assert.ok(posts.some((x) => x.op === 'oss-delete'));
    await page.getByRole('button', { name: 'Sync from GitHub' }).click();
    await page.getByText('Syncing…').waitFor();
    await page.getByText('1 new, 0 changed status').waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: 'Add PR' }).first().click();
    await page.locator('.os-dialog input[name="url"]').fill('https://github.com/a/b/pull/1');
    await page.locator('.os-dialog input[name="title"]').fill('x');
    await page.locator('.os-dialog').getByRole('button', { name: 'Add PR' }).click();
    await page.getByText('That pull request is already on the page.').waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('by resume: nine resumes, swap a line, the warning for a repeated verb, the master; analytics opens a resume', async () => {
  const { page, errors, shot, close } = await open({ width: 1440, height: 900 });
  try {
    await page.getByRole('button', { name: 'By resume' }).click();
    assert.equal(await page.locator('.os-rcard').count(), 9);
    await page.locator('.os-rcard', { hasText: 'Software engineer' }).click();
    assert.equal(await page.locator('.os-slot').count(), 3);
    assert.match(await page.locator('.os-ph').innerText(), /\(Open Source\)/);
    await shot('resume');
    const was = await page.locator('.os-slot').last().innerText();
    await page.locator('.os-bl').first().getByRole('button').click();
    assert.notEqual(await page.locator('.os-slot').last().innerText(), was);
    await page.getByRole('button', { name: 'Use suggested three' }).click();
    assert.equal(await page.locator('.os-slot').last().innerText(), was);
    await page.getByRole('button', { name: 'Show what my master prints' }).click();
    assert.match(await page.locator('.os-rleft').innerText(), /This is what your master prints today/);
    await page.reload(); await page.locator('.os-rcard').first().waitFor();
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight), true, 'no page scroll');
    assert.deepEqual(await clipped(page), []);
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    assert.equal(await page.locator('.os-table tbody tr').count(), 9);
    await shot('analytics');
    await page.locator('.os-table tr', { hasText: 'Data science' }).getByRole('button').click();
    assert.match(await page.locator('.os-rhead').innerText(), /Data science/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('phone: one column, nothing wider than the screen, the detail is a full-screen sheet', async () => {
  const { page, errors, shot, close } = await open({ width: 390, height: 844 });
  try {
    const wide = () => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
    const close_ = page.locator('.os-detail').getByRole('button', { name: 'Close' });
    if (await close_.count()) await close_.click();
    assert.equal(await wide(), true);
    await shot('phone-board');
    await page.locator('.os-card').first().click();
    const box = await page.locator('.os-detail').boundingBox();
    assert.deepEqual([box.x, box.width], [0, 390]);
    await page.locator('.os-detail').getByRole('button', { name: 'Close' }).click();
    for (const name of ['By resume', 'Analytics']) { await page.getByRole('button', { name, exact: true }).click(); assert.equal(await wide(), true, name); await shot(`phone-${name}`); }
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('this week and approving: the strip opens a card, approve needs the rules, a partner and a second click; skip asks why', async () => {
  const view = sample();
  view.audit = { at: '2026-11-27T10:00:00Z', fix: [{ id: 'AC-258', issue: 'scores 8: reword it' }], revive: [], draft: [{ pr: 'new/thing#1', title: 'A new merged change', state: 'MERGED', rating: 'good', score: 7 }], decidedChanged: [], watch: 2 };
  const { page, errors, posts, shot, close } = await open({ width: 1440, height: 900 }, view);
  try {
    const week = page.locator('.os-week');
    await week.getByText('2 to decide').waitFor();
    assert.equal(await week.locator('.os-wk').count(), 2);
    await week.locator('.os-wk', { hasText: 'new/thing#1' }).click();
    const detail = page.locator('.os-detail');
    await detail.locator('h2', { hasText: 'A new merged change' }).waitFor();
    const approve = detail.getByRole('button', { name: 'Approve', exact: true });
    assert.equal(await approve.isDisabled(), true, 'nothing written yet');
    await detail.locator('textarea').fill('Simplified the new thing in Go so a stale cache clears in 1 step instead of 3, covered by 12 tests.');
    await detail.getByText('Passes every bullet rule').waitFor();
    assert.equal(await approve.isDisabled(), true, 'no resume picked yet');
    const fits = detail.getByRole('group', { name: 'Fits' });
    await fits.getByRole('button', { name: 'SWE', exact: true }).click();
    assert.equal(await fits.getByRole('button', { name: 'DA', exact: true }).isDisabled(), true, 'data analytics never prints open source');
    assert.ok((await detail.getByLabel('Prints with').locator('option').count()) > 5);
    await shot('approve');
    await approve.click();
    await detail.getByText('Approve only if it honestly scores 9').waitFor();
    assert.equal(posts.filter((x) => x.op === 'oss-approve').length, 0, 'the first click only asks');
    await detail.getByRole('button', { name: 'Yes, approve it' }).click();
    await page.locator('.os-detail').getByText('You approved this here').waitFor();
    const sent = posts.find((x) => x.op === 'oss-approve').body;
    assert.equal(sent.id, 'new/thing#1');
    assert.deepEqual(sent.fits, ['SWE']);
    assert.match(sent.pair, /^AC-\d+$/);
    assert.ok(await page.locator('.os-detail').getByRole('button', { name: 'Take it back' }).isVisible());
    // Skip asks why, and sends the reason with it.
    await page.locator('.os-card', { hasText: 'new/thing#2' }).click();
    await page.locator('.os-detail').getByRole('button', { name: 'Skip', exact: true }).click();
    await page.locator('.os-detail').getByLabel('Why no bullet').fill('docs only');
    await page.locator('.os-detail').getByRole('button', { name: 'Skip it' }).click();
    await page.waitForFunction(() => true);
    const skip = posts.filter((x) => x.op === 'oss-save').at(-1).body;
    assert.deepEqual({ id: skip.id, skip: skip.skip, why: skip.why }, { id: 'new/thing#2', skip: true, why: 'docs only' });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
