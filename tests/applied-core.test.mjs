import test from 'node:test';import assert from 'node:assert/strict';
import {appliedItems,appliedCounts,appliedSummary,dayKeyOf,shiftDay} from '../scripts/applied-core.mjs';
import {confirmedApplicationCount} from '../scripts/matching-filters.mjs';
import {appliedByDay,buildWidgetProgress} from '../scripts/widget-progress.mjs';
import {buildAppliedRows,appliedHistory} from '../scripts/applied-history.mjs';

const now=new Date('2026-10-27T15:00:00Z');
const applications=[
 {_id:'a1',jobUrls:['https://x/1'],lifecycle:{appliedAt:'2026-10-27T13:00:00Z'},company:'A',title:'T'},
 {_id:'a2',jobUrls:['https://x/2'],lifecycle:{appliedAt:'2026-10-26T13:00:00Z'},company:'B',title:'T'},
 {_id:'a3',jobUrls:['https://x/3'],submission:{submittedAt:'2026-10-27T01:00:00Z'},company:'C',title:'T'}, // 9pm Oct 26 in New York
 {_id:'a4',jobUrls:['https://x/4']}];                                                                       // no time recorded
const swipes=[{job_url:'https://x/1',direction:'applied',applied_at:'2026-10-27T13:01:00Z'},{job_url:'https://x/9',direction:'applied',applied_at:'2026-10-27T14:00:00Z'},{job_url:'https://x/9',direction:'applied',applied_at:'2026-10-27T14:30:00Z'},{job_url:'https://x/8',direction:'left',swiped_at:'2026-10-27T14:00:00Z'}];

test('one definition: tracked applications plus marked jobs that no application covers, each once',()=>{
 const items=appliedItems(applications,swipes);
 assert.deepEqual(items.map(i=>i.key),['a:a1','a:a2','a:a3','a:a4','m:https://x/9']);
 const c=appliedCounts(items,{now,days:14});
 assert.equal(c.dayKey,'2026-10-27');assert.equal(c.today,2,'a1 and the marked job');assert.equal(c.total,5,'the untimed one counts in the total, on no day');
 assert.equal(c.days.at(-1).applied,2);assert.equal(c.days.find(d=>d.day==='2026-10-26').applied,2,'a2 and a3 (submission time, New York day)');
 assert.equal(c.last7,4);assert.equal(c.days.length,14);
});
test('every screen reads the same numbers',async()=>{
 const items=appliedItems(applications,swipes),c=appliedCounts(items,{now});
 assert.equal(confirmedApplicationCount(applications,swipes,{now}),c.today,'Matching: today');
 assert.equal(confirmedApplicationCount(applications,swipes),c.total,'Matching: all time');
 const widget=buildWidgetProgress(applications,swipes,[],{now});
 assert.equal(widget.appliedToday,c.today);assert.deepEqual(widget.days,c.days,'widget days');
 assert.deepEqual(appliedByDay(applications,swipes,{now}),c.days);
 const rows=buildAppliedRows({applications,swipes,jobs:[],events:[]});
 assert.equal(rows.length,items.filter(i=>i.appliedAt).length,'Applied page rows: every timed item');
 const db={collection:n=>({find:()=>({toArray:async()=>({applications,job_swipes:swipes,inbox_events:[],jobs:[]}[n])})})};
 const history=await appliedHistory(db,{now:now.getTime()});assert.equal(history.allTime,c.total);assert.equal(history.last7,c.last7);
 const summary=await appliedSummary(db,{days:14,now});assert.equal(summary.today,c.today);assert.deepEqual(summary.days,c.days);
});
test('days step by calendar, so a daylight-saving change never repeats or skips one',()=>{
 assert.equal(shiftDay('2026-11-02',-1),'2026-11-01');assert.equal(shiftDay('2026-11-01',-1),'2026-10-31');
 const days=appliedCounts([],{now:new Date('2026-11-02T15:00:00Z'),days:5}).days.map(d=>d.day);
 assert.deepEqual(days,['2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
 assert.equal(dayKeyOf('2026-10-27T03:00:00Z'),'2026-10-26');assert.equal(dayKeyOf('nope'),null);
});
