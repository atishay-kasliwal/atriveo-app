import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {matchingCoverLetter,compileLetter,letterEvidence,validateGenerated} from '../scripts/matching-cover-letter.mjs';
import {buildTex} from '../scripts/cover-letter.mjs';
const paragraphs=['I am applying for this role and would bring my financial systems experience.','At Example, I built reporting workflows for the finance team.','Thank you for considering my application. I would welcome a conversation.'];
test('drafting uses only saved resume points; revisions, PDF invalidation and resume drift are isolated',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resume={source:{kind:'job',jobUrl:'https://example.org/1',company:'Example',title:'Analyst'},jd:'Financial reporting and systems.',email:'candidate@example.org',skills:['SQL'],sections:[{role:'example',label:'Example',bullets:[{text:'Built financial reporting workflows.'}]}]};
 let resolve;const generated=new Promise(r=>resolve=r);let input;
 const deps={root,load:async()=>resume,generate:async request=>{input=JSON.parse(request.user);return generated;},compile:()=>'/test/cover.pdf'};
 const body={source:{jobUrl:resume.source.jobUrl}};
 const status=()=>matchingCoverLetter(null,{...body,action:'status'},deps);
 let state=await status();assert.equal(state.draft,null);
 await assert.rejects(matchingCoverLetter(null,{...body,action:'generate',version:'old',instruction:''},deps),/changed/);
 await matchingCoverLetter(null,{...body,action:'generate',version:state.version,instruction:''},deps);
 assert.equal((await status()).busy,true);
 await assert.rejects(matchingCoverLetter(null,{...body,action:'generate',version:state.version,instruction:''},deps),/already/);
 resolve({paragraphs});await new Promise(r=>setImmediate(r));
 state=await status();assert.deepEqual(input.selectedResumePoints,letterEvidence(resume));assert.equal(input.bank,undefined);assert.deepEqual(state.draft.paragraphs,paragraphs);
 state=await matchingCoverLetter(null,{...body,action:'pdf',version:state.version,paragraphs},deps);assert.equal(state.draft.pdfPath,'/test/cover.pdf');
 state=await matchingCoverLetter(null,{...body,action:'save',version:state.version,paragraphs:[...paragraphs.slice(0,2),'Thank you for your time.']},deps);assert.equal(state.draft.pdfPath,null);
 resume.sections[0].bullets[0].text='Selected a different point.';state=await status();assert.equal(state.stale,true);
 await assert.rejects(matchingCoverLetter(null,{...body,action:'pdf',version:state.draft.version,paragraphs},deps),/changed/);
 await assert.rejects(matchingCoverLetter(null,{source:{track:'software-engineer'},action:'status'},deps),/job-specific/);
});
test('provider errors are visible and can be retried',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-error-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deps={root,load:async()=>({source:{company:'Example',title:'Analyst'},jd:'Reporting.',skills:[],sections:[{role:'Work',bullets:[{text:'Built reports.'}]}]}),generate:async()=>{throw Error('Sign in to Codex');}};
 const source={jobUrl:'https://example.org/error'};const {version}=await matchingCoverLetter(null,{source,action:'status'},deps);
 await matchingCoverLetter(null,{source,action:'generate',version,instruction:''},deps);await new Promise(r=>setImmediate(r));
 assert.match((await matchingCoverLetter(null,{source,action:'status'},deps)).error,/Sign in/);
});
test('template escapes edited prose and compiles a one-page PDF',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cover-pdf-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const profile={name:'Test Candidate',email:'test@example.org',phone:'555-0100',linkedin:'https://example.org'};
 const resume={source:{company:'Research & Finance',title:'Analyst'}};
 assert.match(buildTex({company:resume.source.company,role:'Analyst',paragraphs:['SQL & reports cost $10.'],profile}),/SQL \\& reports cost \\\$10/);
 const pdf=compileLetter({dir,paragraphs,resume,profile});assert.ok(fs.statSync(pdf).size>1000);
});

test('generated metrics must come from the selected points, never the posting',()=>{
 assert.throws(()=>validateGenerated(['I improved reporting by 80%.',...paragraphs.slice(1)], [{role:'Example',bullets:['Built reports for 50 users.']}],{company:'Example',title:'Analyst'}),/absent/);
});

test('progress stage is reported, and invented numbers trigger a retry that names them',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resume={source:{company:'Example',title:'Analyst'},jd:'Reporting.',skills:[],sections:[{role:'Work',bullets:[{text:'Built reports for 50 users.'}]}]};
 const inputs=[];const bad=['I built reports for 50 users over 7 years.',...paragraphs.slice(1)];
 const deps={root,load:async()=>resume,generate:async request=>{inputs.push(JSON.parse(request.user));return {paragraphs:inputs.length===1?bad:paragraphs};}};
 const source={jobUrl:'https://example.org/retry'};const {version}=await matchingCoverLetter(null,{source,action:'status'},deps);
 const started=await matchingCoverLetter(null,{source,action:'generate',version,instruction:''},deps);
 assert.equal(started.stage,'drafting');assert.ok(started.startedAt);
 await new Promise(r=>setTimeout(r,50));
 const state=await matchingCoverLetter(null,{source,action:'status'},deps);
 assert.equal(inputs.length,2);assert.deepEqual(inputs[1].numbersNotAllowed,['7']);assert.equal(state.busy,false);assert.deepEqual(state.draft.paragraphs,paragraphs);
});
test('after three tries with invented numbers the error names them',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-retry3-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resume={source:{company:'Example',title:'Analyst'},jd:'Reporting.',skills:[],sections:[{role:'Work',bullets:[{text:'Built reports.'}]}]};
 let n=0;const deps={root,load:async()=>resume,generate:async()=>{n++;return {paragraphs:['Over 9 years I built reports.',...paragraphs.slice(1)]};}};
 const source={jobUrl:'https://example.org/retry3'};const {version}=await matchingCoverLetter(null,{source,action:'status'},deps);
 await matchingCoverLetter(null,{source,action:'generate',version,instruction:''},deps);await new Promise(r=>setTimeout(r,50));
 assert.equal(n,3);assert.match((await matchingCoverLetter(null,{source,action:'status'},deps)).error,/\(9\)/);
});
