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
const q = (label, answer = '', extra = {}) => ({ fieldKey: label, fingerprint: label, label, type: 'textarea', required: true, options: [], canonicalKey: null, sensitive: null, reason: 'UNKNOWN_QUESTION', detail: null, answerProposal: { state: answer ? 'ready_for_review' : 'needs_input', answer, family: 'experience_project', source: 'approved_story', reason: 'approved_source' }, ...extra });
const app = (id, company, questions) => ({ id, company, questions, title: 'Software Engineer', ats: 'ashby', url: 'https://blocked.test/form', priority: 0, updatedAt: '2026-10-03T20:00:00.000Z', questionReviewStatus: questions.length ? 'open' : 'complete', reviewStage: 'questions' });
const initialRows = () => [
  app('acme', 'Acme Robotics', [
    q('Why are you interested in this role?', 'I enjoy building reliable backend systems that connect software with the physical world. This role combines the systems work I have done with a domain I want to understand more deeply.'),
    q('Tell us about a project you are proud of.', 'I built a data processing service and worked with the team to improve reliability. I focused on clear failure handling, useful diagnostics, and predictable behavior.'),
    q('What are your salary expectations?', '', { type: 'text', sensitive: 'salary' }),
    q('Country', 'United States', { type: 'select', options: ['United States', 'Canada'] }),
    q('What timezone are you in?', 'America/New_York', { type: 'text', openEndedUserReview: { status: 'draft', action: 'replaced', generatedBy: 'muse', draftAnswer: 'America/New_York', missingFacts: ['Confirm timezone'] } }),
  ]),
  app('beacon', 'Beacon', [q('Describe your experience.', 'A saved company-specific answer.')]),
  app('cedar', 'Cedar Analytics', [q('Resume', '', { type: 'file', reason: 'UPLOAD_UNVERIFIED', answerProposal: { state: 'action_required', family: 'attachment', source: 'none', reason: 'attachment_requires_remote_verification' } })]),
];
async function fixture(rows, action = () => ({ status: 200, body: { ok: true } })) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, 'dist-apply', req.url.split('?')[0]);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'dist-apply/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 1, name: 'Atishay', email: 'test@example.test' } } });
    if (url.pathname === '/applications/review-queue') return route.fulfill({ json: { ok: true, generatedAt: rows[0]?.updatedAt, counts: { unanswered: rows.length, questions: rows.reduce((n,a) => n + a.questions.length,0), reviewComplete: rows.filter(a => !a.questions.length).length, ready: 0 }, unanswered: rows.map(a => ({ id:a.id, company:a.company, title:a.title, updatedAt:a.updatedAt, n:a.questions.length, needsInput:a.questions.filter(q => !q.answerProposal?.answer).length, actionRequired:a.questions.filter(q => q.type==='file').length })), cards: rows } });
    if (url.pathname === '/applications/detail') return route.fulfill({ json: { ok:true, id:rows[0].id, company:rows[0].company, title:rows[0].title, ats:'ashby',status:'NEEDS_REVIEW',url:rows[0].url,resume:{},questions:[{label:'Name',step:0,required:true,type:'text',resolution:'answered',verified:false,answerKind:'value',answer:'Test Candidate',source:'profile'}],timeline:[],attempts:[],submission:{},failure:null } });
    if (url.pathname === '/applications/action') { const body = route.request().postDataJSON(); calls.push(body); const result = action(body); return route.fulfill({ status:result.status, json:result.body }); }
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/unanswered`);
  await page.getByText('One company. One complete form.', { exact: true }).waitFor();
  return { page, calls, errors, close: async () => { await browser.close(); await new Promise(resolve=>server.close(resolve)); } };
}
async function noPageScroll(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'document must fit viewport');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'document must not overflow horizontally');
  const box = await page.locator('.ar-actionbar').boundingBox();
  assert.ok(box && box.y + box.height <= (await page.evaluate(() => window.innerHeight)) + 1, 'application actions stay visible');
}

test('five questions form one application, fit the desktop, preserve edits between companies and approve together', async () => {
  const f = await fixture(initialRows(), () => ({ status:400, body:{ok:false,error:'Application changed; load the latest version.'} }));
  const {page,calls,errors}=f;
  try {
    await page.getByRole('heading',{name:'Acme Robotics',exact:true}).waitFor();
    assert.equal(await page.locator('.ar-question').count(),5);
    assert.equal(await page.getByRole('button',{name:'Approve answer',exact:true}).count(),0);
    const approve=page.getByRole('button',{name:'Approve all 5 answers',exact:true});
    assert.equal(await approve.isDisabled(),true);
    await page.getByLabel('What are your salary expectations?',{exact:false}).filter({visible:true}).last().fill('120000');
    await page.getByRole('button',{name:/Beacon.*Software Engineer/}).click();
    await page.getByRole('heading',{name:'Beacon',exact:true}).waitFor();
    await page.getByRole('button',{name:/Acme Robotics.*Software Engineer/}).click();
    assert.equal(await page.locator('input').filter({hasNot:page.locator('[type=checkbox]')}).count()>0,true);
    assert.equal(await page.getByLabel('What are your salary expectations?',{exact:false}).last().inputValue(),'120000');
    await page.getByText('Muse draft · review before approving',{exact:true}).waitFor();
    await page.getByText('Confirm: Confirm timezone',{exact:true}).waitFor();
    await noPageScroll(page);
    for (const selector of ['.ar-question textarea','.ar-question input','.ar-question select']) for (const input of await page.locator(selector).all()) { const b=await input.boundingBox(); assert.ok(b && b.height>=30 && b.width>100); }
    await page.screenshot({path:'/tmp/atriveo-company-review-desktop.png',fullPage:true});
    await page.setViewportSize({width:1366,height:768}); await page.waitForTimeout(100); await noPageScroll(page);
    assert.equal(await page.locator('.ar-question').count(),5);
    await page.screenshot({path:'/tmp/atriveo-company-review-laptop.png',fullPage:true});
    assert.equal(calls.length,0);
    await approve.click(); await page.getByRole('alert').waitFor();
    assert.equal(calls.length,1); assert.equal(calls[0].action,'application_review'); assert.equal(calls[0].operation,'approve_all');
    assert.equal(calls[0].answers.length,5); assert.equal(calls[0].applicationId,'acme'); assert.equal(calls[0].expectedUpdatedAt,'2026-10-03T20:00:00.000Z');
    assert.ok(calls.every(c=>c.action!=='approve_submit' && c.action!=='continue_application'));
    assert.deepEqual(errors,[]);
  } finally {await f.close();}
});

test('long forms use pages; mobile, expanded answers and attachments stay accessible',async()=>{
  const rows=initialRows(); rows[0].questions=Array.from({length:13},(_,i)=>q(`Question ${i+1}`,`Reviewed answer ${i+1}`));
  const f=await fixture(rows);const {page,calls}=f;
  try {
    await page.getByRole('button',{name:'Approve all 13 answers',exact:true}).waitFor();
    assert.equal(await page.locator('.ar-question').count(),6); await noPageScroll(page);
    await page.getByRole('button',{name:'Next →',exact:true}).click(); await page.getByText('Questions 7–12 of 13',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Expand question 7',exact:true}).click();
    const dialog=page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByLabel('Question 7',{exact:false}).fill('Edited full answer');
    await dialog.getByRole('button',{name:'Done editing'}).click();
    await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(100); await noPageScroll(page);
    await page.screenshot({path:'/tmp/atriveo-company-review-mobile.png',fullPage:true});
    await page.getByLabel('Choose application').selectOption('cedar');
    await page.getByText('Resume',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Approve all 1 answer',exact:true}).isDisabled(),true);
    assert.equal(calls.length,0);
  }finally{await f.close();}
});

test('complete reviewed forms expose separate Fill and verify; details cause no action',async()=>{
  const f=await fixture([app('complete','Complete Example',[])]);const{page,calls}=f;
  try{
    await page.getByRole('button',{name:'Fill and verify',exact:true}).waitFor();
    await page.getByRole('tab',{name:'Application details',exact:true}).click(); await page.getByText('Test Candidate',{exact:true}).waitFor();
    assert.equal(calls.length,0);await page.getByRole('button',{name:'Fill and verify',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[aria-busy=true]'));
    assert.equal(calls[0].action,'continue_application');assert.equal(calls.length,1);
  }finally{await f.close();}
});

test('one suggestion can be rejected on its own, with its confidence and context shown; edits are never lost to it',async()=>{
  const rows=initialRows();
  rows[0].questions[0].openEndedSuggestion={suggestedAnswer:rows[0].questions[0].answerProposal.answer,confidenceBand:'high',selectedStory:'Robotics telemetry service',matchedSignals:['jd_skill:python','domain:robotics']};
  rows.push(app('done','Delta Labs',[]));
  const f=await fixture(rows);const{page,calls,errors}=f;
  try{
    await page.getByRole('heading',{name:'Acme Robotics',exact:true}).waitFor();
    await page.getByText('4 applications · 1 ready to fill and verify',{exact:false}).waitFor();
    const first=page.locator('.ar-question').first();
    await first.getByText('Suggested from approved information · high confidence',{exact:true}).waitFor();
    // No reject for a question without a suggestion (salary) or a control that needs the form (file).
    assert.equal(await page.locator('.ar-question').nth(2).getByRole('button',{name:'Reject',exact:true}).count(),0);
    await first.getByRole('button',{name:'Expand question 1',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByText('High confidence · context: python, robotics',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Done editing'}).click();
    assert.equal(calls.length,0);
    await first.getByRole('button',{name:'Reject',exact:true}).click();
    await page.getByText('Suggestion rejected. Add your own answer before approving.',{exact:true}).waitFor();
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0],{action:'question_review',fieldKey:'Why are you interested in this role?',review:{operation:'reject_suggestion'},applicationId:'acme',expectedUpdatedAt:'2026-10-03T20:00:00.000Z'});
    // An unsaved edit disables Reject: rejecting reloads the form and would drop it.
    await page.getByLabel('What are your salary expectations?',{exact:false}).filter({visible:true}).last().fill('120000');
    assert.equal(await first.getByRole('button',{name:'Reject',exact:true}).isDisabled(),true);
    assert.equal(calls.length,1);assert.deepEqual(errors,[]);
  }finally{await f.close();}
});

test('optional questions are shown and can stay blank: approval sends them as leave blank, required ones still block',async()=>{
  const rows=[app('opt','Orbit Labs',[
    q('Why Orbit?','Because I build reliable systems.'),
    q('Pronouns','',{type:'text',required:false}),
    q('How did you hear about us?','LinkedIn',{type:'text',required:false}),
    q('Cover letter','',{type:'file',required:false,reason:'UPLOAD_UNVERIFIED',answerProposal:{state:'action_required',family:'attachment',source:'none',reason:'optional_attachment'}}),
  ])];
  const f=await fixture(rows);const{page,calls,errors}=f;
  try{
    await page.getByRole('heading',{name:'Orbit Labs',exact:true}).waitFor();
    assert.equal(await page.locator('.ar-optional').count(),3);
    await page.getByText('answers ready · 3 optional',{exact:true}).waitFor();
    const approve=page.getByRole('button',{name:'Approve 2 · leave 2 blank',exact:true});
    assert.equal(await approve.isDisabled(),false);
    // A required answer cleared: approval waits for it.
    await page.getByLabel('Why Orbit?',{exact:false}).filter({visible:true}).last().fill('');
    await page.getByText('1 required answer left',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^Approve /}).isDisabled(),true);
    await page.getByLabel('Why Orbit?',{exact:false}).filter({visible:true}).last().fill('Because I build reliable systems.');
    await approve.click();
    await page.getByText('All answers approved, 2 optional left blank. You can now fill and verify.',{exact:true}).waitFor();
    assert.equal(calls.length,1);
    assert.equal(calls[0].operation,'approve_all');
    assert.deepEqual(calls[0].answers.map(a=>a.fieldKey).sort(),['How did you hear about us?','Why Orbit?']);
    assert.deepEqual(calls[0].leaveBlank.sort(),['Cover letter','Pronouns']);
    assert.deepEqual(errors,[]);
  }finally{await f.close();}
});

test('queue management previews exact selected applications and supports cancellation',async()=>{
  const rows=initialRows();const f=await fixture(rows,body=>({status:200,body:body.operation==='preview'?{ok:true,targets:[{id:'acme',updatedAt:rows[0].updatedAt,company:'Acme Robotics',title:'Software Engineer'}],moreAvailable:false}:{ok:true,discarded:['acme'],errors:[]}}));
  const{page,calls}=f;try{
    await page.getByRole('button',{name:'Manage queue',exact:true}).click();await page.getByLabel('Select Acme Robotics',{exact:true}).check();
    await page.getByRole('button',{name:'Discard selected (1)',exact:true}).click();await page.getByRole('dialog').waitFor();
    assert.equal(calls.length,1);assert.deepEqual(calls[0].ids,['acme']);await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(calls.length,1);await page.getByRole('button',{name:'Discard selected (1)',exact:true}).click();
    await page.getByRole('button',{name:'Discard 1 applications',exact:true}).click();await page.getByText('1 applications discarded. History retained.',{exact:true}).waitFor();
    assert.equal(calls[2].operation,'confirm');assert.ok(calls.every(c=>c.action==='discard_applications'));
  }finally{await f.close();}
});
