import test from 'node:test';import assert from 'node:assert/strict';
import {nyParts,tierOf,streakOf,buildMessage,dueKinds,runPhoneTick,readGoal,saveGoal,startPhoneSummaries} from '../scripts/phone-summary.mjs';

// New York is UTC-4 in October 2026 (daylight time) and UTC-5 in January.
const at=(iso)=>new Date(iso);
const ny=(h,m=0,day='2026-10-27')=>new Date(Date.parse(`${day}T00:00:00Z`)+((h+4)*60+m)*60000);

function fakeDb({goal=null}={}){const stores={app_settings:new Map(),phone_notices:new Map()};if(goal)stores.app_settings.set('daily_goal',{_id:'daily_goal',goal});
 const col=name=>({findOne:async q=>stores[name].get(q._id)??null,
  updateOne:async(q,u)=>{stores[name].set(q._id,{...(stores[name].get(q._id)??{_id:q._id}),...u.$set});},
  insertOne:async doc=>{if(stores[name].has(doc._id)){const e=new Error('dup');e.code=11000;throw e;}stores[name].set(doc._id,doc);},
  deleteOne:async q=>{stores[name].delete(q._id);},
  find:q=>({toArray:async()=>[...stores[name].values()].filter(r=>Object.entries(q).every(([k,v])=>r[k]===v))})});
 return {collection:col,stores};}
const progress=(applied,extra={})=>async()=>({appliedToday:applied,responseEmailsToday:2,interviewEmailsToday:1,reviewCount:3,days:[{day:'2026-10-24',applied:22},{day:'2026-10-25',applied:20},{day:'2026-10-26',applied:25}],...extra});

test('New York time parts and ring tiers',()=>{
 assert.deepEqual(nyParts(at('2026-10-27T03:00:00Z')),{day:'2026-10-26',hour:23,minute:0,weekday:'Mon'});
 assert.equal(nyParts(at('2026-01-15T13:30:00Z')).hour,8,'winter time is UTC-5');
 assert.deepEqual([0,19,20,39,40,79,80,500].map(n=>tierOf(n,20)),[0,0,1,1,2,2,3,3]);
 assert.equal(tierOf(5,0),3,'a zero goal never divides by zero');});

test('streak: through yesterday, or including today once it has met the goal',()=>{
 const days=[{day:'2026-10-24',applied:22},{day:'2026-10-25',applied:20},{day:'2026-10-26',applied:25}];
 assert.equal(streakOf(days,'2026-10-27',20,0,{includeToday:false}),3);
 assert.equal(streakOf(days,'2026-10-27',20,5),3,'today not met yet: the run still counts through yesterday');
 assert.equal(streakOf(days,'2026-10-27',20,20),4);
 assert.equal(streakOf([{day:'2026-10-26',applied:3}],'2026-10-27',20,25),1);
 assert.equal(streakOf([],'2026-10-27',20,0),0);
 assert.equal(streakOf([],'2026-10-27',0,0),0,'a goal of 0 is treated as 1, so empty days never count');});

test('messages are warm, specific and carry no punctuation dashes or personal text',()=>{
 const ctx={day:'2026-10-27',applied:34,goal:20,streak:3,yesterday:25,replies:2,interviews:1,reviewCount:3};
 for(const kind of ['morning','m1','m2','m3','evening']){const m=buildMessage(kind,ctx);
  assert.ok(m.title.length>0&&m.title.length<=40,`${kind} title`);assert.ok(m.message.length<=240,`${kind} length`);
  assert.ok(!/[—–]|\s-\s/.test(m.title+m.message),`${kind} has no dash punctuation`);assert.match(m.click,/^https:\/\/apply\.atriveo\.com\//);}
 assert.equal(buildMessage('morning',{...ctx,streak:3}).title,'Day 4 starts now');
 assert.match(buildMessage('morning',{...ctx,streak:1}).message,/two days in a row/);
 assert.match(buildMessage('morning',{...ctx,streak:0,yesterday:4}).message,/Yesterday you applied to 4/);
 assert.match(buildMessage('m1',ctx).message,/green/);assert.match(buildMessage('m2',ctx).message,/red/);assert.match(buildMessage('m3',ctx).message,/gold/);
 assert.match(buildMessage('evening',ctx).message,/2 replies and 1 interview\./);
 assert.equal(buildMessage('evening',{...ctx,applied:5,replies:0,interviews:0}).title,'5 of 20 today');
 assert.ok(!/to review/.test(buildMessage('morning',{...ctx,reviewCount:0}).message));
 assert.throws(()=>buildMessage('nope',ctx));});

test('what is due when: morning from 8:30, milestones 7am to 11pm, evening 8pm to 11pm',()=>{
 const due=(h,m,applied,sent=[])=>dueKinds({now:ny(h,m),applied,goal:20,sent:new Set(sent)});
 assert.deepEqual(due(8,29,0).send,[]);assert.deepEqual(due(8,30,0).send,['morning']);assert.deepEqual(due(12,0,0).send,[],'a morning message at noon would be stale');
 assert.deepEqual(due(9,0,0,['morning']).send,[]);
 const M=['morning'];
 assert.deepEqual(due(10,0,20,M).send,['m1']);assert.deepEqual(due(10,0,45,M).send,['m2']);assert.deepEqual(due(10,0,45,M).silent,['m1'],'jumping past a tier records the lower ones without sending them');
 assert.deepEqual(due(10,0,85,M).send,['m3']);assert.deepEqual(due(10,0,21,['morning','m1']).send,[]);assert.deepEqual(due(10,0,40,['morning','m1']).send,['m2']);
 assert.deepEqual(due(10,0,20).send,['morning','m1'],'a first check mid-morning still sends the plan');
 assert.deepEqual(due(23,30,25,M).send,[],'no milestone pings at night');assert.deepEqual(due(6,0,25,M).send,[]);
 assert.deepEqual(due(20,0,5).send,['evening']);assert.deepEqual(due(23,0,5).send,[]);assert.deepEqual(due(21,0,5,['evening']).send,[]);});

test('a tick sends each message once per day, remembers it, and retries a failed send',async()=>{
 const db=fakeDb({goal:20}),sent=[];const publish=async m=>{sent.push(m.title);return true;};
 assert.deepEqual(await runPhoneTick({db,now:ny(8,31),publish,progress:progress(0)}),['morning']);
 assert.equal(sent[0],'Day 4 starts now');
 assert.deepEqual(await runPhoneTick({db,now:ny(8,32),publish,progress:progress(0)}),[],'not sent again');
 assert.deepEqual(await runPhoneTick({db,now:ny(11,0),publish,progress:progress(20)}),['m1']);
 assert.deepEqual(await runPhoneTick({db,now:ny(13,0),publish,progress:progress(41)}),['m2']);
 assert.deepEqual(await runPhoneTick({db,now:ny(20,5),publish,progress:progress(41)}),['evening']);
 assert.deepEqual(sent,['Day 4 starts now','Goal reached','Double the goal','41 applied today']);
 let fail=true;const flaky=async()=>{if(fail)throw new Error('ntfy down');return true;};const db2=fakeDb({goal:20});
 assert.deepEqual(await runPhoneTick({db:db2,now:ny(9,0),publish:flaky,progress:progress(0)}),[]);
 fail=false;assert.deepEqual(await runPhoneTick({db:db2,now:ny(9,1),publish:flaky,progress:progress(0)}),['morning'],'a failed send is tried again');});

test('two instances never both send: the claim is atomic',async()=>{
 const db=fakeDb({goal:20});let n=0;const publish=async()=>{n+=1;return true;};
 await Promise.all([runPhoneTick({db,now:ny(9,0),publish,progress:progress(0)}),runPhoneTick({db,now:ny(9,0),publish,progress:progress(0)})]);
 assert.equal(n,1);});

test('the goal is stored and read back, with a default and strict limits',async()=>{
 const db=fakeDb();assert.equal(await readGoal(db),15);assert.equal(await saveGoal(db,25),25);assert.equal(await readGoal(db),25);
 for(const bad of [0,201,1.5,'20',NaN,null])await assert.rejects(()=>saveGoal(db,bad),/whole number/);});

test('nothing runs without NTFY_TOPIC or when switched off',()=>{
 const keep={t:process.env.NTFY_TOPIC,o:process.env.PHONE_SUMMARIES};const lines=[];
 delete process.env.NTFY_TOPIC;assert.equal(startPhoneSummaries({withMongo:async()=>{},log:l=>lines.push(l)}),null);
 process.env.NTFY_TOPIC='t';process.env.PHONE_SUMMARIES='off';assert.equal(startPhoneSummaries({withMongo:async()=>{},log:l=>lines.push(l)}),null);
 for(const [k,v] of [['NTFY_TOPIC',keep.t],['PHONE_SUMMARIES',keep.o]])v===undefined?delete process.env[k]:process.env[k]=v;
 assert.equal(lines.length,2);});
