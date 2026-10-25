import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './helpers.mjs';
import { skillEvidence, conceptEvidence } from '../../scripts/ats/evidence.mjs';
import { scoreFit } from '../../scripts/ats/fit.mjs';
import { parseJobDescription, normalizeJobDescription } from '../../scripts/ats/jd-parse.mjs';
import { scoreJobMatch } from '../../scripts/ats/match.mjs';
import { assessmentInputs, ATS_ALGORITHM_HASH, assessmentFreshness } from '../../scripts/ats/identity.mjs';
import { resumeMatchOf, resumeReadyOf } from '../../scripts/applications-analytics.mjs';

const resume = bullets => ({contact:{other:[]},summary:'',experience:[{company:'Example',title:'Software Engineer',bullets}],projects:[],skills:{items:[]},education:[]});
for (const [skill, bullet] of [
  ['GitHub','Built a model with 0.74 F1 (facts/github.md).'],
  ['GitHub','Built a service; see https://github.com/example/project.'],
  ['Java','Did not use Java in this project.'],
  ['Java','No Java experience.'],
  ['Java','Not familiar with Java.'],
  ['Rust','Currently learning Rust.'],
  ['Python','No experience with Java or Python.'],
  ['Rust','We plan to use Rust next year.'],
]) test(`no skill credit for ${bullet}`, () => assert.equal(skillEvidence([skill],resume([bullet]),config).kind,'missing'));

test('a denied clause does not erase affirmative evidence in another clause or fact',()=>{
 assert.equal(skillEvidence(['Python'],resume(['Did not use Java, but built Python services.']),config).kind,'exact');
 assert.equal(skillEvidence(['Java'],resume(['Did not use Java.','Built Java APIs for 200 users.']),config).kind,'exact');
});

test('actual machine-learning work is not confused with learning-only claims',()=>{
 assert.equal(skillEvidence(['Python'],resume(['Built machine learning pipelines in Python for 200 users.']),config).kind,'exact');
});

test('language versions do not count as measured outcomes',()=>{
 assert.equal(skillEvidence(['Python'],resume(['Built Python 3 services.']),config).tier,'job_bullet');
 assert.equal(skillEvidence(['Python'],resume(['Built Python 3 services for 200 users.']),config).tier,'measured_job_bullet');
});

test('clinical review is not software code-quality evidence',()=>{
 assert.equal(conceptEvidence(config.responsibilities.code_quality,resume(['Processed MRI scans for clinician review.']),config).credit,0);
 assert.ok(conceptEvidence(config.responsibilities.code_quality,resume(['Added integration tests and code reviews.']),config).credit>0);
});

test('related mentions cannot inflate the depth of direct evidence',()=>{
 const base=skillEvidence(['AWS'],resume(['Built AWS services.']),{...config,scoring:{...config.scoring,job_match:{...config.scoring.job_match,depth:{base:.7,full_at_bullets:4}}}});
 const extra=skillEvidence(['AWS'],resume(['Built AWS services.','Built cloud pipeline one.','Built cloud pipeline two.','Built cloud pipeline three.']),{...config,scoring:{...config.scoring,job_match:{...config.scoring.job_match,depth:{base:.7,full_at_bullets:4}}}});
 assert.equal(extra.credit,base.credit);
 assert.equal(extra.distinct_bullets,1);
});

test('What You Will Bring preserves minimum years and preferred technologies',()=>{
 const jd=parseJobDescription("Software Engineer\nWhat You'll Bring\n- 3+ years of software engineering experience.\n- TypeScript, NestJS and unit tests.\nBonus Points\n- Terraform or Pulumi.",config);
 assert.equal(jd.years.minimum,3);
 assert.equal(jd.years.classification,'required');
 assert.ok(jd.required.some(r=>r.label==='NestJS'));
 assert.ok(jd.required.some(r=>r.label==='Unit testing'));
 assert.ok(jd.preferred.some(r=>r.label==='Terraform / Pulumi'));
});

test('employer technology mentions cannot become fallback requirements',()=>{
 const r=scoreFit('Software Engineer\nAbout us\nOur company uses Java and AWS.\nBenefits\nOur internal portal uses React.',{title:'Software Engineer'});
 assert.equal(r.score,null);
 assert.equal(r.ledger.skills.length,0);
 assert.equal(r.confidence.level,'low');
});

test('unresolved qualification lines prevent high confidence',()=>{
 const text='Software Engineer\nRequirements:\n- Java, Python, AWS, Kafka, SQL and Kubernetes.\n- 3+ years experience.\n- Demonstrated ability to handle ambiguous stakeholder needs.';
 const r=scoreFit(text,{title:'Software Engineer'});
 assert.notEqual(r.confidence.level,'high');
 assert.ok(r.confidence.reasons.some(s=>s.includes('manual review')));
});

test('REST and API share weight while unrelated skill weight stays independent',()=>{
 const r=scoreJobMatch(resume(['Built REST APIs and Kafka services.']),parseJobDescription('Software Engineer\nRequirements:\n- REST APIs and Kafka.',config),config);
 const items=r.categories.find(c=>c.key==='required_skills').items;
 const amount=name=>items.find(i=>i.label===name).max;
 assert.ok(Math.abs(Math.round(amount('REST')*10)+Math.round(amount('API')*10)-Math.round(amount('Kafka')*10))<=1);
 assert.equal(r.categories.some(c=>['education_certs','seniority','achievement_evidence'].includes(c.key)),false);
});

test('saved scores require current rules, PDF, JD and title; stale readiness cannot say Ready',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ats-trust-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pdf=path.join(dir,'resume.pdf'),jd=path.join(dir,'jd.txt'),meta=path.join(dir,'meta.json');
 fs.writeFileSync(pdf,'test PDF');fs.writeFileSync(jd,'Required Python');fs.writeFileSync(meta,JSON.stringify({role:'Software Engineer'}));
 const saved={schema_version:1,algorithm_hash:ATS_ALGORITHM_HASH,config_hash:config.hash,as_of:new Date().toISOString().slice(0,10),inputs:assessmentInputs(pdf),job_match:{score:81.4,requirement_counts:{required:{matched:2,total:3}}}};
 const write=()=>fs.writeFileSync(path.join(dir,'ats-score.json'),JSON.stringify(saved));write();
 assert.equal(assessmentFreshness(saved,pdf).current,true);
 assert.equal(resumeMatchOf(pdf).score,81);
 saved.algorithm_hash='old';write();assert.equal(resumeMatchOf(pdf).score,null);assert.equal(resumeMatchOf(pdf).status,'stale');assert.equal(resumeReadyOf(pdf).status,'Review');
 saved.algorithm_hash=ATS_ALGORITHM_HASH;write();
 for(const [file,replacement] of [[pdf,'changed PDF'],[jd,'Required Rust'],[meta,JSON.stringify({role:'Data Engineer'})]]) {
  const original=fs.readFileSync(file);fs.writeFileSync(file,replacement);
  assert.equal(assessmentFreshness(saved,pdf).current,false);fs.writeFileSync(file,original);
 }
 assert.equal(assessmentFreshness({...saved,as_of:'2020-01-01'},pdf).current,false);
});


test('HTML normalization is portable, preserves boundaries and safely decodes entities',()=>{
 const text=normalizeJobDescription('<h2>Requirements</h2><ul><li>Java &amp; Python</li><li>CI&#x2f;CD</li></ul><script>Rust</script><!-- Go -->');
 assert.ok(text.includes('Java & Python'));assert.ok(text.includes('CI/CD'));
 assert.ok(!text.includes('Rust'));assert.ok(!text.includes('Go'));
 assert.equal(normalizeJobDescription('C++ &lt; Java; &#999999999;'),'C++ < Java; &#999999999;');
});
