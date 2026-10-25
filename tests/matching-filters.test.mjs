import test from 'node:test';import assert from 'node:assert/strict';
import {filterMatchingJobs,matchingTimestamp,matchingSource,confirmedApplicationCount} from '../scripts/matching-filters.mjs';
const now=new Date('2026-10-26T01:00:00Z'); // still Oct 25 in New York
const docs=[
 {job_url:'https://www.linkedin.com/jobs/view/1',date_posted:'2026-10-25T15:00:00Z',run_at:'2026-10-26T00:30:00Z',title:'AI Engineer',company:'Alpha',track:'ai-engineer',site:'linkedin'},
 {job_url:'https://agency.example/2',date_posted:'2026-10-24T15:00:00Z',title:'AI Engineer',company:'Beta',track:'ai-engineer',site:'staffing'},
 {job_url:'https://boards.greenhouse.io/a/jobs/3',date_posted:'2026-10-25T18:00:00Z',title:'Software Engineer',company:'Alpha',track:'software-engineer',site:'greenhouse'},
 {job_url:'https://agency.example/4',date_posted:'invalid',run_at:'2026-10-25T21:00:00Z',title:'AI Engineer',company:'Gamma',track:'ai-engineer',site:'staffing'},
 {job_url:'https://old.example/5',date_posted:'2026-10-01T00:00:00Z',run_at:'2026-10-25T22:00:00Z',title:'AI Engineer',company:'Old',track:'ai-engineer'},
];
test('dates, multi-source OR, role and text combine before pagination; posting date outranks found date',()=>{
 const selected=filterMatchingJobs(docs,{period:'today',sources:['linkedin','staffing'],role:'ai-engineer',query:'AI',now});assert.deepEqual(selected.map(d=>d.company),['Alpha','Gamma']);
 assert.deepEqual(filterMatchingJobs(docs,{period:'yesterday',now}).map(d=>d.company),['Beta']);
 assert.equal(filterMatchingJobs(docs,{period:'7d',now}).length,4);
 assert.equal(filterMatchingJobs(docs,{period:'all',now}).length,5);
 assert.equal(matchingTimestamp(docs[3]),Date.parse(docs[3].run_at));
 assert.equal(matchingTimestamp(docs[4]),Date.parse(docs[4].date_posted));
 assert.equal(matchingSource({job_url:'https://boards.greenhouse.io/a/jobs/1'}),'greenhouse');
 assert.equal(matchingSource({site:'staffing',job_url:'https://www.linkedin.com/jobs/view/1'}),'staffing');
});
test('calendar boundaries follow the selected timezone, including DST and invalid timezone fallback',()=>{
 const at=new Date('2026-11-02T04:30:00Z'); // 23:30 on Nov 1 after the fall-back
 const rows=[{run_at:'2026-11-01T04:30:00Z'},{run_at:'2026-11-02T04:00:00Z'},{run_at:'2026-11-02T05:00:00Z'}];
 assert.equal(filterMatchingJobs(rows,{period:'today',now:at}).length,2);
 assert.equal(filterMatchingJobs(rows,{period:'today',now:at,timeZone:'Invalid/Zone'}).length,2);
 assert.equal(filterMatchingJobs(rows,{period:'today',now:at,timeZone:'UTC'}).length,2);
});
test('applied counts only confirmed submissions, de-duplicating manual marks linked to tracked applications',()=>{
 assert.equal(confirmedApplicationCount([{jobUrls:['a','b']}],[{job_url:'a',direction:'applied'},{job_url:'c',direction:'right'},{job_url:'d',direction:'applied'},{job_url:'d',direction:'applied'}]),2);
});

import {rankForMatching} from '../scripts/job-matching.mjs';
test('newest-first order stays chronological regardless of fit or saved state',()=>{
 const older={...docs[1],fit:{score:99}},newer={...docs[0],fit:{score:30}};
 assert.deepEqual(rankForMatching([older,newer],new Map([[newer.job_url,'saved']]),'latest').map(d=>d.job_url),[newer.job_url,older.job_url]);
 assert.equal(rankForMatching([older,newer],new Map(),'fit')[0].job_url,older.job_url);
});
