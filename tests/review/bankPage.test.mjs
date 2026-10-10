import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The bank page (/bank, docs/bank-page.md): the real git bank shaped by bankView (no builder bullets), then the built
// console showing it. Read-only; nothing leaves the machine.
process.env.AC_BANK_OVERLAY = '/nonexistent';
const { bankView } = await import('../../scripts/bank-page.mjs');
const { loadTracks, allPinnedSets } = await import('../../scripts/ac-tracks.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const view = bankView();

test('every live entry has role tags (fits) naming real tracks, including its own tracks and every track that prints it', () => {
  const ids = new Set(Object.keys(loadTracks().tracks));
  for (const e of view.entries.filter((x) => !x.retired && x.variants.some((v) => !v.retired) && !x.yours)) {
    assert.ok(e.fits.length, `${e.id} has fits`);
    for (const t of e.fits) assert.ok(ids.has(t), `${e.id} fits "${t}" is a track`);
    for (const t of e.tracks) assert.ok(e.fits.includes(t), `${e.id} is ${t}-only but its fits leave it out`);
    for (const p of e.variants.flatMap((v) => v.pinned)) assert.ok(e.fits.includes(p.track), `${e.id} is printed on ${p.track} but its fits leave it out`);
  }
});

test('every pinned bullet in TRACKS.yaml is a live wording the page marks as printed on that track', () => {
  const doc = loadTracks();
  const byId = new Map(view.entries.map((e) => [e.id, e]));
  for (const track of Object.keys(doc.tracks)) {
    for (const set of allPinnedSets(track, doc)) {
      for (const ref of [...Object.values(set.experience || {}), ...Object.values(set.projects || {})].flat()) {
        const [id, facet] = ref.split(':');
        const e = byId.get(id);
        assert.ok(e, `${ref} (${track}/${set.name}) is in the bank`);
        const v = facet ? e.variants.find((x) => x.facet === facet) : e.variants[0];
        assert.ok(v, `${ref} has that wording`);
        assert.ok(!e.retired && !v.retired, `${ref} is pinned but retired`);
        assert.ok(v.pinned.some((p) => p.track === track && p.set === set.name), `${ref} shows ${track}/${set.name}`);
      }
    }
  }
  const ac001 = byId.get('AC-001');
  assert.deepEqual(ac001.variants.find((v) => v.facet === 'fde').pinned.map((p) => p.set).sort(), ['default', 'infrastructure']);
  assert.deepEqual(ac001.variants.find((v) => v.facet === 'default').pinned, []);
});

test('entries carry labels, kinds and retired flags', () => {
  assert.ok(view.entries.length > 150);
  assert.equal(view.entries.find((e) => e.id === 'AC-001').label, 'Stony Brook University');
  assert.equal(view.entries.find((e) => e.role === 'atriveo').kind, 'project');
  assert.ok(view.entries.some((e) => e.retired || e.variants.some((v) => v.retired)));
  assert.ok(view.entries.every((e) => e.variants.every((v) => !v.tracks.includes('retired'))));
  // Every live wording under 9 says what it is missing; none at 9+ carries a note.
  const live = view.entries.filter((e) => !e.retired).flatMap((e) => e.variants.filter((v) => !v.retired).map((v) => ({ ref: `${e.id}:${v.facet}`, ...v })));
  assert.deepEqual(live.filter((v) => v.strength < 9 && !v.note).map((v) => v.ref), []);
  assert.deepEqual(live.filter((v) => v.strength >= 9 && v.note).map((v) => v.ref), []);
});

async function fixture(viewport) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/resume-builder/bank') return route.fulfill({ json: view });
    if (url.pathname.startsWith('/applications/') || url.pathname.startsWith('/resume-builder/')) return route.fulfill({ json: { ok: true } });
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/bank`);
  await page.locator('.bk-col').first().waitFor();
  return { page, errors, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}

test('desktop: five columns on one screen, a card opens its wordings and the tracks that print them', async () => {
  const { page, errors, close } = await fixture({ width: 1440, height: 900 });
  try {
    assert.deepEqual(await page.locator('.bk-col h3').allTextContents(), ['Stony Brook', 'Wake Forest', 'Accolite', 'Atriveo', 'Projects']);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight), true, 'no page scroll');
    const live = view.entries.filter((e) => !e.retired).flatMap((e) => e.variants.filter((v) => !v.retired));
    assert.match(await page.locator('.bk-bar').innerText(), new RegExp(`${live.filter((v) => v.strength >= 9).length} of ${live.length} wordings at 9\\+`));
    assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), 'Bank');

    await page.locator('.bk-col .bk-card', { hasText: 'AC-001' }).click();
    const detail = page.locator('.bk-detail');
    assert.match(await detail.innerText(), /Stony Brook University/);
    assert.match(await detail.innerText(), /Printed on/);
    assert.ok(await detail.locator('.bk-track.is-forward-deployed').count() >= 2, 'FDE default and infrastructure sets');
    await page.keyboard.press('Escape');
    assert.equal(await detail.count(), 0);

    // FDE: only wordings FDE can use, the ones its tested resume prints first in each column.
    await page.getByRole('button', { name: 'FDE', exact: true }).click();
    const first = page.locator('.bk-col').first().locator('.bk-card').first();
    assert.equal(await first.locator('.bk-track.is-forward-deployed').count(), 1);
    // Under 9 and search narrow the board; the filters are remembered.
    await page.getByLabel('Under 9').check();
    const scores = await page.locator('.bk-cols .bk-card .bk-score').allTextContents();
    assert.ok(scores.length > 0 && scores.every((s) => parseInt(s, 10) < 9), scores.join(' '));
    await page.getByLabel('Under 9').uncheck();
    await page.keyboard.press('/');
    await page.keyboard.type('Pinecone');
    const texts = await page.locator('.bk-cols .bk-card').allInnerTexts();
    assert.ok(texts.length > 0);
    await page.reload();
    await page.locator('.bk-col').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'FDE', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('phone: columns stack, nothing wider than the screen, the detail is a full-screen sheet', async () => {
  const { page, errors, close } = await fixture({ width: 390, height: 844 });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await page.locator('.bk-col .bk-card').first().click();
    const box = await page.locator('.bk-detail').boundingBox();
    assert.ok(box && box.width >= 389 && box.height >= 840, JSON.stringify(box));
    await page.getByRole('button', { name: 'Close' }).click();
    assert.equal(await page.locator('.bk-detail').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
