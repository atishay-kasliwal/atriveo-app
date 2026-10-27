import test from 'node:test';import assert from 'node:assert/strict';
import {stateOf,when,listAssessments,updateAssessment,assessmentLines} from '../scripts/assessments.mjs';
import {buildMessage,dueKinds,runPhoneTick} from '../scripts/phone-summary.mjs';

// Tuesday Oct 27 2026, 9:30 AM New York (UTC-4).
const NOW=Date.parse('2026-10-27T13:30:00Z');
const ny=(iso)=>new Date(iso).toISOString();
const doc=(id,company,deadline,extra={})=>({_id:id,company,subject:`${company} assessment`,receivedAt:'2026-10-26T15:00:00.000Z',deadlineAt:deadline?ny(deadline):null,deadlineText:deadline?'by then':null,deadlineSource:deadline?'mail':null,status:'open',...extra});
function fakeDb(docs){const col={find:q=>({project:()=>({toArray:async()=>docs.filter(d=>!q.status||d.status===q.status)})}),
 updateOne:async(q,u)=>{const d=docs.find(x=>x._id===q._id);if(!d)return {matchedCount:0};Object.assign(d,u.$set);return {matchedCount:1};}};
 return {collection:()=>col,docs};}

test('state and wording are by New York day',()=>{
 assert.equal(stateOf(null,NOW),'unknown');
 assert.equal(stateOf('2026-10-27T10:00:00Z',NOW),'overdue');
 assert.equal(stateOf('2026-10-28T03:59:00Z',NOW),'today','11:59 PM tonight in New York');
 assert.equal(stateOf('2026-10-29T20:00:00Z',NOW),'soon');
 assert.equal(stateOf('2026-11-05T20:00:00Z',NOW),'later');
 assert.equal(when('2026-10-28T03:59:00Z',NOW),'today at 11:59 PM');
 assert.equal(when('2026-10-29T03:59:00Z',NOW),'tomorrow at 11:59 PM');
 assert.equal(when('2026-10-30T20:00:00Z',NOW),'in 3 days');
 assert.equal(when('2026-10-26T20:00:00Z',NOW),'yesterday at 4:00 PM');
 assert.equal(when(null,NOW),'no deadline yet');});

test('the list puts undated ones first, then by deadline, drops done ones and closes overdue ones after a day',async()=>{
 const db=fakeDb([doc('c1xxxx','Parallel',  '2026-10-30T03:59:00Z'),doc('c2xxxx','Roblox','2026-10-28T03:59:00Z'),doc('c3xxxx','C-SMART',null),doc('c4xxxx','Old','2026-10-25T03:59:00Z'),doc('c5xxxx','Gone','2026-10-29T03:59:00Z',{status:'done'}),doc('c6xxxx','Late','2026-10-27T01:00:00Z')]);
 const rows=await listAssessments(db,{now:NOW});
 assert.deepEqual(rows.map(r=>r.company),['C-SMART','Late','Roblox','Parallel']);
 assert.deepEqual(rows.map(r=>r.state),['unknown','overdue','today','soon']);});

test('you can add a deadline or finish one, and nothing else can change',async()=>{
 const db=fakeDb([doc('c3xxxx','C-SMART',null)]);
 await updateAssessment(db,{id:'c3xxxx',deadlineAt:'2026-10-30T23:59:00-04:00',now:NOW});
 assert.equal(db.docs[0].deadlineAt,'2026-10-31T03:59:00.000Z');assert.equal(db.docs[0].deadlineSource,'you');
 await updateAssessment(db,{id:'c3xxxx',status:'done',now:NOW});assert.equal(db.docs[0].status,'done');
 for(const bad of [{id:'x'},{id:'c3xxxx'},{id:'c3xxxx',status:'gone'},{id:'c3xxxx',deadlineAt:'soon'},{id:'c3xxxx',deadlineAt:'2031-01-01T00:00:00Z'},{id:'nope-nope-nope'}])await assert.rejects(()=>updateAssessment(db,{...bad,now:NOW}));});

test('phone: a 9 a.m. list when something is due, a 3 p.m. reminder for today, undated ones only Mon, Wed and Fri',()=>{
 const rows=(...a)=>a;const mk=(c,d)=>({company:c,deadlineAt:d,state:stateOf(d,NOW)});
 const at=(h,day='2026-10-27')=>new Date(Date.parse(`${day}T00:00:00Z`)+(h+4)*3600000);
 const due=(h,assess,day,sent=[])=>dueKinds({now:at(h,day),applied:0,goal:20,sent:new Set(['morning',...sent]),assessments:assess});
 const dated=rows(mk('Roblox','2026-10-28T03:59:00Z'));
 assert.deepEqual(due(8,dated).send,[]);assert.deepEqual(due(9,dated).send,['assess_am']);assert.deepEqual(due(9,dated,undefined,['assess_am']).send,[]);
 assert.deepEqual(due(15,dated).send,['assess_pm'],'the morning list is not sent after noon, only the reminder');assert.deepEqual(due(15,dated,undefined,['assess_am']).send,['assess_pm']);assert.deepEqual(due(19,dated).send,[],'no reminders in the evening');
 assert.deepEqual(due(15,rows(mk('Parallel','2026-10-30T03:59:00Z')),undefined,['assess_am']).send,[],'nothing due today: no reminder');
 const undated=rows(mk('C-SMART',null));
 assert.deepEqual(due(9,undated,'2026-10-27').send,[],'Tuesday: undated only, stay quiet');assert.deepEqual(due(9,undated,'2026-10-26').send,['assess_am'],'Monday');
 assert.deepEqual(due(9,rows(mk('Later','2026-11-20T03:59:00Z'))).send,[],'far away: not yet');});

test('phone messages: names and deadlines, undated nudge, short enough, no dash punctuation',()=>{
 const mk=(c,d)=>({company:c,deadlineAt:d,state:stateOf(d,NOW),when:when(d,NOW)});
 const rows=[mk('C-SMART',null),mk('Roblox','2026-10-28T03:59:00Z'),mk('Parallel Systems','2026-10-30T20:00:00Z')];
 const a=assessmentLines(rows,NOW);
 const am=buildMessage('assess_am',{day:'2026-10-27',assessments:a});
 assert.equal(am.title,'3 assessments to finish');assert.match(am.message,/Roblox is due today at 11:59 PM\./);assert.match(am.message,/Parallel Systems is due in 3 days\./);assert.match(am.message,/1 assessment has no deadline yet\. Add it in Atriveo\./);assert.match(am.message,/You have got this\.$/);
 assert.equal(am.priority,4,'something is due today');assert.equal(am.click,'https://apply.atriveo.com/assessments');
 assert.ok(am.message.length<=240&&!/[—–]|\s-\s/.test(am.title+am.message));
 const pm=buildMessage('assess_pm',{day:'2026-10-27',assessments:a});assert.equal(pm.title,'Due today');assert.match(pm.message,/^Roblox is due today\. Finish it and take the win\.$/);
 const many=assessmentLines(Array.from({length:6},(_,i)=>mk(`Company ${i}`,'2026-10-30T20:00:00Z')),NOW);
 const big=buildMessage('assess_am',{day:'2026-10-27',assessments:many});assert.match(big.message,/And 3 more\./);assert.ok(big.message.length<=240);
 const late=buildMessage('assess_am',{day:'2026-10-27',assessments:assessmentLines([mk('Roblox','2026-10-26T20:00:00Z')],NOW)});assert.match(late.message,/Roblox was due yesterday at 4:00 PM\./);});

test('a tick sends the assessment list once and survives a missing collection',async()=>{
 const sent=[];const publish=async m=>{sent.push(m.title);return true;};
 const stores=new Map();const db={collection:n=>({findOne:async()=>({goal:20}),find:q=>({toArray:async()=>[...stores.values()].filter(r=>Object.entries(q).every(([k,v])=>r[k]===v))}),insertOne:async d=>{if(stores.has(d._id)){const e=new Error('dup');e.code=11000;throw e;}stores.set(d._id,d);},deleteOne:async q=>{stores.delete(q._id);}})};
 const rows=[{company:'Roblox',deadlineAt:'2026-10-28T03:59:00Z',state:'today',when:'today at 11:59 PM'}];
 const progress=async()=>({appliedToday:0,days:[]});
 const t=new Date(NOW);
 assert.deepEqual(await runPhoneTick({db,now:t,publish,progress,assessments:async()=>rows}),['morning','assess_am']);
 assert.deepEqual(await runPhoneTick({db,now:new Date(NOW+60000),publish,progress,assessments:async()=>rows}),[]);
 const db2={...db};stores.clear();
 assert.deepEqual(await runPhoneTick({db:db2,now:t,publish,progress,assessments:async()=>{throw new Error('no collection');}}),['morning'],'assessments failing never blocks the other messages');});
