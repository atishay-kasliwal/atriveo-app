import test from 'node:test';import assert from 'node:assert/strict';
import {queueKey,companySummary,similarJobs,preferenceBoost} from '../scripts/matching-workspace.mjs';
import {evidenceBox} from '../scripts/job-matching-analysis.mjs';
const job=(url,company,title,score=80)=>({job_url:url,company,title,track:'software-engineer',run_at:'2026-10-24T12:00:00Z',fit:{score,ledger:{skills:[{alternatives:['Python']}]}}});
test('company counts are dataset counts with real saved and new job totals',()=>{const docs=[job('a','Amazon','Engineer',88),job('b','Amazon','Engineer',91),job('c','Google','Engineer',85)];const c=companySummary(docs,new Map([['a','today']]),new Date('2026-10-24T16:00:00Z'));assert.deepEqual(c[0],{key:'amazon',name:'Amazon',count:2,newToday:2,bestMatch:91,saved:1,source:null,sources:[]});assert.equal(queueKey('a').length,16);});
test('related jobs are real rows, never the current job or invented opportunities',()=>{const a=job('a','Amazon','Python Software Engineer');const b=job('b','Google','Python Software Engineer');const rows=similarJobs(a,[a,b]);assert.equal(rows[0].id,'b');assert.equal(rows[0].score,80);});
test('behavior ranking waits for five jobs and stays bounded',()=>{const d=job('a','Amazon','Engineer');assert.equal(preferenceBoost(d,[{kind:'saved',job_url:'a',company:'Amazon'}]),0);const events=Array.from({length:50},(_,i)=>({job_url:String(i),company:'Amazon',track:'software-engineer',kind:'apply_opened'}));const boost=preferenceBoost(d,events);assert.ok(boost>0&&boost<=2);assert.equal(preferenceBoost(d,events.map(e=>({...e,kind:'viewed'}))),0);});
test('resume highlight requires actual PDF words, never bank-only evidence',()=>{const bbox='<page width="100" height="200"><word xMin="10" yMin="20" xMax="20" yMax="30">Built</word><word xMin="22" yMin="20" xMax="40" yMax="30">Python</word><word xMin="42" yMin="20" xMax="60" yMax="30">services.</word></page>';assert.deepEqual(evidenceBox(bbox,'Built Python services.'),{x:10,y:10,width:50,height:5});assert.equal(evidenceBox(bbox,'Built Rust services.'),null);});

import {shapeJd} from '../scripts/job-matching.mjs';
test('non-internship experience is not an internship job type',()=>{assert.equal(shapeJd('3+ years of non-internship professional software development experience').kind,null);assert.equal(shapeJd('Job type: Full-time. Prior internships count.').kind,'Full-time');assert.equal(shapeJd('Paid internship position').kind,'Internship');});

test('each company carries the source most of its jobs were pulled from, for the rail color', () => {
  const docs = [
    { company: 'Artech', site: 'staffing', job_url: 'https://a/1' }, { company: 'Artech', site: 'staffing', job_url: 'https://a/2' },
    { company: 'Artech', site: 'linkedin', job_url: 'https://a/3' }, { company: 'Deloitte', site: 'linkedin', job_url: 'https://d/1' },
    { company: 'Odd Co', site: 'somewhere-else', job_url: 'https://o/1' },
  ];
  const by = Object.fromEntries(companySummary(docs, new Map()).map((c) => [c.name, c]));
  assert.equal(by.Artech.source, 'staffing');
  assert.deepEqual(by.Artech.sources, ['staffing', 'linkedin']);
  assert.equal(by.Deloitte.source, 'linkedin');
  assert.equal(by['Odd Co'].source, null, 'an unknown site stays neutral');
  assert.equal('bySource' in by.Artech, false);
});
