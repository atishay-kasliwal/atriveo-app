import test from 'node:test';import assert from 'node:assert/strict';
import {answerApplication,pickEvidence,answerSystem,ANSWER_SCHEMA} from '../../scripts/application-answer.mjs';

const jd='Acme builds routing software for hospital logistics. We are hiring a Software Engineer to own Python services and Kubernetes deployments. '.repeat(3);
const loaded={source:{kind:'job',jobUrl:'https://jobs.example.test/1',company:'Acme',title:'Software Engineer'},jd,skills:['Python','Kubernetes'],
 sections:[{role:'Stony Brook',kind:'experience',bullets:[{text:'Built a three-agent debate system in Python with LangChain and 60% directional accuracy.',ac_id:'AC-1',facet:'x'}]}]};
const bank={acs:[
 {id:'AC-9',role:'Accolite',status:'APPROVED',variants:[{text:'Deployed Kubernetes services handling 2M requests a day.',facet:'k8s'}]},
 {id:'AC-10',role:'Atriveo',status:'APPROVED',variants:[{text:'Built Atriveo, a job platform with Kubernetes.',facet:'x'}]},
 {id:'AC-11',role:'Wake Forest',status:'DRAFT',variants:[{text:'Draft only Kubernetes bullet',facet:'x'}]},
]};
const load=async()=>loaded;

test('the answer is written from the posting and cited bank entries; Atriveo and drafts never reach the model',async()=>{
 let seen;
 const generate=async(request)=>{seen=request;const e=JSON.parse(request.user).evidence;return {answer:'Acme routes hospital logistics, and I run Python services that way. At Accolite I deployed Kubernetes services — 2M requests a day.',evidence_source:[e.find(x=>/Kubernetes services/.test(x.text)).id],company_points:['routing software for hospital logistics'],note:''};};
 const r=await answerApplication({},{kind:'why-company',jobUrl:'https://jobs.example.test/1',provider:'codex'},{generate,load,bank});
 const sent=JSON.parse(seen.user);
 assert.equal(sent.question,'Why do you want to join Acme?');
 assert.ok(sent.evidence.some(e=>e.id==='story_bank:AC-9:0'),'bank evidence from another employer is offered');
 assert.ok(sent.evidence.some(e=>e.id.startsWith('current_resume:')));
 assert.ok(!sent.evidence.some(e=>/atriveo/i.test(e.text)),'the user\'s own platform is never evidence');
 assert.ok(!sent.evidence.some(e=>/Draft only/.test(e.text)),'draft bank entries are not offered');
 assert.match(seen.system,/ONLY from the evidence/);
 assert.equal(r.answer.used[0].employer,'Accolite');
 assert.ok(!/[—–]/.test(r.answer.text),'dashes are replaced');
 assert.equal(r.answer.company,'Acme');
});

test('bad requests and ungrounded answers are refused',async()=>{
 const ok={jobUrl:'https://jobs.example.test/1',provider:'codex'};
 await assert.rejects(()=>answerApplication({},{...ok,kind:'nope'},{generate:async()=>({}),load,bank}),/Choose which question/);
 await assert.rejects(()=>answerApplication({},{...ok,kind:'custom',question:'  '},{generate:async()=>({}),load,bank}),/Paste the question/);
 await assert.rejects(()=>answerApplication({},{...ok,kind:'why-hire'},{generate:async()=>({}),load:async()=>({...loaded,jd:'short'}),bank}),/no saved description/);
 await assert.rejects(()=>answerApplication({},{...ok,kind:'why-hire'},{generate:async()=>({answer:'x',evidence_source:['story_bank:AC-404:0'],company_points:[],note:''}),load,bank}),/unknown evidence/);
 await assert.rejects(()=>answerApplication({},{...ok,kind:'why-hire'},{generate:async()=>({answer:'I built Atriveo.',evidence_source:[],company_points:[],note:''}),load,bank}),/Atriveo/);
 await assert.rejects(()=>answerApplication({},{...ok,kind:'why-hire',provider:'gpt'},{generate:async()=>({}),load,bank}),/Choose Claude/);
});

test('evidence is ranked by overlap with the posting and the prompt states the length',()=>{
 const entries=[{id:'a',role:'X',text:'Painted fences'},{id:'b',role:'X',text:'Deployed Kubernetes services for hospital logistics'}];
 assert.equal(pickEvidence(entries,'Kubernetes hospital logistics',1)[0].id,'b');
 assert.match(answerSystem('why-company','short'),/about 70 words/);
 assert.deepEqual(ANSWER_SCHEMA.required,['answer','evidence_source','company_points','note']);
});
