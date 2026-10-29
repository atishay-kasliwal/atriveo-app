import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { buildIntelligence, listIntelligence, intelligenceAction } from '../scripts/network-intelligence.mjs';
const {MongoMemoryServer}=createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(),'playatriveo'),'package.json'))('mongodb-memory-server');
const now=new Date('2026-10-29T16:00:00Z');
const p=(id,extra={})=>({id,name:id,sourceId:'amazon',company:'Amazon',createdAt:'2026-10-27T15:00:00Z',lastContact:null,nextFollowUp:null,history:[],...extra});
const source={id:'amazon',name:'Amazon',type:'company',createdAt:'2026-10-25T15:00:00Z'};
const job=(url,extra={})=>({url,applyUrl:url,title:'Engineer',company:'Amazon',status:'new',foundAt:now.toISOString(),...extra});

test('company opportunities use real counts, prefer a first connection and ignore passed jobs',()=>{
 const people=[p('introduced',{via:'direct'}),p('direct')],groups=[{company:'Amazon',people, jobs:[job('a'),job('b',{status:'ready'}),job('c',{status:'passed'})]}];
 const items=buildIntelligence({people,sources:[source],groups},{now});const opportunity=items.find(i=>i.kind==='opportunity');
 assert.equal(opportunity.jobs.length,2);assert.equal(opportunity.personId,'direct');assert.equal(opportunity.relationship,'First connection');assert.equal(opportunity.stage,'discovered');
 assert.match(opportunity.detail,/2 open roles/);assert.doesNotMatch(opportunity.detail,/match|high impact/i);
 const next=buildIntelligence({people,sources:[source],groups:[{...groups[0],jobs:[job('new')]}]},{now}).find(i=>i.kind==='opportunity');assert.notEqual(next.key,opportunity.key);
 const reordered=buildIntelligence({people:people.map(p=>({...p,lastContact:p.id==='introduced'?now.toISOString():null,via:null})),sources:[source],groups},{now}).find(i=>i.kind==='opportunity');assert.equal(reordered.key,opportunity.key,'changing the suggested connection preserves dismissal identity');
});
test('surfaces replies immediately and follow-ups before they become notifications, with no duplicate due person',()=>{
 const people=[p('reply',{history:[{id:'r',type:'reply',at:now.toISOString()}]}),p('soon',{nextFollowUp:'2026-11-01'}),p('due',{nextFollowUp:'2026-10-29'}),p('archived',{archived:true})];
 const reminders=[{key:'due:due:2026-10-29',kind:'due',personId:'due',title:'Follow up with due',detail:'Due today'}];
 const items=buildIntelligence({people,sources:[source],reminders},{now});
 assert.equal(items.filter(i=>i.personId==='due').length,1);assert.equal(items.find(i=>i.personId==='soon').stage,'discovered');assert.equal(items.find(i=>i.kind==='reply').stage,'actionable');assert.ok(!items.some(i=>i.personId==='archived'));
});
test('application prompts disappear after actual contact and upcoming work is grounded in dates',()=>{
 const applied=job('a',{status:'applied',appliedAt:'2026-10-28T12:00:00Z'}),person=p('direct');
 const make=people=>buildIntelligence({people,sources:[source],groups:[{company:'Amazon',people,jobs:[applied]}],work:[{id:'meeting',title:'Prepare with Danny',start:'2026-11-02',people:['direct']}]},{now});
 assert.equal(make([person]).find(i=>i.kind==='application').stage,'urgent');assert.equal(make([person]).find(i=>i.kind==='upcoming').workId,'meeting');
 assert.ok(!make([{...person,history:[{type:'message',at:now.toISOString()}]}]).some(i=>i.kind==='application'));
});
test('persistent dock state, aging, dismissal, New York snooze and completed follow-up',async t=>{
 const mongod=await MongoMemoryServer.create(),client=new MongoClient(mongod.getUri());await client.connect();t.after(async()=>{await client.close();await mongod.stop();});const db=client.db('intelligence');
 const person=p('ankit',{nextFollowUp:'2026-10-29'});await db.collection('network_people').insertOne({...person,_id:'ankit'});
 await db.collection('network_sources').insertOne({...source,_id:'amazon'});
 await db.collection('jobs').insertOne({job_url:'https://example.com/role',company:'Amazon',title:'Engineer',run_at:now});
 let feed=await listIntelligence(db,{now});const opportunity=feed.items.find(i=>i.kind==='opportunity'),due=feed.items.find(i=>i.key.startsWith('due:'));assert.ok(opportunity);assert.ok(due);
 await intelligenceAction(db,{action:'preference',expanded:true},now);assert.equal((await listIntelligence(db,{now})).expanded,true);
 assert.equal((await listIntelligence(db,{now:new Date(+now+2*86400000)})).items.find(i=>i.key===opportunity.key).stage,'actionable');
 await intelligenceAction(db,{action:'review',key:opportunity.key},now);assert.equal((await listIntelligence(db,{now:new Date(+now+2*86400000)})).items.find(i=>i.key===opportunity.key).stage,'discovered');
 await intelligenceAction(db,{action:'snooze',key:opportunity.key,until:'2026-10-30'},now);
 assert.ok(!(await listIntelligence(db,{now:new Date('2026-10-30T03:59:00Z')})).items.some(i=>i.key===opportunity.key));
 assert.ok((await listIntelligence(db,{now:new Date('2026-10-30T04:00:00Z')})).items.some(i=>i.key===opportunity.key));
 await assert.rejects(intelligenceAction(db,{action:'snooze',key:due.key,until:'2026-02-30'},now),/date/);
 const completed=await intelligenceAction(db,{action:'contacted',key:due.key},now);assert.equal(completed.person.lastContact,now.toISOString());assert.equal(completed.person.nextFollowUp,'2026-11-05');assert.equal(completed.person.history.at(-1).followUp.completed,true);
 await intelligenceAction(db,{action:'dismiss',key:opportunity.key},now);feed=await listIntelligence(db,{now});assert.ok(!feed.items.some(i=>i.key===opportunity.key||i.key===due.key));
 await assert.rejects(intelligenceAction(db,{action:'dismiss',key:'unknown'},now),/Refresh/);
});

test('assessments count down 6, 5, 4 and 2 New York calendar days, including the DST change',()=>{
 const assessment={id:'assess01',company:'Amazon',subject:'Online assessment',deadlineAt:'2026-11-04T17:00:00Z'};
 const at=iso=>buildIntelligence({people:[p('ankit')],sources:[source],assessments:[assessment]},{now:new Date(iso)}).find(i=>i.kind==='assessment');
 for(const[iso,days,stage]of [['2026-10-29T14:00:00Z',6,'discovered'],['2026-10-30T14:00:00Z',5,'discovered'],['2026-10-31T14:00:00Z',4,'actionable'],['2026-11-02T15:00:00Z',2,'urgent']]){
  const item=at(iso);assert.equal(item.daysLeft,days);assert.match(item.detail,new RegExp(`${days} days left`));assert.equal(item.stage,stage);assert.equal(item.personId,'ankit');assert.match(item.deadlineLabel,/12:00 PM EST/);
 }
 const due=at('2026-11-04T16:00:00Z');assert.equal(due.detail,'Complete today before 12:00 PM EST.');assert.equal(due.stage,'urgent');assert.equal(due.key,at('2026-10-29T14:00:00Z').key,'same assessment updates in place instead of adding daily cards');
 const passed=at('2026-11-04T17:00:01Z');assert.match(passed.detail,/Deadline passed/);assert.doesNotMatch(passed.detail,/Complete today/);
 assert.equal(at('2026-11-05T18:00:00Z'),undefined,'matches the existing assessment expiry window');
});
test('assessments appear with no network connection, never invent deadlines, and rank due today above opportunities',()=>{
 const items=buildIntelligence({people:[],sources:[],assessments:[{id:'assess01',company:'Unknown Deadline',deadlineAt:null},{id:'assess02',company:'Due Now',deadlineAt:'2026-10-29T18:00:00Z'},{id:'assess03',company:'Done',deadlineAt:'2026-10-29T18:00:00Z',status:'done'}]},{now});
 assert.equal(items[0].assessmentId,'assess02');assert.equal(items[0].people.length,0);assert.match(items[1].detail,/No deadline/);assert.equal(items[1].deadlineLabel,null);assert.ok(!items.some(i=>i.assessmentId==='assess03'));
});
test('assessment completion updates its real record; snoozes cannot skip its deadline and deadline changes resurface',async t=>{
 const mongod=await MongoMemoryServer.create(),client=new MongoClient(mongod.getUri());await client.connect();t.after(async()=>{await client.close();await mongod.stop();});const db=client.db('assessment_intelligence');
 await db.collection('assessments').insertMany([{_id:'assess01',company:'Amazon',status:'open',receivedAt:now.toISOString(),deadlineAt:'2026-11-04T17:00:00Z'},{_id:'assess02',company:'Finished',status:'done',deadlineAt:'2026-11-04T17:00:00Z'}]);
 const item=(await listIntelligence(db,{now})).items.find(i=>i.kind==='assessment');assert.equal(item.assessmentId,'assess01');
 await assert.rejects(intelligenceAction(db,{action:'snooze',key:item.key,until:'2026-11-05'},now),/on or before/);
 await intelligenceAction(db,{action:'snooze',key:item.key,until:'2026-11-04'},now);assert.equal((await listIntelligence(db,{now})).items.length,0);
 assert.equal((await listIntelligence(db,{now:new Date('2026-11-04T05:00:00Z')})).items[0].stage,'urgent');
 await intelligenceAction(db,{action:'dismiss',key:item.key},now);assert.equal((await listIntelligence(db,{now})).items.length,0);
 await db.collection('assessments').updateOne({_id:'assess01'},{$set:{deadlineAt:'2026-11-05T17:00:00Z'}});
 const changed=(await listIntelligence(db,{now})).items[0];assert.notEqual(changed.key,item.key);
 await intelligenceAction(db,{action:'assessment_done',key:changed.key},now);assert.equal((await db.collection('assessments').findOne({_id:'assess01'})).status,'done');assert.equal((await listIntelligence(db,{now})).items.length,0);
});
