import test from 'node:test';import assert from 'node:assert/strict';
import {reminders,listReminders,snoozeReminder,phoneMessage,webMessage,channels,runNetworkTick,weeklyDigest} from '../scripts/network-reminders.mjs';

// Invented people; "today" is a New York day. History entries are in date order, as the store keeps them.
const P=(id,f={})=>({id,name:id,archived:false,sourceId:null,via:null,lastContact:null,nextFollowUp:null,history:[],...f});
const H=(type,at,id=type+at)=>({id,type,at:`${at}T15:00:00.000Z`,text:''});
const today='2026-10-28';
const NTFY={NTFY_TOPIC:'test-topic'};

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
 // Follow-ups are weekly by default: Kofi (met 3 weeks ago), Hana (a call 8 days ago) and Answered (an email a week ago) are due
 // without a date of their own, so nobody is merely "quiet" any more.
 assert.deepEqual(r.map(x=>[x.kind,x.personId??x.sourceId]),[['reply','Dana'],['due','Kofi'],['due','Marco'],['due','Hana'],['due','Priya'],['due','Answered'],['never','rs']]);
 assert.equal(r[0].title,'Dana replied 2 days ago');assert.equal(r[1].detail,'14 days late');assert.equal(r[2].detail,'3 days late');assert.equal(r[4].detail,'Due today');
 assert.equal(r[6].title,'2 people at Northwind have never heard from you');
 // Ann replied today (give it a day), Lena has a follow-up set for later, Ivy came through Dana.
 const mk=r.find(x=>x.personId==='Marco').key;
 const snoozed=reminders({people,sources},{today,snoozed:new Set([mk])});assert.ok(!snoozed.some(x=>x.personId==='Marco'));
 const moved=reminders({people:people.map(p=>p.id==='Marco'?{...p,nextFollowUp:'2026-10-27'}:p),sources},{today,snoozed:new Set([mk])});
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
 const {reminders:[r]}=await listReminders(db,{now});assert.equal(r.kind,'due','weekly by default: due a week after they were met');
 await snoozeReminder(db,{key:r.key,days:7},now);assert.equal((await listReminders(db,{now})).reminders.length,0);
 assert.equal((await listReminders(db,{now:new Date('2026-11-05T16:00:00Z')})).reminders.length,1,'back after a week');
 await assert.rejects(()=>snoozeReminder(db,{key:'x;drop',days:7}),/not known/);await assert.rejects(()=>snoozeReminder(db,{key:r.key,days:0}),/1 to 60/);});

test('phone: nothing before 9 a.m. New York; then one message a day, retried if it could not be sent; a quiet day is remembered silently',async()=>{
 const people=[P('Marco',{nextFollowUp:'2026-10-25'})];let sent=[];const publish=async m=>{sent.push(m);return true};
 const db=fakeDb(people);
 assert.equal(await runNetworkTick({env:NTFY,db,now:new Date('2026-10-28T12:30:00Z'),publish}),null,'8:30 in New York');
 let failing=true;const flaky=async m=>{sent.push(m);return !failing};
 assert.equal(await runNetworkTick({env:NTFY,db,now:new Date('2026-10-28T13:05:00Z'),publish:flaky}),null);
 failing=false;const m=await runNetworkTick({env:NTFY,db,now:new Date('2026-10-28T13:10:00Z'),publish:flaky});assert.match(m.ntfy.message,/1 follow-up due/);
 assert.equal(await runNetworkTick({env:NTFY,db,now:new Date('2026-10-28T20:00:00Z'),publish}),null,'once a day');assert.equal(sent.length,2);
 const calm=fakeDb([]);sent=[];assert.equal(await runNetworkTick({env:NTFY,db:calm,now:new Date('2026-10-28T14:00:00Z'),publish}),null);assert.equal(sent.length,0);
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
 const d=await weeklyDigest(db,sunday);assert.equal(d.message,'2 emails, 1 reply, 1 new person. 2 things wait for you.','Dana, and Old: never contacted, so a weekly follow-up is due');assert.ok(!/Dana/.test(JSON.stringify(d)));
 const sent=[];const publish=async m=>{sent.push(m);return true};
 await runNetworkTick({env:NTFY,db,now:new Date('2026-11-01T21:00:00Z'),publish});assert.ok(!sent.some(m=>m.title==='Your week in Network'),'not before 6 p.m.');
 await runNetworkTick({env:NTFY,db,now:sunday,publish});await runNetworkTick({env:NTFY,db,now:new Date('2026-11-02T00:30:00Z'),publish});
 assert.equal(sent.filter(m=>m.title==='Your week in Network').length,1,'once that Sunday');
 assert.equal(await weeklyDigest(fakeDb([]),sunday),null);});

test('channels: Web Push when it is set up, else ntfy; NETWORK_PUSH=both or ntfy; nothing when neither',()=>{
 const WEB={VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'k',VAPID_SUBJECT:'mailto:x@example.test',PUSH_EVENT_USER_ID:'me@example.test'};
 assert.deepEqual(channels({...WEB,...NTFY}),{web:true,ntfy:false},'no doubles on the phone');
 assert.deepEqual(channels({...WEB,...NTFY,NETWORK_PUSH:'both'}),{web:true,ntfy:true});
 assert.deepEqual(channels({...WEB,...NTFY,NETWORK_PUSH:'ntfy'}),{web:false,ntfy:true});
 assert.deepEqual(channels(NTFY),{web:false,ntfy:true});assert.deepEqual(channels({...WEB,PUSH_EVENT_USER_ID:' '}),{web:false,ntfy:false});});

test('web push: names and a link that opens the right place; one item opens that person, several open the follow-up list',()=>{
 assert.equal(webMessage([{kind:'never',title:'3 people at X have never heard from you'}]),null);
 assert.deepEqual(webMessage([{kind:'due',personId:'p 1',title:'Follow up with Dana',detail:'Due today'}]),{title:'Follow up with Dana',body:'Due today',url:'/network?person=p%201',type:'network'});
 assert.deepEqual(webMessage([{kind:'work',workId:'w1',title:'Docs ends in 2 days',detail:'Next: PR'}]).url,'/network?work=w1');
 const many=webMessage(['A','B','C','D','E'].map(n=>({kind:'due',personId:n,title:`Follow up with ${n}`,detail:''})));
 assert.equal(many.title,'5 things need you in Network');assert.equal(many.body,'Follow up with A · Follow up with B · Follow up with C · and 2 more');assert.equal(many.url,'/network?view=due');});

test('web push delivery: sent once a day through your devices; retried when every device failed; no devices is not an error',async()=>{
 const WEB={VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'k',VAPID_SUBJECT:'mailto:x@example.test',PUSH_EVENT_USER_ID:'Me@Example.test'};
 const db=fakeDb([P('Marco',{nextFollowUp:'2026-10-25'})]);const got=[];let result={sent:0,failed:2};
 const webPush=async(_d,m)=>{got.push(m);return result};const publish=async()=>{throw new Error('ntfy must not be used')};
 assert.equal(await runNetworkTick({db,env:WEB,webPush,publish,now:new Date('2026-10-28T13:05:00Z')}),null,'every device failed: try again');
 result={sent:1,failed:1};const m=await runNetworkTick({db,env:WEB,webPush,publish,now:new Date('2026-10-28T13:10:00Z')});
 assert.equal(m.web.title,'Follow up with Marco');assert.equal(m.web.url,'/network?person=Marco');
 await runNetworkTick({db,env:WEB,webPush,publish,now:new Date('2026-10-28T15:00:00Z')});assert.equal(got.length,2,'once that day');
 const none=fakeDb([P('Ann',{nextFollowUp:'2026-10-25'})]);assert.ok(await runNetworkTick({db:none,env:WEB,webPush:async()=>({sent:0,failed:0}),now:new Date('2026-10-28T13:10:00Z')}));
 assert.equal(await runNetworkTick({db:fakeDb([P('Z',{nextFollowUp:'2026-10-25'})]),env:{},now:new Date('2026-10-28T13:10:00Z')}),null,'no channel, nothing to do');});


test('paused follow-ups stay quiet and planned contacts do not receive early never-contacted reminders',()=>{
 const sources=[{id:'source',name:'Northstar',createdAt:'2026-10-01T00:00:00Z'}];
 const people=[P('paused',{sourceId:'source',lastContact:'2026-10-01T12:00:00Z',followUpPlan:{enabled:false}}),P('not-needed',{sourceId:'source',followUpPlan:{enabled:false}}),P('scheduled',{sourceId:'source',nextFollowUp:'2026-11-04',followUpPlan:{enabled:true}})];
 assert.deepEqual(reminders({people,sources},{today}),[]);
 const due=reminders({people,sources},{today:'2026-11-04'});assert.deepEqual(due.map(r=>[r.kind,r.personId]),[['due','scheduled']]);
 const replied=reminders({people:[{...people[0],history:[H('reply','2026-10-25')]}],sources:[]},{today});
 assert.equal(replied[0].kind,'reply','pausing follow-ups does not hide an incoming reply');
});

test('follow-ups by default: weekly for everyone but family, 3 days for a LinkedIn reach-out, never over a date you set or a follow-up switched off',()=>{
 const sources=[{id:'fam',name:'Kasliwal',type:'family'},{id:'li',name:'LinkedIn',type:'linkedin'},{id:'d28',name:'Oct 28, 2026',type:'day',parentSourceId:'li'},{id:'old',name:'Linkedin Reach out',type:'other'},{id:'rs',name:'Randstad',type:'company'}];
 const at='2026-10-20T15:00:00.000Z',base={createdAt:at};
 const r=reminders({people:[P('Aunt',{...base,sourceId:'fam'}),P('Recruiter',{...base,sourceId:'rs'}),P('Reached',{...base,sourceId:'d28'}),P('Legacy',{...base,sourceId:'old'}),
  P('Called',{...base,sourceId:'d28',lastContact:'2026-10-24T15:00:00.000Z'}),P('Set',{...base,sourceId:'rs',nextFollowUp:'2026-11-02'}),P('Off',{...base,sourceId:'rs',followUpPlan:{enabled:false}}),P('Loose',base)],sources},{today:'2026-10-27'});
 const due=Object.fromEntries(r.filter(x=>x.kind==='due').map(x=>[x.personId,x.detail]));
 assert.deepEqual(due,{Recruiter:'Due today',Reached:'4 days late',Legacy:'4 days late',Loose:'Due today'},'a source named Linkedin… counts as LinkedIn too; '+'family, a later date of your own, a switched-off follow-up and a recent contact are not due');
 assert.deepEqual(reminders({people:[P('Called',{...base,sourceId:'d28',lastContact:'2026-10-24T15:00:00.000Z'})],sources},{today:'2026-10-31'}).map(x=>x.detail),['Due today'],'after a contact, a week from it');
});
