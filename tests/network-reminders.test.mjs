import test from 'node:test';import assert from 'node:assert/strict';
import {reminders,listReminders,snoozeReminder,phoneMessage,runNetworkTick,weeklyDigest} from '../scripts/network-reminders.mjs';

// Invented people; "today" is a New York day. History entries are in date order, as the store keeps them.
const P=(id,f={})=>({id,name:id,archived:false,sourceId:null,via:null,lastContact:null,nextFollowUp:null,history:[],...f});
const H=(type,at,id=type+at)=>({id,type,at:`${at}T15:00:00.000Z`,text:''});
const today='2026-10-28';

test('who needs you: a reply waiting, follow-ups due or late, people gone quiet, sources nobody has written to; most urgent first',()=>{
 const people=[
  P('Dana',{history:[H('message','2026-10-17'),H('reply','2026-10-26')],lastContact:'2026-10-17T15:00:00.000Z',nextFollowUp:'2026-10-20'}),
  P('Marco',{nextFollowUp:'2026-10-25',lastContact:'2026-10-01T15:00:00.000Z',history:[H('email','2026-10-01')]}),
  P('Priya',{nextFollowUp:today,lastContact:'2026-10-26T15:00:00.000Z',history:[H('email','2026-10-26')]}),
  P('Kofi',{lastContact:'2026-10-07T15:00:00.000Z',history:[H('met','2026-10-07')]}),
  P('Hana',{lastContact:'2026-10-20T15:00:00.000Z',history:[H('call','2026-10-20')]}),
  P('Lena',{lastContact:'2026-09-01T15:00:00.000Z',nextFollowUp:'2026-11-10',history:[H('call','2026-09-01')]}),
  P('Sam',{sourceId:'rs'}),P('Tobi',{sourceId:'rs'}),P('Ivy',{sourceId:'rs',via:'Dana'}),P('Old',{sourceId:'rs',archived:true}),
  P('Ann',{history:[H('reply','2026-10-28')]}),
  P('Answered',{history:[H('reply','2026-10-20'),H('email','2026-10-21')],lastContact:'2026-10-21T15:00:00.000Z'}),
 ];
 const sources=[{id:'rs',name:'Northwind',createdAt:'2026-10-01T00:00:00Z'},{id:'new',name:'Fresh',createdAt:'2026-10-28T00:00:00Z'}];
 const r=reminders({people,sources},{today});
 assert.deepEqual(r.map(x=>[x.kind,x.personId??x.sourceId]),[['reply','Dana'],['due','Marco'],['due','Priya'],['quiet','Kofi'],['never','rs']]);
 assert.equal(r[0].title,'Dana replied 2 days ago');assert.equal(r[1].detail,'3 days late');assert.equal(r[2].detail,'Due today');
 assert.equal(r[3].title,'It has been 3 weeks since you reached out to Kofi');assert.equal(r[4].title,'2 people at Northwind have never heard from you');
 // Ann replied today (give it a day), Answered already got an answer, Hana is only 8 days quiet, Lena has a follow-up set, Ivy came through Dana.
 const snoozed=reminders({people,sources},{today,snoozed:new Set([r[1].key])});assert.ok(!snoozed.some(x=>x.personId==='Marco'));
 const moved=reminders({people:people.map(p=>p.id==='Marco'?{...p,nextFollowUp:'2026-10-27'}:p),sources},{today,snoozed:new Set([r[1].key])});
 assert.ok(moved.some(x=>x.personId==='Marco'),'a new follow-up date is a new reminder, even if the old one was snoozed');});

test('the phone message has counts only, never a name, and nothing at all when nothing needs you',()=>{
 const m=phoneMessage([{kind:'reply',title:'Dana replied'},{kind:'due'},{kind:'due'},{kind:'quiet'},{kind:'never'}]);
 assert.equal(m.message,'1 waiting for your answer, 2 follow-ups due, 1 person gone quiet. A two-line note keeps the door open.');
 assert.ok(!/Dana/.test(JSON.stringify(m)));assert.equal(m.click,'https://apply.atriveo.com/network');
 assert.equal(phoneMessage([{kind:'never'}]),null,'only "never contacted" waits for the page');assert.equal(phoneMessage([]),null);});

const fakeDb=(people=[],sources=[])=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);return{
 find:()=>({toArray:async()=>[...m.values()].map(d=>structuredClone(d))}),findOne:async q=>m.has(q._id)?structuredClone(m.get(q._id)):null,
 insertOne:async d=>{if(m.has(d._id)){const e=new Error('dup');e.code=11000;throw e}m.set(d._id,structuredClone(d))},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0}),
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...u.$set});else if(o?.upsert)m.set(q._id,{_id:q._id,...u.$set})}}};
 for(const p of people){const {id,...d}=p;col('network_people').insertOne({_id:id,...d})}for(const s of sources){const {id,...d}=s;col('network_sources').insertOne({_id:id,...d})}return{collection:col}};

test('snooze hides one reminder for a while; bad keys and lengths are refused',async()=>{
 const db=fakeDb([P('Kofi',{lastContact:'2026-10-01T15:00:00.000Z',history:[H('met','2026-10-01')]})]);const now=new Date('2026-10-28T16:00:00Z');
 const {reminders:[r]}=await listReminders(db,{now});assert.equal(r.kind,'quiet');
 await snoozeReminder(db,{key:r.key,days:7},now);assert.equal((await listReminders(db,{now})).reminders.length,0);
 assert.equal((await listReminders(db,{now:new Date('2026-11-05T16:00:00Z')})).reminders.length,1,'back after a week');
 await assert.rejects(()=>snoozeReminder(db,{key:'x;drop',days:7}),/not known/);await assert.rejects(()=>snoozeReminder(db,{key:r.key,days:0}),/1 to 60/);});

test('phone: nothing before 9 a.m. New York; then one message a day, retried if it could not be sent; a quiet day is remembered silently',async()=>{
 const people=[P('Marco',{nextFollowUp:'2026-10-25'})];let sent=[];const publish=async m=>{sent.push(m);return true};
 const db=fakeDb(people);
 assert.equal(await runNetworkTick({db,now:new Date('2026-10-28T12:30:00Z'),publish}),null,'8:30 in New York');
 let failing=true;const flaky=async m=>{sent.push(m);return !failing};
 assert.equal(await runNetworkTick({db,now:new Date('2026-10-28T13:05:00Z'),publish:flaky}),null);
 failing=false;const m=await runNetworkTick({db,now:new Date('2026-10-28T13:10:00Z'),publish:flaky});assert.match(m.message,/1 follow-up due/);
 assert.equal(await runNetworkTick({db,now:new Date('2026-10-28T20:00:00Z'),publish}),null,'once a day');assert.equal(sent.length,2);
 const calm=fakeDb([]);sent=[];assert.equal(await runNetworkTick({db:calm,now:new Date('2026-10-28T14:00:00Z'),publish}),null);assert.equal(sent.length,0);
 assert.ok(await calm.collection('phone_notices').findOne({_id:'2026-10-28:network'}),'remembered so it is not recounted every few minutes');});

test('work items: a week before the end, on the day, and when it has run over; done work is quiet',()=>{
 const work=[{id:'w1',title:'Docs contribution',end:'2026-11-03',next:'Open the pull request'},{id:'w2',title:'Resume review',end:'2026-10-28'},{id:'w3',title:'Mock interview',end:'2026-10-20'},{id:'w4',title:'Far',end:'2026-12-20'},{id:'w5',title:'Done',end:'2026-10-27',done:true}];
 const r=reminders({people:[],sources:[],work},{today});
 assert.deepEqual(r.map(x=>x.title),['Mock interview is 8 days past its end','Resume review ends today','Docs contribution ends in 6 days']);
 assert.equal(r[2].detail,'Next: Open the pull request');assert.equal(r[0].workId,'w3');
 assert.match(phoneMessage(r).message,/^3 pieces of work ending\./);});

test('weekly digest: Sunday from 6 p.m. New York, counts only, once a week, nothing on an empty week',async()=>{
 const db=fakeDb([P('Dana',{createdAt:'2026-10-27T10:00:00.000Z',history:[H('reply','2026-10-30')],nextFollowUp:'2026-10-30'}),P('Old',{createdAt:'2026-09-01T10:00:00.000Z'})]);
 await db.collection('network_mail_log').insertOne({_id:'m1',state:'sent',at:'2026-10-29T15:00:00.000Z'});await db.collection('network_mail_log').insertOne({_id:'m2',state:'uncertain',at:'2026-10-30T15:00:00.000Z'});
 await db.collection('network_mail_log').insertOne({_id:'m3',state:'sent',at:'2026-10-01T15:00:00.000Z'});
 const sunday=new Date('2026-11-01T23:30:00Z');// 6:30 p.m. in New York, Sunday Nov 1
 const d=await weeklyDigest(db,sunday);assert.equal(d.message,'2 emails, 1 reply, 1 new person. 1 thing waits for you.');assert.ok(!/Dana/.test(JSON.stringify(d)));
 const sent=[];const publish=async m=>{sent.push(m);return true};
 await runNetworkTick({db,now:new Date('2026-11-01T21:00:00Z'),publish});assert.ok(!sent.some(m=>m.title==='Your week in Network'),'not before 6 p.m.');
 await runNetworkTick({db,now:sunday,publish});await runNetworkTick({db,now:new Date('2026-11-02T00:30:00Z'),publish});
 assert.equal(sent.filter(m=>m.title==='Your week in Network').length,1,'once that Sunday');
 assert.equal(await weeklyDigest(fakeDb([]),sunday),null);});
