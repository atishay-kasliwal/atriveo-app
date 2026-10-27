import test from 'node:test';import assert from 'node:assert/strict';
import {buildInsights} from '../scripts/insights.mjs';

// Tuesday Oct 27 2026, 3:00 PM New York.
const NOW=Date.parse('2026-10-27T19:00:00Z'),DAY=86400000;
const at=(daysAgo,h=15)=>new Date(NOW-daysAgo*DAY-(15-h)*3600000).toISOString();
const row=(daysAgo,extra={})=>({appliedAt:at(daysAgo),source:'linkedin',title:'Software Engineer',outcome:null,mail:[],...extra});
const many=(n,daysAgo,extra)=>Array.from({length:n},()=>row(daysAgo,extra));

test('pace: today, the last 7 and the 7 before, 30 days, the best day and the average',()=>{
 const rows=[...many(5,0),...many(3,1),...many(2,3),...many(4,9),...many(6,20),...many(7,45)];
 const r=buildInsights({rows,goal:4,now:NOW});
 assert.equal(r.totals.today,5);assert.equal(r.totals.last7,10);assert.equal(r.totals.prev7,4);assert.equal(r.totals.last30,20);assert.equal(r.totals.all,27);
 assert.equal(r.totals.avg7,1.4);assert.equal(r.best.applied,6);assert.equal(r.best.day,'2026-10-07');
 assert.equal(r.days.length,30);assert.equal(r.days.at(-1).day,'2026-10-27');assert.equal(r.days.at(-1).applied,5);assert.equal(r.days[0].day,'2026-09-28');
 assert.equal(r.today.tier,1,'5 of 4 is past the goal');assert.equal(r.today.fraction,1);});

test('streak counts today once met and the days before it, and breaks on a short day',()=>{
 const rows=[...many(4,0),...many(4,1),...many(5,2),...many(1,3),...many(4,4)];
 assert.equal(buildInsights({rows,goal:4,now:NOW}).streak,3);
 assert.equal(buildInsights({rows:rows.slice(4),goal:4,now:NOW}).streak,2,'today not met yet: through yesterday');});

test('where you apply: sources and roles over the last 30 days, biggest first, "other" for the unknown',()=>{
 const rows=[...many(3,1,{source:'greenhouse',title:'Machine Learning Engineer'}),...many(2,2,{source:'linkedin'}),row(2,{source:null,title:'Chef'}),...many(9,60,{source:'lever'})];
 const r=buildInsights({rows,goal:10,now:NOW});
 assert.deepEqual(r.sources,[{key:'greenhouse',count:3},{key:'linkedin',count:2},{key:'other',count:1}]);
 assert.equal(r.tracks.reduce((n,t)=>n+t.count,0),6);assert.ok(r.tracks.some(t=>t.key==='other'));assert.ok(r.tracks[0].count>=2);});

test('replies: the funnel, a reply rate only from applications old enough to have heard back, and the median wait',()=>{
 const reply=(daysAgo,status,waitDays)=>row(daysAgo,{outcome:{status,at:at(daysAgo-waitDays)},mail:[{at:new Date(Date.parse(at(daysAgo))+waitDays*DAY).toISOString(),kind:status}]});
 const rows=[...many(8,20),reply(20,'interview',2),reply(18,'rejected',4),reply(15,'assessment',6),reply(14,'offer',2),...many(3,1),reply(2,'rejected',1)];
 const f=buildInsights({rows,goal:10,now:NOW}).funnel;
 assert.equal(f.applied,16);assert.equal(f.replied,5);assert.equal(f.interview,1);assert.equal(f.assessment,1);assert.equal(f.offer,1);assert.equal(f.rejected,2);assert.equal(f.none,11);
 assert.equal(f.replyRate,Math.round(4/12*100),'12 applications are at least a week old and 4 of them have an answer');
 assert.equal(f.medianReplyDays,2,'waits of 2, 4, 6, 2 and 1 days: the median');
 const few=buildInsights({rows:[reply(20,'interview',2)],goal:10,now:NOW}).funnel;assert.equal(few.replyRate,null);assert.equal(few.medianReplyDays,null);});

test('what is waiting: the resume pipeline, general jobs and assessments, each optional',()=>{
 const none=buildInsights({rows:[],goal:10,now:NOW});assert.equal(none.pipeline,null);assert.equal(none.waiting.general,null);assert.deepEqual(none.assessments,{open:0,unknown:0,next:null});
 const r=buildInsights({rows:[],goal:10,now:NOW,pipeline:{done:40,queued:9,running:1,failed:2,extra:'x'},general:722,assessments:[{company:'C-SMART',deadlineAt:null,state:'unknown',when:'no deadline yet'},{company:'Roblox',deadlineAt:'2026-10-28T03:59:00Z',state:'today',when:'today at 11:59 PM'}]});
 assert.deepEqual(r.pipeline,{done:40,queued:9,running:1,failed:2});assert.equal(r.waiting.general,722);
 assert.equal(r.assessments.open,2);assert.equal(r.assessments.unknown,1);assert.equal(r.assessments.next.company,'Roblox');
 assert.ok(!JSON.stringify(r).includes('extra'),'only the known fields leave');});

test('nothing breaks with no applications at all',()=>{
 const r=buildInsights({rows:[],goal:15,now:NOW});
 assert.equal(r.totals.all,0);assert.equal(r.best.applied,0);assert.equal(r.streak,0);assert.deepEqual(r.sources,[]);assert.equal(r.funnel.replyRate,null);});

test('the lap tally counts the days that reached the goal, double, triple ... over 30 days and over everything',()=>{
 const rows=[...many(65,0),...many(31,1),...many(95,2),...many(30,3),...many(29,4),...many(125,40)];
 const m=buildInsights({rows,goal:30,now:NOW}).milestones;
 assert.deepEqual(m.map(x=>[x.lap,x.need]),[[1,30],[2,60],[3,90],[4,120]],'laps up to the best day (125 is lap 4)');
 assert.deepEqual(m.map(x=>x.days30),[4,2,1,0],'days 0-4 ago have 65, 31, 95, 30 and 29 applications; day 40 is outside the 30');
 assert.deepEqual(m.map(x=>x.daysAll),[5,3,2,1],'the day 40 ago counts for all time');
 const none=buildInsights({rows:many(5,0),goal:30,now:NOW});assert.deepEqual(none.milestones,[]);assert.equal(none.milestoneMore,0);
 const big=buildInsights({rows:many(30*15,0),goal:30,now:NOW});assert.equal(big.milestones.length,12);assert.equal(big.milestoneMore,3,'laps past the twelfth are only counted');
 assert.equal(buildInsights({rows:many(1,0),goal:0,now:NOW}).milestones.length,1,'a zero goal is treated as 1');});
