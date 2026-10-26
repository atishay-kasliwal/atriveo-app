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

test('applied today uses submission time in the local day, not all-time totals, opens or rediscovery',()=>{
 const now=new Date('2026-10-26T02:00:00Z'); // Oct 25, 10pm New York
 const apps=[{jobUrls:['yesterday'],lifecycle:{appliedAt:'2026-10-25T03:59:59Z'}},{jobUrls:['today'],lifecycle:{appliedAt:'2026-10-25T04:00:00Z'}},{jobUrls:['tomorrow'],lifecycle:{appliedAt:'2026-10-26T04:00:00Z'}},{jobUrls:['unknown']}];
 const swipes=[{job_url:'today',direction:'applied',applied_at:'2026-10-26T01:00:00Z'},{job_url:'yesterday',direction:'applied',applied_at:'2026-10-26T01:00:00Z'},{job_url:'manual',direction:'applied',applied_at:'2026-10-26T01:00:00Z'},{job_url:'old',direction:'applied',applied_at:'2026-10-25T03:59:59Z'},{job_url:'opened',direction:'right',swiped_at:'2026-10-26T01:00:00Z'}];
 assert.equal(confirmedApplicationCount(apps,swipes,{now,timeZone:'America/New_York'}),2);
 assert.equal(confirmedApplicationCount(apps,swipes,{now,timeZone:'Invalid/Zone'}),2);
 assert.equal(confirmedApplicationCount(apps,swipes,{now,timeZone:'UTC'}),2); // future-day application + manual
 assert.equal(confirmedApplicationCount(apps,swipes),6);
});
test('today counting handles both occurrences of the fall-back hour and midnight rollover',()=>{
 const apps=[{jobUrls:['first'],lifecycle:{appliedAt:'2026-11-01T05:30:00Z'}},{jobUrls:['second'],lifecycle:{appliedAt:'2026-11-01T06:30:00Z'}}];
 assert.equal(confirmedApplicationCount(apps,[],{now:new Date('2026-11-02T04:59:59Z')}),2);
 assert.equal(confirmedApplicationCount(apps,[],{now:new Date('2026-11-02T05:00:00Z')}),0);
});

test('a posting date without a time counts as that calendar day in every time zone (LinkedIn jobs on Today)', () => {
  const now = new Date('2026-10-25T23:30:00Z'); // 7:30 PM in New York, already Oct 26 in UTC
  const docs = [
    { job_url: 'https://www.linkedin.com/jobs/view/1', site: 'linkedin', date_posted: '2026-10-25', run_at: '2026-10-25T22:00:00Z', title: 'AI Engineer' },
    { job_url: 'https://www.linkedin.com/jobs/view/2', site: 'linkedin', date_posted: '2026-10-24', run_at: '2026-10-25T22:00:00Z', title: 'AI Engineer' },
    { job_url: 'https://x.jobdiva.com/1', site: 'staffing', date_posted: '2026-10-25T15:00:00+00:00', run_at: '2026-10-25T16:00:00Z', title: 'Engineer' },
  ];
  const ids = (period, timeZone = 'America/New_York') => filterMatchingJobs(docs, { period, now, timeZone }).map((d) => d.job_url);
  assert.deepEqual(ids('today'), ['https://www.linkedin.com/jobs/view/1', 'https://x.jobdiva.com/1']);
  assert.deepEqual(ids('yesterday'), ['https://www.linkedin.com/jobs/view/2']);
  assert.deepEqual(ids('today', 'America/Los_Angeles'), ['https://www.linkedin.com/jobs/view/1', 'https://x.jobdiva.com/1']);
});
