import test from 'node:test';import assert from 'node:assert/strict';
import {sameCompany,companyRegex,companyOf,jobsForCompanies,jobsForPerson,warmJobs,knownCompanies} from '../scripts/network-jobs.mjs';
import {runJobAlerts} from '../scripts/network-reminders.mjs';

// An in-memory database that understands the few query shapes these reads use. Every company and person is invented.
const match=(doc,q)=>Object.entries(q).every(([k,v])=>{const val=k.split('.').reduce((o,p)=>o?.[p],doc);
 if(v instanceof RegExp)return typeof val==='string'&&v.test(val);
 if(v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Date))return Object.entries(v).every(([op,x])=>op==='$gte'?val>=x:op==='$ne'?val!==x:op==='$in'?x.includes(val):false);
 return val===v;});
const fakeDb=(seed={})=>{const cols=new Map(Object.entries(seed).map(([n,docs])=>[n,new Map(docs.map((d,i)=>[d._id??`${n}${i}`,{...d}]))]));
 const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const cur=(rows)=>({sort:()=>cur(rows),limit:(k)=>cur(rows.slice(0,k)),toArray:async()=>rows});return{
  find:(q={})=>cur([...m.values()].filter(d=>match(d,q))),findOne:async q=>[...m.values()].find(d=>match(d,q))??null,
  insertOne:async d=>{if(m.has(d._id)){const e=new Error('dup');e.code=11000;throw e}m.set(d._id,{...d})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0}),
  updateOne:async(q,u,o)=>{const d=m.get(q._id);if(d)Object.assign(d,u.$set);else if(o?.upsert)m.set(q._id,{_id:q._id,...u.$set})}}};return{collection:col}};
const NOW=new Date('2026-10-28T15:00:00Z'),ago=h=>new Date(NOW.getTime()-h*3600e3);
const seed=()=>({
 network_sources:[{_id:'rs',name:'Randstad',type:'company'},{_id:'ev',name:'Open Summit',type:'event'}],
 network_people:[{_id:'dana',name:'Dana Whit',sourceId:'rs',watchJobs:true},{_id:'ben',name:'Ben Cart',sourceId:'ev',company:'Northwind Labs'},{_id:'kim',name:'Kim Lo',sourceId:'ev'},{_id:'old',name:'Old One',sourceId:'rs',archived:true}],
 jobs:[{job_url:'j1',company:'Randstad USA',title:'Data Engineer',location:'Raleigh, NC',run_at:ago(5),resume:{status:'success'}},
  {job_url:'j2',company:'Northwind Labs, Inc.',title:'ML Engineer',run_at:ago(30)},{job_url:'j3',company:'Randstadt Logistics',title:'Driver',run_at:ago(2)},
  {job_url:'j4',company:'Randstad',title:'Old role',run_at:ago(24*90)},{job_url:'j5',company:'Randstad',title:'Closed',run_at:ago(3),apply_type:'closed'},{job_url:'j6',company:'Northwind Labs',title:'Applied one',run_at:ago(24*200)}],
 staffing_jobs:[{job_url:'s1',company:'Randstad',title:'Analyst (contract)',location:'Durham, NC',first_seen_at:ago(1).toISOString(),expired:false},{job_url:'s2',company:'Randstad',title:'Gone',expired:true}],
 applications:[{_id:'a1',status:'APPLIED',jobUrls:['j6'],lifecycle:{appliedAt:'2026-04-10T12:00:00Z'}}],
 job_swipes:[{job_url:'j2',direction:'left'}],
});

test('company names match loosely but not wrongly; "works at" falls back to a company source; the Mongo filter is anchored',()=>{
 assert.ok(sameCompany('Randstad','Randstad USA'));assert.ok(sameCompany('Northwind Labs','northwind labs, inc.'));assert.ok(!sameCompany('Randstad','Randstadt Logistics'));assert.ok(sameCompany('AT&T','AT and T Inc'));
 assert.ok(!sameCompany('AB','AB Corp'),'too short to trust');
 const by=new Map([['rs',{type:'company',name:'Randstad'}],['ev',{type:'event',name:'Summit'}]]);
 assert.equal(companyOf({sourceId:'rs'},by),'Randstad');assert.equal(companyOf({sourceId:'ev'},by),'');assert.equal(companyOf({sourceId:'ev',company:'Acme'},by),'Acme');
 assert.equal(companyRegex(['The Acme Co','x']).source,'^\\s*(?:the\\s+)?(?:acme)');assert.equal(companyRegex(['']),null);});

test('jobs at a company: open board jobs and staffing postings, your status on each, past applications of any age; closed, old and look-alike companies left out',async()=>{
 const db=fakeDb(seed());
 const r=await jobsForCompanies(db,['Randstad'],{now:NOW});
 assert.deepEqual(r.map(j=>[j.url,j.status,j.site||'board']),[['s1','new','staffing'],['j1','ready','board']],'Randstadt Logistics is another company (whole words only)');
 const nw=await jobsForCompanies(db,['Northwind Labs'],{now:NOW});
 assert.deepEqual(nw.map(j=>[j.url,j.status]),[['j2','passed'],['j6','applied']]);assert.equal(nw[1].appliedAt,'2026-04-10T12:00:00.000Z');
 assert.deepEqual((await jobsForPerson(db,'ben',{now:NOW})).company,'Northwind Labs');assert.deepEqual(await jobsForPerson(db,'kim',{now:NOW}),{company:'',jobs:[]});});

test('the Jobs tab groups people by company, open jobs first; job cards get the known companies',async()=>{
 const db=fakeDb(seed());
 const g=await warmJobs(db,{now:NOW});assert.deepEqual(g.map(x=>[x.company,x.people.map(p=>p.name),x.jobs.length]),[['Randstad',['Dana Whit'],2],['Northwind Labs',['Ben Cart'],2]]);
 assert.deepEqual((await knownCompanies(db)).map(c=>[c.name,c.people.length]),[['Randstad',1],['Northwind Labs',1]],'archived people are left out');});

test('alerts: the first check only starts the clock; then each new job at a watched company alerts once, naming the person; nothing for unwatched companies',async()=>{
 const WEB={VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'k',VAPID_SUBJECT:'mailto:x@example.test',PUSH_EVENT_USER_ID:'me@example.test'};
 const db=fakeDb(seed());const got=[];const webPush=async(_d,m)=>{got.push(m);return{sent:1,failed:0}};
 assert.equal(await runJobAlerts({db,env:WEB,webPush,now:ago(10)}),null,'starts the clock');
 const r=await runJobAlerts({db,env:WEB,webPush,now:NOW});
 assert.deepEqual(r.jobs.map(j=>j.url),['s1','j1']);assert.equal(r.web.title,'Randstad posted 2 new jobs');assert.match(r.web.body,/^Dana Whit works there\. Analyst \(contract\) · Data Engineer\. Ask for a referral\?$/);
 assert.equal(r.web.url,'/network?person=dana&jobs=1');
 assert.equal(await runJobAlerts({db,env:WEB,webPush,now:new Date(NOW.getTime()+600e3)}),null,'each job once');assert.equal(got.length,1);
 const ntfyOnly=fakeDb(seed());const sent=[];await runJobAlerts({db:ntfyOnly,env:{NTFY_TOPIC:'t'},publish:async m=>{sent.push(m);return true},now:ago(10)});
 await runJobAlerts({db:ntfyOnly,env:{NTFY_TOPIC:'t'},publish:async m=>{sent.push(m);return true},now:NOW});assert.equal(sent[0].message,'2 new jobs at a company where you know someone.');assert.ok(!/Dana|Randstad/.test(JSON.stringify(sent)));
 const failing=fakeDb(seed());await runJobAlerts({db:failing,env:WEB,webPush,now:ago(10)});
 assert.equal(await runJobAlerts({db:failing,env:WEB,webPush:async()=>({sent:0,failed:1}),now:NOW}),null);
 assert.equal((await runJobAlerts({db:failing,env:WEB,webPush,now:new Date(NOW.getTime()+600e3)})).jobs.length,2,'retried after a failed send');});

test('staffing source contexts remain separate in Network but share canonical employer job matches', async () => {
 const records=seed();records.network_sources[0].type='staffing';
 records.network_sources.push({_id:'rs-event',name:'Randstad',type:'staffing',parentSourceId:'ev',context:'Met at the summit'});
 records.network_people.push({_id:'new-contact',name:'Ari Vale',sourceId:'rs-event',watchJobs:false});
 const db=fakeDb(records);
 const person=await jobsForPerson(db,'new-contact',{now:NOW});assert.equal(person.company,'Randstad');assert.ok(person.jobs.some(j=>j.url==='j1'));
 const groups=await warmJobs(db,{now:NOW});const matches=groups.filter(g=>g.company==='Randstad');
 assert.equal(matches.length,1);assert.deepEqual(matches[0].people.map(p=>p.id).sort(),['dana','new-contact']);
});
