import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const q = (label, extra = {}) => ({ fieldKey: label, fingerprint: label, label, type: 'textarea', required: true, options: [], canonicalKey: null, sensitive: null, reason: 'UNKNOWN_QUESTION', detail: null, ...extra });
const rows = [
  { id: 'motivation', company: 'Test Midpage', questions: [q('Why Midpage?', { questionFamily: 'why_company_role', answerProposal: { state: 'ready_for_review', family: 'why_company_role', source: 'approved_story', answer: 'An approved candidate story with exact saved posting evidence.', reason: 'grounded_story_proposal' } })] },
  { id: 'factual', company: 'Test Profile', questions: [q('What timezone are you in?', { type: 'text', openEndedUserReview: { status: 'draft', action: 'replaced', generatedBy: 'muse', draftAnswer: 'America/New_York', missingFacts: ['Confirm timezone'] }, answerProposal: { state: 'ready_for_review', family: 'timezone', source: 'candidate_profile', answer: 'America/New_York', reason: 'explicit_candidate_fact' } })] },
  { id: 'salary', company: 'Test Salary', questions: [q('What are your salary expectations?', { sensitive: 'salary', answerProposal: { state: 'needs_input', family: 'compensation', source: 'none', reason: 'SENSITIVE_QUESTION' } })] },
  { id: 'attachment', company: 'Test Attachment', questions: [q('Resume', { type: 'file', reason: 'UPLOAD_UNVERIFIED', answerProposal: { state: 'action_required', family: 'attachment', source: 'none', reason: 'attachment_requires_remote_verification' } })] },
].map(r => ({ ...r, title: 'Test Engineer', ats: 'ashby', url: 'https://blocked.test/form', priority: 0, updatedAt: '2026-10-02T23:00:00Z', questionReviewStatus: 'open' }));
const counts = { unanswered: 4, questions: 4, ready: 0, readyForReview: 2, needsInput: 1, actionRequired: 1 };
const order = rows.map(r => ({ id: r.id, updatedAt: r.updatedAt, n: 1, readyForReview: r.questions[0].answerProposal.state === 'ready_for_review' ? 1 : 0, needsInput: r.id === 'salary' ? 1 : 0, actionRequired: r.id === 'attachment' ? 1 : 0 }));

test('built review workspace: visible proposals, filters, scopes, keyboard, concurrency and responsive layout', async () => {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const actions = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test reviewer', email: 'test@example.test' } } });
      if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: '2026-10-02T23:00:00Z', counts, unanswered: order, cards: rows, worker: { online: true, updatedAt: 'now' } } });
      if (url.pathname === '/applications/action') { actions.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { ok: false, error: 'Application changed since you opened it; refresh before reviewing the answer' } }); }
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/unanswered`);
    await page.getByText('Review queue', { exact: true }).waitFor();
    assert.equal(await page.locator('.rv-card').count(), 4);
    assert.equal(await page.locator('textarea').first().inputValue(), rows[0].questions[0].answerProposal.answer);
    assert.equal(await page.locator('.rv-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
    const factual = page.locator('article', { has: page.getByText('Test Profile', { exact: true }) });
    await factual.getByText('Muse draft — requires your review', { exact: true }).waitFor();
    await factual.getByText('Muse flagged missing facts: Confirm timezone', { exact: true }).waitFor();
    await factual.locator('input:not([type=checkbox]),textarea').fill('America/Chicago');
    await factual.locator('input:not([type=checkbox]),textarea').press('a');
    assert.equal(actions.length, 0, 'typing A must not approve');
    await factual.locator('.review-question').focus();
    await factual.locator('.review-question').press('a');
    await page.getByRole('alert').waitFor();
    assert.equal(actions[0].action, 'question_review'); assert.equal(actions[0].review.operation, 'approve_answer'); assert.equal(actions[0].review.scope, 'application');
    assert.equal(actions[0].expectedUpdatedAt, rows[1].updatedAt);
    await factual.getByText('Sources & answer reuse').click();
    await factual.locator('select').selectOption('global');
    await factual.getByRole('button', { name: '✓ Approve answer' }).click();
    await page.waitForFunction(() => !document.querySelector('article[aria-busy="true"]'));
    assert.equal(actions[1].review.scope, 'global');
    await page.getByRole('button', { name: /^Action required/ }).click();
    assert.equal(await page.locator('.rv-card').count(), 1); assert.equal(await page.locator('textarea').count(), 0);
    await page.getByRole('heading', { name: 'Attachment needs attention', exact: true }).waitFor();
    await page.getByText("Atriveo couldn't confirm that this attachment finished saving. Open the form to verify it, or skip this job.", { exact: true }).waitFor();
    await page.getByRole('button', { name: /^All / }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.rv-columns').style.gridTemplateColumns.startsWith('repeat(1,'));
    assert.equal(await page.locator('.rv-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/tmp/atriveo-review-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector('.rv-columns').style.gridTemplateColumns.startsWith('repeat(3,'));
    await page.screenshot({ path: '/tmp/atriveo-review-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(actions.every(a => a.action === 'question_review'), 'no submission/continue action in tests');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('bulk discard previews exact records, supports cancellation, and never sends submission actions', async () => {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: {width:1440,height:1000} });
  const actions=[];
  try {
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/auth/me') return route.fulfill({json:{user:{id:1,name:'Test',email:'test@example.test'}}});
      if(url.pathname==='/applications/review-queue') return route.fulfill({json:{ok:true,generatedAt:'2026-10-02T23:00:00Z',counts,unanswered:order,cards:rows}});
      if(url.pathname==='/applications/action') {
        const body=route.request().postDataJSON();actions.push(body);
        return route.fulfill({json:body.operation==='preview'?{ok:true,targets:rows.slice(0,2),moreAvailable:false}:{ok:true,discarded:rows.slice(0,2).map(r=>r.id),errors:[]}});
      }
      if(url.hostname==='127.0.0.1'&&url.port===String(port)) return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/unanswered`);
    await page.getByRole('checkbox',{name:'Select Test Midpage',exact:true}).check();
    await page.getByRole('checkbox',{name:'Select Test Profile',exact:true}).check();
    await page.getByRole('button',{name:'Discard selected (2)',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.deepEqual(actions[0].ids,['motivation','factual']);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(actions.length,1);
    await page.getByRole('button',{name:'Clear older than 24 hours',exact:true}).click();
    await page.getByRole('dialog').waitFor();assert.equal(actions[1].olderThan24Hours,true);
    await page.getByRole('button',{name:'Discard 2 applications',exact:true}).click();
    await page.getByRole('status').filter({hasText:'2 applications discarded'}).waitFor();
    assert.equal(actions[2].operation,'confirm');assert.deepEqual(actions[2].targets,rows.slice(0,2).map(({id,updatedAt})=>({id,updatedAt})));
    assert.ok(actions.every(a=>a.action==='discard_applications'));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});


test('question discovery shows all resolved answers and requires explicit Fill and verify', async () => {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const actions = [], errors = [];
  const app = { ...rows[0], id: 'discovered', company: 'Collected Example', questions: [], questionReviewStatus: 'complete', reviewStage: 'questions' };
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Test reviewer' } } });
      if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: app.updatedAt, counts: { unanswered: 1, questions: 0, ready: 0 }, unanswered: [{ id: app.id, updatedAt: app.updatedAt, n: 0 }], cards: [app] } });
      if (url.pathname === '/applications/detail') return route.fulfill({ json: { ok: true, id: app.id, company: app.company, title: app.title, status: 'NEEDS_REVIEW', ats: 'ashby', url: app.url, resume: {}, questions: [{ label: 'Name', required: true, step: 0, type: 'text', resolution: 'answered', verified: false, answerKind: 'value', answer: 'Test Candidate', source: 'profile', sensitive: null }], timeline: [], attempts: [], submission: {}, failure: null } });
      if (url.pathname === '/applications/action') { actions.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/unanswered`);
    await page.getByRole('button', { name: 'Fill and verify', exact: true }).waitFor();
    assert.equal(actions.length, 0);
    await page.getByText('Review all extracted questions and answers', { exact: true }).click();
    await page.getByText('Test Candidate', { exact: true }).waitFor();
    assert.equal(actions.length, 0, 'viewing the answer plan cannot fill or submit');
    await page.getByRole('button', { name: 'Fill and verify', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('article[aria-busy="true"]'));
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'continue_application');
    assert.equal(actions[0].expectedUpdatedAt, app.updatedAt);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
