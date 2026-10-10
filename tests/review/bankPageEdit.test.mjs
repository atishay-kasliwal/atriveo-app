import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { MongoClient } from 'mongodb';

// Bank page phase 2 (docs/bank-page.md): retiring and restoring through the overlay, the guard on tested sets, the git
// export of a retirement, and the page's edit / retire controls. In-memory Mongo and a temp overlay file; nothing
// leaves the machine and the real bank isn't touched.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-edit-'));
process.env.AC_BANK_OVERLAY = path.join(tmp, 'overlay.json');
const { bankView, retireBullet, BankPageError } = await import('../../scripts/bank-page.mjs');
const { applyOverlay } = await import('../../scripts/ac-bank-overlay.mjs');
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const { bankForTrack } = await import('../../scripts/ac-tracks.mjs');
const { planExport, inGit, lintBank } = await import('../../scripts/export-bank-overlay.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BANK = path.join(root, 'data', 'ac-bank');

test('a retire entry hides the entry or one wording from every track', () => {
  const bank = loadBank(BANK);
  const acs = applyOverlay(bank.acs, { entries: [
    { _id: 'retire:AC-024', type: 'retire', ac_id: 'AC-024', facet: null },
    { _id: 'retire:AC-001:production-ml', type: 'retire', ac_id: 'AC-001', facet: 'production-ml' },
  ] });
  for (const t of ['software-engineer', 'ai-engineer', 'data-science', 'forward-deployed', null]) {
    const seen = bankForTrack({ ...bank, acs }, t).acs;
    assert.ok(!seen.some((a) => a.id === 'AC-024'), String(t));
    assert.ok(!seen.find((a) => a.id === 'AC-001')?.variants.some((v) => v.facet === 'production-ml'), String(t));
  }
  // The git bank itself is untouched.
  assert.ok(!bank.acs.find((a) => a.id === 'AC-024').tracks);
});

test('retire and restore through Mongo; a wording a tested set prints is refused', async () => {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try {
    const db = client.db('bank');
    let view = await retireBullet(db, { acId: 'AC-024', facet: 'default', reason: 'duplicate of AC-232' });
    let v = view.entries.find((e) => e.id === 'AC-024').variants[0];
    assert.equal(v.retired, true);
    assert.equal(v.retiredHere, 'duplicate of AC-232');
    // AC-001:fde is in the FDE sets: refused, nothing written.
    await assert.rejects(retireBullet(db, { acId: 'AC-001', facet: 'fde' }), (e) => e instanceof BankPageError && /forward-deployed/.test(e.message));
    await assert.rejects(retireBullet(db, { acId: 'AC-001' }), BankPageError);
    // A retirement that's in git can't be restored here.
    await assert.rejects(retireBullet(db, { acId: 'AC-007', restore: true }), /in git/);
    view = await retireBullet(db, { acId: 'AC-024', facet: 'default', restore: true });
    v = view.entries.find((e) => e.id === 'AC-024').variants[0];
    assert.equal(v.retired, false);
    assert.equal(v.retiredHere, null);
    assert.deepEqual(await db.collection('bank_overlay').find({}).toArray(), []);
  } finally { await client.close(); await mongod.stop(); }
});

test('export writes a retirement into the YAML, the bank lint passes, and a second run writes nothing', { timeout: 240_000 }, () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'bank-'));
  fs.cpSync(BANK, dir, { recursive: true });
  const entries = [
    { _id: 'retire:AC-024', type: 'retire', ac_id: 'AC-024', facet: null, reason: 'duplicate of AC-232', createdAt: '2026-10-10T12:00:00Z' },
    { _id: 'retire:AC-001:production-ml', type: 'retire', ac_id: 'AC-001', facet: 'production-ml', reason: '', createdAt: '2026-10-10T12:00:00Z' },
  ];
  const plan = planExport(entries, dir);
  assert.deepEqual(plan.map((p) => [p.kind, path.basename(p.file)]).sort(), [['retire', 'AC-001.yaml'], ['retire', 'AC-024.yaml']]);
  for (const p of plan) fs.writeFileSync(p.file, `${p.after}\n`);
  const ac24 = yaml.load(fs.readFileSync(path.join(dir, 'AC-024.yaml'), 'utf8'));
  assert.deepEqual(ac24.tracks, ['retired']);
  assert.match(fs.readFileSync(path.join(dir, 'AC-024.yaml'), 'utf8'), /# Retired 2026-10-10 on the bank page \(duplicate of AC-232\): hidden from every resume\./);
  const ac1 = yaml.load(fs.readFileSync(path.join(dir, 'AC-001.yaml'), 'utf8'));
  assert.deepEqual(ac1.variants.find((v) => v.facet === 'production-ml').tracks, ['retired']);
  assert.equal(ac1.variants.find((v) => v.facet === 'default').tracks, undefined);
  assert.equal(inGit(entries, dir).length, 2);
  assert.deepEqual(planExport(entries, dir), []);
  const lint = lintBank(dir);
  assert.ok(lint.ok, lint.output.slice(-2000));
});

async function fixture() {
  const view = bankView(loadBank(BANK), undefined, null);
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postData() ? route.request().postDataJSON() : null;
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/resume-builder/bank') return route.fulfill({ json: view });
    if (url.pathname === '/resume-builder/check') {
      calls.push({ op: 'check', body });
      return route.fulfill({ json: { ok: true, issues: /^Built /.test(body.text) ? ['"Built" is not an approved action verb'] : [], freeVerbs: ['Pioneered'] } });
    }
    if (url.pathname === '/resume-builder/bullet') { calls.push({ op: 'bullet', body }); return route.fulfill({ json: { ok: true, bullet: {} } }); }
    if (url.pathname === '/resume-builder/bank-retire') {
      calls.push({ op: 'retire', body });
      const e = view.entries.find((x) => x.id === body.acId);
      const next = { ...view, entries: view.entries.map((x) => (x !== e ? x : { ...x, variants: x.variants.map((v) => (v.facet === body.facet ? { ...v, retired: !body.restore, retiredHere: body.restore ? null : body.reason } : v)) })) };
      return route.fulfill({ json: next });
    }
    if (url.pathname.startsWith('/applications/') || url.pathname.startsWith('/resume-builder/')) return route.fulfill({ json: { ok: true } });
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/bank`);
  await page.locator('.bk-col').first().waitFor();
  return { page, errors, calls, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}

test('page: edit runs the bullet rules and saves a reword; retire asks why; a printed wording can\'t be retired', async () => {
  const { page, errors, calls, close } = await fixture();
  try {
    await page.locator('.bk-col .bk-card', { hasText: 'AC-010' }).click();
    const detail = page.locator('.bk-detail');
    await detail.getByRole('button', { name: 'Edit' }).click();
    const box = detail.getByLabel('Wording');
    await box.fill('Built an API gateway with JWT for British Telecom microservices handling 10K+ daily transactions without outages.');
    await detail.getByText('"Built" is not an approved action verb').waitFor();
    assert.equal(await detail.getByRole('button', { name: 'Save wording' }).isDisabled(), true);
    const text = 'Secured British Telecom microservices behind a JWT and OAuth 2.0 API gateway, blocking abusive traffic across 10K+ daily transactions.';
    await box.fill(text);
    await detail.getByText('Passes every bullet rule').waitFor();
    await detail.getByRole('button', { name: 'Save wording' }).click();
    await detail.getByText('Saved. Every future resume uses the new wording.').waitFor();
    assert.deepEqual(calls.find((c) => c.op === 'bullet').body, { role: 'accolite', text, mode: 'reword', acId: 'AC-010', facet: 'reliability' });

    await detail.getByRole('button', { name: 'Retire', exact: true }).click();
    await detail.getByLabel('Why retire it').fill('merged into AC-171');
    await detail.getByRole('button', { name: 'Retire this wording' }).click();
    await detail.getByText('Retired. No future resume uses this wording.').waitFor();
    assert.deepEqual(calls.find((c) => c.op === 'retire').body, { acId: 'AC-010', facet: 'reliability', reason: 'merged into AC-171', restore: false });
    await detail.getByRole('button', { name: 'Restore', exact: true }).click();
    await detail.getByText('Restored.').waitFor();

    // AC-001's FDE wording is on the tested FDE resume: its Retire, and the entry's, are disabled.
    await page.keyboard.press('Escape');
    await page.locator('.bk-col .bk-card', { hasText: 'AC-001' }).click();
    const fde = detail.locator('.bk-variant', { hasText: 'Printed on' });
    assert.equal(await fde.getByRole('button', { name: 'Retire', exact: true }).isDisabled(), true);
    assert.equal(await detail.getByRole('button', { name: 'Retire this entry' }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
