import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {noTextJobs,generalResumes,noTextKey} from '../scripts/no-text-jobs.mjs';
import {prepareGeneralKit,ApplicationKitError} from '../scripts/application-kit.mjs';

const outRoot=fs.mkdtempSync(path.join(os.tmpdir(),'general-'));
const pdf=Buffer.from('%PDF-1.4 general software engineer resume');
fs.mkdirSync(path.join(outRoot,'general','Software Engineer'),{recursive:true});
fs.writeFileSync(path.join(outRoot,'general','Software Engineer','Atishay Kasliwal.pdf'),pdf);
fs.writeFileSync(path.join(outRoot,'general','manifest.json'),JSON.stringify({resumes:{'software-engineer':{label:'SWE',title:'Software Engineer',path:path.join(outRoot,'general','Software Engineer','Atishay Kasliwal.pdf')},'ai-engineer':{label:'AI',title:'AI Engineer',path:path.join(outRoot,'general','AI Engineer','missing.pdf')}}}));

const job=(n,title,company,extra={})=>({job_url:`https://www.linkedin.com/jobs/view/${n}`,company,title,location:'New York, NY',site:'linkedin',run_at:`2026-10-${10+n}T10:00:00Z`,date_posted:`2026-10-${10+n}`,...extra});
const jobs=[job(1,'Software Engineer','Acme'),job(2,'Software Engineer II','Beta'),job(3,'AI Engineer','Gamma'),job(4,'Software Engineer','Delta'),job(5,'Software Engineer','Echo'),job(6,'Software Engineer','Foxtrot',{apply_type:'closed'}),job(1,'Software Engineer','Acme',{run_at:'2026-09-01T00:00:00Z'})];
const db=data=>({collection:name=>({find:()=>({toArray:async()=>data[name]??[]}),aggregate:()=>({toArray:async()=>data.descriptionLens??[]}),findOne:async q=>(data[name]??[]).find(d=>d.job_url===q.job_url)??null})});
const base={jobs,applications:[],job_swipes:[],matching_hidden_companies:[],descriptionLens:[]};

test('the table lists each job once, newest first, with the general resume for its role',async()=>{
 const r=await noTextJobs(db(base),{outRoot});
 assert.equal(r.allTotal,5,'closed and duplicate rows are dropped');assert.equal(r.rows[0].company,'Echo','newest first');
 const swe=r.rows.find(x=>x.company==='Acme');assert.deepEqual(swe.resume,{track:'software-engineer',label:'SWE'});assert.equal(swe.key,noTextKey(swe.jobUrl));
 assert.equal(r.rows.find(x=>x.company==='Gamma').resume,null,'no general resume built for that track yet (its file is missing)');
 assert.deepEqual(r.generalReady,{'software-engineer':'SWE'});
});
test('applied, skipped, hidden and now-readable jobs leave the table; filters, counts and paging work',async()=>{
 const data={...base,applications:[{_id:'a1',jobUrls:[jobs[0].job_url],lifecycle:{appliedAt:'2026-10-20T10:00:00Z'}}],job_swipes:[{job_url:jobs[1].job_url,direction:'left',swiped_at:'2026-10-20T10:00:00Z'}],matching_hidden_companies:[{key:'delta'}],descriptionLens:[{job_url:jobs[4].job_url,len:900}]};
 const r=await noTextJobs(db(data),{outRoot});
 assert.deepEqual(r.rows.map(x=>x.company),['Gamma'],'Acme applied, Beta skipped, Delta hidden, Echo has its text now');
 const all=await noTextJobs(db(base),{outRoot,track:'software-engineer',limit:2,skip:1,sort:'company'});
 assert.equal(all.total,4);assert.deepEqual(all.rows.map(x=>x.company),['Beta','Delta']);assert.equal(all.counts.byTrack['ai-engineer'],1);
 assert.equal((await noTextJobs(db(base),{outRoot,q:'gamma'})).total,1);
});
test('the general kit carries your general resume for the job role and your shared details',async()=>{
 const kit=await prepareGeneralKit(db(base),{jobUrl:jobs[0].job_url},{outRoot,profile:{name:'Pat Example',email:'pat@example.test',phone:'1',location:'NY',linkedin:'l',github:'g',portfolio:'p'}});
 assert.equal(kit.resume.fileName,'Pat Example.pdf');assert.equal(Buffer.from(kit.resume.base64,'base64').toString(),pdf.toString());assert.equal(kit.general.track,'software-engineer');
 assert.equal(kit.fields.find(f=>f.key==='email').value,'pat@example.test');assert.equal(kit.job.id,jobs[0].job_url);
 await assert.rejects(()=>prepareGeneralKit(db(base),{jobUrl:jobs[2].job_url},{outRoot,profile:{}}),/No general resume/);
 await assert.rejects(()=>prepareGeneralKit(db(base),{jobUrl:'https://x/none'},{outRoot,profile:{}}),ApplicationKitError);
 await assert.rejects(()=>prepareGeneralKit(db(base),{},{outRoot,profile:{}}),/Choose a job/);
});
test('general resumes outside the resume folder or missing are ignored',()=>{
 assert.deepEqual(Object.keys(generalResumes(outRoot)),['software-engineer']);
 const elsewhere=fs.mkdtempSync(path.join(os.tmpdir(),'elsewhere-'));fs.mkdirSync(path.join(elsewhere,'general'));fs.writeFileSync(path.join(elsewhere,'x.pdf'),pdf);
 fs.writeFileSync(path.join(elsewhere,'general','manifest.json'),JSON.stringify({resumes:{'software-engineer':{label:'SWE',path:path.join(elsewhere,'x.pdf')}}}));
 assert.deepEqual(generalResumes(elsewhere),{},'a path outside OUT_ROOT/general is not used');
});
