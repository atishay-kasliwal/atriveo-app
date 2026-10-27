import test from 'node:test';import assert from 'node:assert/strict';
import {buildWidgetProgress,widgetProgress,PROGRESS_TIME_ZONE} from '../scripts/widget-progress.mjs';

const now=new Date('2026-10-27T03:00:00Z'); // still Oct 26 in New York
test('progress is aggregate counts for the New York day, with no addresses or subjects',()=>{
 const applications=[{_id:'a',jobUrls:['https://x/1'],lifecycle:{appliedAt:'2026-10-26T15:00:00Z'}},{_id:'b',jobUrls:['https://x/2'],lifecycle:{appliedAt:'2026-10-25T15:00:00Z'}}];
 const swipes=[{job_url:'https://x/3',direction:'applied',applied_at:'2026-10-26T20:00:00Z'},{job_url:'https://x/1',direction:'applied',applied_at:'2026-10-26T16:00:00Z'}];
 const events=[{receivedAt:'2026-10-26T14:00:00Z',kind:'interview',state:'new'},{receivedAt:'2026-10-26T15:00:00Z',kind:'assessment',state:'new'},{receivedAt:'2026-10-26T16:00:00Z',kind:'rejected',state:'dismissed'},{receivedAt:'2026-10-25T16:00:00Z',kind:'offer',state:'new'}];
 const p=buildWidgetProgress(applications,swipes,events,{now,reviewCount:4});
 assert.equal(p.dayKey,'2026-10-26');assert.equal(p.timeZone,PROGRESS_TIME_ZONE);
 assert.equal(p.appliedToday,2,'one tracked application today plus one manual mark not already linked');
 assert.equal(p.interviewEmailsToday,1);assert.equal(p.assessmentEmailsToday,1);
 assert.equal(p.responseEmailsToday,2,'dismissed and yesterday are not counted');
 assert.equal(p.reviewCount,4);
 assert.deepEqual(Object.keys(p).sort(),['appliedToday','assessmentEmailsToday','dayKey','generatedAt','interviewEmailsToday','responseEmailsToday','reviewCount','timeZone','version']);
});

test('widgetProgress reads only counts-shaped data from Mongo',async()=>{
 const calls=[];
 const db={collection:name=>({find:(q,o)=>{calls.push([name,Object.keys(o.projection)]);return {toArray:async()=>[]};},countDocuments:async()=>0})};
 const p=await widgetProgress(db,{now});
 assert.equal(p.appliedToday,0);
 assert.ok(calls.every(([,fields])=>!fields.includes('subject')&&!fields.includes('from')&&!fields.includes('body')));
});
