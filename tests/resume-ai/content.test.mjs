import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadBank} from '../../scripts/ac-bank.mjs';
import {applyContentChanges} from '../../src/shared/resumeContent.mjs';
import {buildEvidence,groundedChanges,validateSchema} from '../../scripts/resume-ai-content.mjs';
import {analyzeResume,OPTIMIZER_SCHEMA} from '../../scripts/resume-ai.mjs';
const bank=loadBank();
const real=JSON.parse(fs.readFileSync(new URL('../review/fixtures/builder-run/composition.json',import.meta.url),'utf8'));
const sections=[...real.composition.experience.map(s=>({...s,kind:'experience',label:s.role,dates:'LOCKED',location:'LOCKED',title:'LOCKED'})),...real.composition.projects.map(s=>({...s,kind:'project',label:s.role,stack:['LOCKED']}))];
const skills=real.skills;
const evidence=buildEvidence(sections,skills,bank);
const sbu=sections.find(s=>s.role==='stony-brook');
const proof=evidence.find(e=>e.ac_id==='AC-199'&&e.id.startsWith('story_bank:'));
const result=()=>({subscores:{skills:70,experience:75,keywords:65,evidence:80},requirements:[{requirement:'MLflow for model operations',importance:'high',status:'PARTIAL',optimized_status:'STRONG',evidence:proof.id},{requirement:'Databricks',importance:'high',status:'MISSING',optimized_status:'MISSING',evidence:'No evidence'}],sectionChanges:[{role:'stony-brook',reason:'Surface approved model operations experience.',requirements:['MLflow for model operations'],bullets:sbu.bullets.map((b,i)=>i===1?{text:proof.text,evidence_source:proof.id}:{text:b.text,evidence_source:`current_resume:stony-brook:${i}`})}],skills_changes:{reason:'Surface supported skills.',groups:[{label:'AI & Machine Learning',skills:[{name:'MLflow',evidence_source:proof.id}]}]},atsProblems:[]});
test('approved omitted evidence becomes eligible content with source trace',()=>{const r=groundedChanges(result(),sections,skills,evidence,bank);assert.equal(r.accepted.filter(c=>c.kind==='section').length,1,JSON.stringify(r.rejected));assert(r.accepted[0].bullets.some(b=>b.ac_id==='AC-199'));assert(r.accepted.some(c=>c.kind==='skills'));});
test('Apply All changes only bullets and skills; preserves names, titles, dates, section order, stack and original input',()=>{const original=structuredClone(sections),r=groundedChanges(result(),sections,skills,evidence,bank);const next=applyContentChanges(sections,skills.join('\n'),r.accepted);assert.deepEqual(sections,original);next.sections.forEach((s,i)=>{const {bullets,...locked}=s;const {bullets:old,...expected}=original[i];assert.deepEqual(locked,expected);});assert(next.skills.includes('MLflow'));assert.notDeepEqual(next.sections,sections);const undo=structuredClone({sections,skills:skills.join('\n')});assert.deepEqual(undo.sections,original);});
test('rejects design fields and unknown patch targets',()=>{assert.throws(()=>validateSchema(OPTIMIZER_SCHEMA,{...result(),layout:{font:'new'}}),/forbidden/);assert.throws(()=>applyContentChanges(sections,'', [{kind:'education'}]),/only/);});
test('stale content cannot be applied',()=>{const r=groundedChanges(result(),sections,skills,evidence,bank);const changed=structuredClone(sections);changed[0].bullets[0].text='unsaved edit';assert.throws(()=>applyContentChanges(changed,skills.join('\n'),r.accepted),/changed/);});
test('unsupported Databricks is rejected in both skills and bullets',()=>{const r=result();r.sectionChanges[0].bullets[1].text=proof.text.replace('MLflow','Databricks');r.skills_changes.groups[0].skills=[{name:'Databricks',evidence_source:proof.id}];const out=groundedChanges(r,sections,skills,evidence,bank);assert.equal(out.accepted.length,0);assert(out.rejected.length===2);});
test('invented metrics and cross-employer evidence are rejected',()=>{for(const mutate of [r=>{r.sectionChanges[0].bullets[1].text=proof.text.replace('110+','999+');},r=>{r.sectionChanges[0].bullets[1].evidence_source=evidence.find(e=>e.role==='wake-forest').id;}]){const r=result();mutate(r);assert(!groundedChanges(r,sections,skills,evidence,bank).accepted.some(c=>c.kind==='section'));}});
test('real resume fixture + stored JD + unsaved edits reach model; reviewed proposal persists without saving resume',async()=>{
 const jd='Required: MLflow model operations. Databricks preferred.';
 const inserted=[];let call=0;
 const current=structuredClone(sections);current[0].bullets[0].text=current[0].bullets[0].text.replace('Led development','Led implementation');
 const db={collection:name=>({findOne:async()=>name==='descriptions'?{description:jd}:null,insertOne:async doc=>{assert.equal(name,'resume_ai_analysis');inserted.push(doc);}})};
 const out=await analyzeResume(db,{source:{kind:'job',jobUrl:'https://example.com/job'},sections:current,skills,headerTitle:'Backend Engineer'},{bank,load:async()=>({jd,source:{kind:'job',jobUrl:'https://example.com/job'},roles:sections.map(s=>({role:s.role,kind:s.kind}))}),generate:async({user})=>{
  if(call++===0){const input=JSON.parse(user);assert.equal(input.jd,jd);assert.deepEqual(input.resume.sections,current);assert(input.story_bank_or_profile.some(e=>e.ac_id==='AC-199'));const r=result();r.sectionChanges[0].bullets[0].text=current[0].bullets[0].text;return r;}
  const input=JSON.parse(user);return{verdicts:input.changes.map((c,index)=>({index,supported:true,reason:'Matches cited evidence.'}))};
 }});
 assert(out.analysis.suggestions.length>0);assert(out.analysis.optimized_resume.technicalSkills.join(' ').includes('MLflow'));assert(!JSON.stringify(out.analysis.optimized_resume).includes('Databricks'));assert.equal(inserted.length,1);assert(out.analysis.optimized_match_score>out.analysis.original_match_score);
});
test('model failure performs no writes',async()=>{let writes=0;const db={collection:()=>({findOne:async()=>({description:'JD'}),insertOne:async()=>writes++})};await assert.rejects(analyzeResume(db,{source:{jobUrl:'x'},sections,skills},{bank,load:async()=>({source:{kind:'job',jobUrl:'x'},jd:'JD',roles:sections}),generate:async()=>{throw Error('Model unavailable');}}),/Model unavailable/);assert.equal(writes,0);});
test('changed JD or resume version rejects accepted decisions before persistence',async()=>{
 const {recordAiDecision,versionOf}=await import('../../scripts/resume-ai.mjs');
 const a={_id:'analysis',source:{jobUrl:'x'},suggestions:[{id:'s'}],jdVersion:versionOf('original JD'),resumeVersion:'original-resume'};let writes=0;
 const db={collection:name=>({findOne:async()=>name==='resume_ai_analysis'?a:{description:'changed JD'},updateOne:async()=>writes++})};
 await assert.rejects(recordAiDecision(db,{analysisId:'analysis',suggestionId:'s',decision:'accepted',resumeVersion:'original-resume'},{load:async()=>({source:{kind:'job',jobUrl:'x'},jd:'original JD'})}),/changed/);assert.equal(writes,0);
});
test('missing requirements cannot produce content changes even with a valid source',()=>{const r=result();r.requirements[0].status='MISSING';assert(!groundedChanges(r,sections,skills,evidence,bank).accepted.some(c=>c.kind==='section'));});
test('content cannot contain AI-generated HTML or LaTeX commands',()=>{for(const suffix of [' <b>MLflow</b>',' \\textbf{MLflow}']){const r=result();r.sectionChanges[0].bullets[1].text+=suffix;assert(!groundedChanges(r,sections,skills,evidence,bank).accepted.some(c=>c.kind==='section'));}});
test('full original fixture JD reaches analysis without replacement or truncation',async()=>{
 const jd=fs.readFileSync(new URL('../review/fixtures/builder-run/jd.txt',import.meta.url),'utf8');let captured;
 const db={collection:()=>({findOne:async()=>({description:jd}),insertOne:async()=>{}})};
 const out=await analyzeResume(db,{source:{jobUrl:'fixture'},sections,skills},{bank,load:async()=>({jd:'short fallback',source:{kind:'job',jobUrl:'fixture'},roles:sections}),generate:async({user})=>{captured=JSON.parse(user);return{subscores:{skills:80,experience:80,keywords:80,evidence:80},requirements:[],sectionChanges:[],skills_changes:{reason:'Keep current supported skills',groups:[]},atsProblems:[]};}});
 assert.equal(captured.jd,jd);assert.deepEqual(captured.resume.sections,sections);assert.deepEqual(out.analysis.optimized_resume.technicalSkills,skills);
});
