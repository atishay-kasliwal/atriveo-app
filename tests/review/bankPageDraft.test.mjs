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

// Bank page phase 3 (docs/bank-page.md): a fact you give is kept, drafts come back checked (the builder's rules and no
// number your facts don't give), and the draft you pick replaces the wording with its rubric score. A fake model stands
// in for your Mac AI worker; in-memory Mongo and a temp overlay file; the real bank isn't touched.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-draft-'));
process.env.AC_BANK_OVERLAY = path.join(tmp, 'overlay.json');
const { numbersIn, inventedNumbers, rubricScore, startDraft, draftResult, approveDraft } = await import('../../scripts/bank-draft.mjs');
const { bankView } = await import('../../scripts/bank-page.mjs');
const { loadBank } = await import('../../scripts/ac-bank.mjs');
const { freeVerbs } = await import('../../scripts/resume-builder.mjs');
const { planExport, inGit, lintBank } = await import('../../scripts/export-bank-overlay.mjs');
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { MongoMemoryServer } = requireEngine('mongodb-memory-server');
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BANK = path.join(root, 'data', 'ac-bank');

test('numbers: a draft may only state numbers your facts give; the rubric is clamped to its maximums', () => {
  assert.deepEqual(numbersIn('10K+ transactions, 3,000 employees at 67.7% and 200ms'), ['10', '3000', '67.7', '200']);
  assert.deepEqual(inventedNumbers('cut errors 40% across 10K+ calls', ['10K+ daily transactions']), ['40']);
  assert.deepEqual(inventedNumbers('cut errors 40% across 10K+ calls', ['10K+ calls', 'errors fell 40%']), []);
  assert.equal(rubricScore({ impact: 3, specificity: 2, credibility: 2, clarity: 2, relevance: 1 }), 10);
  assert.equal(rubricScore({ impact: 9, specificity: 2, credibility: -1, clarity: 2, relevance: 1 }), 8);
});

test('give a fact, get checked drafts, use one: the wording and its score change, the note clears', async () => {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  try {
    const db = client.db('bank');
    const verb = freeVerbs(loadBank(BANK))[0];
    const good = `${verb} British Telecom microservices behind a JWT and OAuth 2.0 API gateway, blocking 2,000+ abusive requests a day across 10K+ daily transactions.`;
    const invented = `${verb} British Telecom microservices behind a JWT gateway, cutting incidents 60% across 10K+ daily transactions with OAuth 2.0 rate limiting.`;
    const prompts = [];
    const generate = async (request) => { prompts.push(request); return { drafts: [
      { text: good, why: 'Leads with the blocked traffic', score: { impact: 3, specificity: 2, credibility: 2, clarity: 2, relevance: 1 } },
      { text: invented, why: 'Leads with incidents', score: { impact: 3, specificity: 2, credibility: 2, clarity: 2, relevance: 1 } },
    ] }; };
    const { id } = await startDraft(db, { acId: 'AC-010', facet: 'reliability', fact: 'The gateway blocked about 2,000 abusive requests a day.' }, { generate });
    let r;
    for (let i = 0; i < 50 && (r = await draftResult(db, { id })).status === 'running'; i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(r.status, 'done', r.error);
    assert.equal(prompts[0].purpose, 'bank-draft');
    assert.match(prompts[0].user, /2,000 abusive requests/);
    assert.deepEqual(r.drafts[0].issues, []);
    assert.equal(r.drafts[0].strength, 10);
    assert.ok(r.drafts[1].issues.some((i) => /60/.test(i)), JSON.stringify(r.drafts[1].issues));
    // The fact is kept even before a draft is used.
    let e = bankView().entries.find((x) => x.id === 'AC-010');
    assert.deepEqual(e.yourFacts.map((f) => f.text), ['The gateway blocked about 2,000 abusive requests a day.']);
    // The invented draft can't be saved, even by calling the server directly.
    await assert.rejects(approveDraft(db, { acId: 'AC-010', facet: 'reliability', text: invented, parts: r.drafts[1].parts }), /60/);
    const view = await approveDraft(db, { acId: 'AC-010', facet: 'reliability', text: good, parts: r.drafts[0].parts });
    const v = view.entries.find((x) => x.id === 'AC-010').variants.find((x) => x.facet === 'reliability');
    assert.equal(v.text, good);
    assert.equal(v.strength, 10);
    assert.equal(v.note, null);
    assert.equal(v.edited, false);
    // And the git export writes all three: the fact, the wording, the score; the lint passes; a rerun writes nothing.
    const dir = fs.mkdtempSync(path.join(tmp, 'bank-'));
    fs.cpSync(BANK, dir, { recursive: true });
    const entries = await db.collection('bank_overlay').find({}).toArray();
    const plan = planExport(entries, dir);
    assert.deepEqual(plan.map((p) => path.basename(p.file)), ['AC-010.yaml']);
    for (const p of plan) fs.writeFileSync(p.file, `${p.after}\n`);
    const ac = yaml.load(fs.readFileSync(path.join(dir, 'AC-010.yaml'), 'utf8'));
    assert.equal(ac.user_facts[0].text, 'The gateway blocked about 2,000 abusive requests a day.');
    const out = ac.variants.find((x) => x.facet === 'reliability');
    assert.equal(out.text, good);
    assert.equal(out.strength, 10);
    assert.equal(out.strength_note, undefined);
    assert.equal(inGit(entries, dir).length, entries.length);
    assert.deepEqual(planExport(entries, dir), []);
    const lint = lintBank(dir);
    assert.ok(lint.ok, lint.output.slice(-2000));
  } finally { await client.close(); await mongod.stop(); }
});

test('page: give the missing fact, see the drafts with their checks, use the one that passes', async () => {
  // The git bank only: the test above left AC-010 at 10/10 in the overlay file.
  fs.writeFileSync(process.env.AC_BANK_OVERLAY, JSON.stringify({ entries: [] }));
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
  let polls = 0;
  const drafts = [
    { text: 'Shielded British Telecom microservices behind a JWT gateway, blocking 2,000+ abusive requests a day.', why: 'Result first', strength: 9, parts: { impact: 3, specificity: 2, credibility: 2, clarity: 1, relevance: 1 }, issues: [] },
    { text: 'Shielded British Telecom microservices, cutting incidents 60%.', why: 'Shorter', strength: 8, parts: { impact: 3, specificity: 1, credibility: 2, clarity: 1, relevance: 1 }, issues: ['states 60, which none of your facts give'] },
  ];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postData() ? route.request().postDataJSON() : null;
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/resume-builder/bank') return route.fulfill({ json: view });
    if (url.pathname === '/resume-builder/bank-draft') { calls.push({ op: 'draft', body }); return route.fulfill({ json: { ok: true, id: 'job1' } }); }
    if (url.pathname === '/resume-builder/bank-draft-result') { polls++; return route.fulfill({ json: polls < 2 ? { ok: true, status: 'running', drafts: [], workerOnline: true } : { ok: true, status: 'done', drafts, workerOnline: true } }); }
    if (url.pathname === '/resume-builder/bank-approve') { calls.push({ op: 'approve', body }); return route.fulfill({ json: view }); }
    if (url.pathname.startsWith('/applications/') || url.pathname.startsWith('/resume-builder/')) return route.fulfill({ json: { ok: true } });
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/bank`);
    await page.locator('.bk-needs .bk-card', { hasText: 'AC-010' }).click();
    const detail = page.locator('.bk-detail');
    await detail.getByRole('button', { name: 'Give the missing fact' }).click();
    await detail.getByLabel('The missing number or result').fill('The gateway blocked about 2,000 abusive requests a day.');
    await detail.getByRole('button', { name: 'Save fact and draft' }).click();
    await detail.getByText('Pick a wording').waitFor({ timeout: 15_000 });
    assert.deepEqual(calls[0].body, { acId: 'AC-010', facet: 'reliability', fact: 'The gateway blocked about 2,000 abusive requests a day.' });
    const buttons = detail.getByRole('button', { name: 'Use this wording' });
    assert.equal(await buttons.nth(1).isDisabled(), true, 'the draft with an invented number is blocked');
    await detail.getByText('states 60, which none of your facts give').waitFor();
    await buttons.nth(0).click();
    await detail.getByText('Saved at 9/10. Every future resume uses the new wording.').waitFor();
    assert.deepEqual(calls[1].body, { acId: 'AC-010', facet: 'reliability', text: drafts[0].text, parts: drafts[0].parts });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
