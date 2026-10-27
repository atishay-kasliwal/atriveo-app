import test from 'node:test';import assert from 'node:assert/strict';
import {buildAppliedRows,companyKey,appliedHistory} from '../scripts/applied-history.mjs';

const applications=[{_id:'app1',company:'Databricks, Inc.',title:'Forward Deployed Engineer',jobUrls:['https://www.linkedin.com/jobs/view/1'],lifecycle:{appliedAt:'2026-10-20T15:00:00Z'},submission:{by:'extension'},outcome:{status:'confirmed',confirmedAt:'2026-10-20T15:05:00Z'}}];
const swipes=[
 {job_url:'https://www.linkedin.com/jobs/view/1',direction:'applied',applied_at:'2026-10-20T15:01:00Z'},
 {job_url:'https://www.linkedin.com/jobs/view/2',direction:'applied',applied_at:'2026-10-24T12:00:00Z'},
 {job_url:'https://www.linkedin.com/jobs/view/2',direction:'applied',applied_at:'2026-10-24T13:00:00Z'},
 {job_url:'https://www.linkedin.com/jobs/view/3',direction:'left',swiped_at:'2026-10-24T12:00:00Z'}];
const jobs=[{job_url:'https://www.linkedin.com/jobs/view/2',company:'IBM',title:'AI Engineer',location:'New York, NY',site:'linkedin',resume:{pdf_path:'/x/resume.pdf'}}];
const events=[
 {receivedAt:'2026-10-22T10:00:00Z',kind:'assessment',subject:'Your Databricks assessment',companies:['Databricks'],state:'new',match:'app1'},
 {receivedAt:'2026-10-26T10:00:00Z',kind:'interview',subject:'IBM interview',companies:['IBM Corp'],state:'new'},
 {receivedAt:'2026-10-20T10:00:00Z',kind:'rejected',subject:'Before you applied',companies:['IBM'],state:'new'},
 {receivedAt:'2026-10-27T10:00:00Z',kind:'offer',subject:'dismissed',companies:['IBM'],state:'dismissed'}];

test('tracked and marked applications merge once, with employer mail matched',()=>{
 const rows=buildAppliedRows({applications,swipes,jobs,events});
 assert.equal(rows.length,2,'the swipe linked to a tracked application, the repeated mark and the left swipe add nothing');
 assert.deepEqual(rows.map(r=>r.company),['IBM','Databricks, Inc.'],'newest first');
 const ibm=rows[0],db=rows[1];
 assert.equal(ibm.via,'You marked it applied');assert.equal(ibm.outcome.status,'interview','mail before applying and dismissed mail are ignored');
 assert.equal(db.via,'Apply with Atriveo');assert.equal(db.outcome.status,'assessment');assert.equal(db.confirmed,true);
 assert.equal(db.mail.length,1);
});
test('company names match across suffixes and punctuation',()=>{assert.equal(companyKey('Databricks, Inc.'),companyKey('databricks'));assert.equal(companyKey('IBM Corp'),companyKey('I.B.M.'.replace(/\./g,'')) );});

function fakeDb(){const data={applications,job_swipes:swipes,inbox_events:events,jobs};return {collection:n=>({find:()=>({toArray:async()=>data[n]})})};}
test('filters, counts and the single-row view',async()=>{
 const now=Date.parse('2026-10-27T12:00:00Z');
 const all=await appliedHistory(fakeDb(),{now});
 assert.equal(all.total,2);assert.equal(all.counts.interview,1);assert.equal(all.counts.assessment,1);assert.equal(all.counts.none,0);assert.equal(all.last7,2);
 const iv=await appliedHistory(fakeDb(),{outcome:'interview',now});assert.deepEqual(iv.rows.map(r=>r.company),['IBM']);
 assert.equal((await appliedHistory(fakeDb(),{q:'databr',now})).total,1);
 const one=await appliedHistory(fakeDb(),{key:'a:app1',now});assert.equal(one.row.mail[0].subject,'Your Databricks assessment');
 assert.equal((await appliedHistory(fakeDb(),{key:'a:nope',now})).ok,false);
});
