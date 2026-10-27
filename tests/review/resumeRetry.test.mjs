import test from 'node:test';import assert from 'node:assert/strict';
import {retryResumes,resumePipeline} from '../../scripts/resume-queue.mjs';

function fakeDb(jobs,descriptions){
 const matches=(doc,q)=>Object.entries(q).every(([k,v])=>{
  if(k==='$or')return v.some(o=>matches(doc,o));
  const val=k.split('.').reduce((o,p)=>o?.[p],doc);
  if(v&&typeof v==='object'&&!(v instanceof Date)&&!Array.isArray(v)){
   if('$lt' in v)return val!=null&&val<v.$lt;if('$gte' in v)return val!=null&&val>=v.$gte;if('$in' in v)return v.$in.includes(val);
  }
  return v===null?val==null:val===v;
 });
 return {collection:name=>{
  const rows=name==='jobs'?jobs:descriptions;
  return {
   find:(q)=>({toArray:async()=>rows.filter(d=>matches(d,q))}),
   findOne:async(q)=>rows.find(d=>matches(d,q))??null,
   countDocuments:async(q)=>rows.filter(d=>matches(d,q)).length,
   updateOne:async(q,u)=>{const d=rows.find(x=>matches(x,q));if(d&&u.$set)Object.assign(d,Object.fromEntries(Object.entries(u.$set).map(([k,v])=>[k,v])));return {matchedCount:d?1:0};},
   aggregate:()=>({toArray:async()=>name==='descriptions'?rows.filter(d=>String(d.description||'').length>=200).map(d=>({job_url:d.job_url,len:d.description.length})):[]}),
  };
 }};
}
const now=Date.parse('2026-10-27T12:00:00Z'),recent='2026-10-27T10:00:00.000Z';
const failed=(url,error)=>({job_url:url,company:'C',resume:{status:'failed',stage:'GATED',error,updated_at:recent}});

test('retry requeues what can succeed, waits for job text, and never retries out-of-scope roles',async()=>{
 const jobs=[failed('https://x/1','JD not found or too short in Mongo descriptions'),failed('https://x/2','JD not found or too short in Mongo descriptions'),failed('https://x/3','Embedded/hardware role — no embedded evidence in AC bank'),failed('https://x/4','Role is marketing/non-engineering — profile is SWE/AI'),failed('https://x/5','pdflatex exited 1')];
 const r=await retryResumes(fakeDb(jobs,[{job_url:'https://x/1',description:'x'.repeat(300)}]),{now});
 assert.deepEqual({requeued:r.requeued,waitingForText:r.waitingForText,notRetryable:r.notRetryable},{requeued:2,waitingForText:1,notRetryable:2});
 assert.equal(jobs[0].resume.status,'queued');assert.equal(jobs[4].resume.status,'queued');assert.equal(jobs[1].resume.status,'failed');assert.equal(jobs[2].resume.status,'failed');
});

test('stuck means a lease that ran out; a live lease is building',async()=>{
 const live={job_url:'https://x/live',resume:{status:'running',stage:'TEX',lease_until:new Date(now+600000),updated_at:recent}};
 const dead={job_url:'https://x/dead',resume:{status:'running',stage:'GATED',lease_until:new Date(now-86400000),updated_at:'2026-10-05T17:00:00.000Z'}};
 const db={collection:()=>({
  countDocuments:async(q)=>{const s=JSON.stringify(q);return s.includes('"$lt"')?1:s.includes('running')?1:0;},
  find:()=>({toArray:async()=>[]}),aggregate:()=>({toArray:async()=>[]}),
 })};
 const p=await resumePipeline(db,{now:now+1});
 assert.equal(p.stuck,1);assert.equal(p.running,1);assert.deepEqual(p.reasons,[]);
 assert.ok(live&&dead);
});
