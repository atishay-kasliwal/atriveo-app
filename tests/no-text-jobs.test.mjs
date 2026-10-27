import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {noTextJobs,generalResumes,noTextKey} from '../scripts/no-text-jobs.mjs';
import {prepareGeneralKit,ApplicationKitError,applicationLocation} from '../scripts/application-kit.mjs';

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
test('a manifest written on the Mac still finds the same PDF under this server',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'macmanifest-'));fs.mkdirSync(path.join(root,'general','Data Analyst'),{recursive:true});fs.writeFileSync(path.join(root,'general','Data Analyst','Atishay Kasliwal.pdf'),pdf);
 fs.writeFileSync(path.join(root,'general','manifest.json'),JSON.stringify({resumes:{
  'data-analytics':{label:'Data Analyst',path:'/Users/someone/Documents/tailored-resumes/general/Data Analyst/Atishay Kasliwal.pdf'},
  'ai-engineer':{label:'AI',path:'/Users/someone/Documents/tailored-resumes/general/../../../etc/passwd'}}}));
 const got=generalResumes(root);
 assert.deepEqual(Object.keys(got),['data-analytics']);
 assert.equal(got['data-analytics'].path,path.join(root,'general','Data Analyst','Atishay Kasliwal.pdf'));
});
test('the day range keeps today, yesterday, the last 7 and 30 days, and counts each',async()=>{
 const {inRange,rowDay}=await import('../scripts/no-text-jobs.mjs');
 const now=Date.parse('2026-10-27T16:00:00Z');
 assert.equal(inRange('2026-10-27','today',now),true);assert.equal(inRange('2026-10-26','today',now),false);
 assert.equal(inRange('2026-10-26','yesterday',now),true);assert.equal(inRange('2026-10-27','yesterday',now),false);
 assert.equal(inRange('2026-10-21','7d',now),true);assert.equal(inRange('2026-10-20','7d',now),false);
 assert.equal(inRange('2026-09-28','30d',now),true);assert.equal(inRange('2026-09-27','30d',now),false);
 assert.equal(inRange(null,'today',now),false);assert.equal(inRange(null,'',now),true);
 assert.equal(rowDay({postedAt:'2026-10-27T00:00:00.000Z'}),'2026-10-27','a date-only posting date is that day, not the evening before in New York');
 assert.equal(rowDay({postedAt:null,foundAt:'2026-10-28T02:30:00.000Z'}),'2026-10-27','a timestamp is its New York day');
 const d=db({...base,jobs:[job(1,'Software Engineer','Acme',{date_posted:'2026-10-27',run_at:'2026-10-27T10:00:00Z'}),job(2,'AI Engineer','Beta',{date_posted:'2026-10-26',run_at:'2026-10-26T10:00:00Z'}),job(3,'Software Engineer','Gamma',{date_posted:'2026-10-10',run_at:'2026-10-10T10:00:00Z'})]});
 const t=await noTextJobs(d,{outRoot,range:'today',now});
 assert.deepEqual(t.rows.map(r=>r.company),['Acme']);assert.equal(t.allTotal,1);
 assert.deepEqual(t.counts.byRange,{all:3,today:1,yesterday:1,'7d':2,'30d':3});
 assert.equal((await noTextJobs(d,{outRoot,range:'7d',now})).total,2);assert.equal((await noTextJobs(d,{outRoot,now})).total,3);
});

test('the kit Location is the job\'s own place, or New York, NY when the job has none',async()=>{
 const cases=[['Palo Alto, CA, USA','Palo Alto, CA'],['San Francisco Bay Area','San Francisco Bay Area'],['Boston, MA; New York, NY','Boston, MA'],['Austin, TX or Remote','Austin, TX'],['Bengaluru, Karnataka, India','Bengaluru, Karnataka, India'],['Remote, US','New York, NY'],['USA','New York, NY'],['Remote','New York, NY'],['','New York, NY'],[null,'New York, NY']];
 for(const [raw,want] of cases)assert.equal(applicationLocation(raw),want,String(raw));
 const loc=async place=>(await prepareGeneralKit(db({...base,jobs:[job(1,'Software Engineer','Acme',{location:place})]}),{jobUrl:'https://www.linkedin.com/jobs/view/1'},{outRoot,profile:{name:'Alex Rivera',location:'Somewhere Else'}})).fields.find(f=>f.key==='location').value;
 assert.equal(await loc('Denver, CO, USA'),'Denver, CO');assert.equal(await loc(undefined),'New York, NY');assert.equal(await loc('USA'),'New York, NY');
});
test("Matching's General source: card-shaped jobs with a general resume, filters, counts and no repeats",async()=>{
 const {generalQueue,generalCount,clearNoTextCache}=await import('../scripts/no-text-jobs.mjs');
 clearNoTextCache();
 const now=Date.parse('2026-10-20T16:00:00Z');
 const today=n=>({date_posted:`2026-10-20`,run_at:`2026-10-20T1${n}:00:00Z`});
 const d=db({...base,jobs:[job(1,'Software Engineer','Acme',today(1)),job(2,'Software Engineer II','Beta',today(2)),job(3,'AI Engineer','Gamma',today(3)),job(4,'Software Engineer','Acme',{date_posted:'2026-10-10',run_at:'2026-10-10T10:00:00Z'})]});
 const q=await generalQueue(d,{outRoot,period:'today',now,limit:8});
 assert.equal(q.ok,true);assert.deepEqual(q.jobs.map(j=>j.company),['Beta','Acme'],'only jobs with a general resume for their role (AI has none here), newest first, today only');
 const j=q.jobs[0];
 assert.equal(j.general,true);assert.equal(j.id,'https://www.linkedin.com/jobs/view/2');assert.equal(j.fit,null);assert.equal(j.ready,null);assert.equal(j.resumePath,path.join(outRoot,'general','Software Engineer','Atishay Kasliwal.pdf'));
 assert.equal(j.generalLabel,'SWE');assert.equal(j.position,1);assert.deepEqual(j.jd.requirements,[]);
 assert.equal(q.total,2);assert.equal(q.stats.remaining,2);assert.deepEqual(q.facets.period,{today:2,yesterday:0,'7d':2,all:3});
 assert.equal(q.companies.find(c=>c.name==='Acme').count,1);
 const acme=await generalQueue(d,{outRoot,period:'all',now,company:'acme'});assert.deepEqual(acme.jobs.map(x=>x.key).sort(),[noTextKey('https://www.linkedin.com/jobs/view/1'),noTextKey('https://www.linkedin.com/jobs/view/4')].sort());
 const seen=await generalQueue(d,{outRoot,period:'today',now,exclude:[j.key]});assert.deepEqual(seen.jobs.map(x=>x.company),['Acme']);
 assert.equal((await generalQueue(d,{outRoot,period:'all',now,role:'ai-engineer'})).total,0,'the AI role has no general resume here, so none is offered');
 assert.equal(await generalCount(d,{outRoot,period:'7d',now}),2);
 const find=(await generalQueue(d,{outRoot,period:'all',now,query:'beta'}));assert.deepEqual(find.jobs.map(x=>x.company),['Beta']);
});

test("General source honours several roles at once",async()=>{
 const {generalQueue,clearNoTextCache}=await import('../scripts/no-text-jobs.mjs');clearNoTextCache();
 const now=Date.parse('2026-10-20T16:00:00Z'),today=n=>({date_posted:'2026-10-20',run_at:`2026-10-20T1${n}:00:00Z`});
 const d=db({...base,jobs:[job(1,'Software Engineer','Acme',today(1)),job(2,'Software Engineer II','Beta',today(2)),job(3,'AI Engineer','Gamma',today(3))]});
 assert.equal((await generalQueue(d,{outRoot,period:'today',now,role:'software-engineer'})).total,2);
 assert.equal((await generalQueue(d,{outRoot,period:'today',now,role:'software-engineer,ai-engineer'})).total,2,'the AI role has no general resume here, so only the software jobs');
});
