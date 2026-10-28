import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

// A sender profile, a general resume on "the server", and in-memory collections. Every person and address is invented.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nwmail-'));process.env.RESUME_PROFILE_PATH=path.join(dir,'resume-profile.json');
fs.writeFileSync(process.env.RESUME_PROFILE_PATH,JSON.stringify({name:'Alex Rivera',email:'alex.rivera@example.test'}));
const outRoot=path.join(dir,'out');fs.mkdirSync(path.join(outRoot,'general','swe'),{recursive:true});
fs.writeFileSync(path.join(outRoot,'general','swe','r.pdf'),'%PDF-1.4 general resume');
fs.writeFileSync(path.join(outRoot,'general','manifest.json'),JSON.stringify({resumes:{'software-engineer':{label:'Software engineer',path:'/Users/someone/tailored/general/swe/r.pdf'}}}));
const {buildMime,mailSettings,saveMailSettings,sendNetworkMail,startDraft,draftStatus,draftRequest}=await import('../scripts/network-mail.mjs');
const {savePerson,saveSource}=await import('../scripts/network.mjs');
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:()=>({toArray:async()=>[...m.values()].map(clone)}),findOne:async q=>m.has(q._id)?clone(m.get(q._id)):null,
 insertOne:async d=>{m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...clone(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...clone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-28T15:00:00Z');
const sender=(result)=>{const sent=[];return{sent,send:async e=>{sent.push(e);return result}}};

test('the message: plain text in base64, encoded non-ASCII headers, an optional PDF part, and no header injection',()=>{
 const plain=buildMime({from:'a@example.test',fromName:'Alex Rivera',to:'b@example.test',subject:'Hello',body:'Hi\nthere',attachment:null});
 assert.match(plain,/^From: Alex Rivera <a@example.test>\r\nTo: b@example.test\r\nSubject: Hello\r\n/);assert.ok(plain.includes(Buffer.from('Hi\r\nthere').toString('base64')));
 const accent=buildMime({from:'a@example.test',fromName:'Zoë',to:'b@example.test',subject:'Café',body:'x',attachment:null});assert.match(accent,/=\?UTF-8\?B\?/);
 const pdf=buildMime({from:'a@example.test',fromName:'',to:'b@example.test',subject:'s',body:'x',attachment:{fileName:'Alex "R".pdf',bytes:Buffer.from('%PDF-1')}},'B');
 assert.match(pdf,/multipart\/mixed; boundary="B"/);assert.match(pdf,/filename="Alex R.pdf"/);assert.match(pdf,/--B--/);
 assert.throws(()=>buildMime({from:'a@example.test',fromName:'',to:'b@example.test\r\nBcc: c@example.test',subject:'s',body:'x',attachment:null}),/line break/);});

test('settings: sender defaults to the resume profile, can be changed, and say whether Gmail is connected and which resumes exist',async()=>{
 const db=fakeDb();const s=await mailSettings(db,{outRoot,env:{}});
 assert.equal(s.fromName,'Alex Rivera');assert.equal(s.fromEmail,'alex.rivera@example.test');assert.equal(s.connected,false);assert.deepEqual(s.resumes,[{track:'software-engineer',label:'Software engineer'}]);
 await saveMailSettings(db,{fromEmail:' Other@Example.test ',about:'Data engineer, MS at a state university.',signature:'Alex'});
 const t=await mailSettings(db,{outRoot,env:{}});assert.equal(t.fromEmail,'other@example.test');assert.equal(t.signature,'Alex');
 await assert.rejects(()=>saveMailSettings(db,{fromEmail:'nope'}),/not an email/);});

test('send: goes out once, lands in history, sets the follow-up and their address; failures are errors; "maybe sent" is logged with a warning',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Dana Whit'},T);
 const ok=sender({state:'sent',messageId:'m1'});
 const r=await sendNetworkMail(db,{personId:p.id,to:'Dana@Example.test',subject:'Following up',body:'Hi Dana',resume:'software-engineer',followUp:'1w'},{sender:ok,outRoot,now:T});
 assert.equal(r.state,'sent');assert.equal(ok.sent.length,1);assert.equal(ok.sent[0].to,'dana@example.test');assert.equal(ok.sent[0].from,'alex.rivera@example.test');
 assert.equal(ok.sent[0].attachment.fileName,'Alex Rivera.pdf');assert.equal(ok.sent[0].attachment.bytes.toString(),'%PDF-1.4 general resume');
 assert.equal(r.person.email,'dana@example.test','an address used once is remembered');assert.equal(r.person.nextFollowUp,'2026-11-04');
 assert.equal(r.person.lastContact,T.toISOString());assert.deepEqual(r.person.history.map(h=>[h.type,h.text]),[['email','Following up']]);
 const bad=sender({state:'failed',error:'Gmail refused it (400: Invalid To header)'});
 await assert.rejects(()=>sendNetworkMail(db,{personId:p.id,to:'dana@example.test',subject:'s',body:'b'},{sender:bad,outRoot,now:T}),/Invalid To header/);
 const maybe=await sendNetworkMail(db,{personId:p.id,to:'dana@example.test',subject:'Again',body:'b'},{sender:sender({state:'uncertain',error:'No answer from Gmail'}),outRoot,now:T});
 assert.equal(maybe.state,'uncertain');assert.match(maybe.warning,/No answer/);assert.match(maybe.person.history.at(-1).text,/check Sent/);
 const log=[...db.cols.get('network_mail_log').values()];assert.deepEqual(log.map(l=>l.state),['sent','uncertain'],'refused mail is not logged as sent');});

test('send refuses: no person, bad address, empty subject or body, a non-PDF or huge upload, a missing resume',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Ann Lee'},T);const s=sender({state:'sent',messageId:'x'});const base={personId:p.id,to:'ann@example.test',subject:'s',body:'b'};const o={sender:s,outRoot,now:T};
 await assert.rejects(()=>sendNetworkMail(db,{...base,personId:'gone'},o),/no longer in your network/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,to:'ann'},o),/not an email/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,subject:' '},o),/Add a subject/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,body:''},o),/Write the message/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,upload:{name:'a.png',base64:Buffer.from('PNG').toString('base64')}},o),/Only PDF/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,upload:{name:'a.pdf',base64:Buffer.alloc(5_100_000,'%PDF-').toString('base64')}},o),/under 5 MB/);
 await assert.rejects(()=>sendNetworkMail(db,{...base,resume:'astronaut'},o),/not on the server/);
 const up=await sendNetworkMail(db,{...base,upload:{name:'my cv',base64:Buffer.from('%PDF-1.7 mine').toString('base64')}},o);assert.equal(up.state,'sent');assert.equal(s.sent.at(-1).attachment.fileName,'my cv.pdf');
 assert.equal(s.sent.length,1,'nothing was sent for any refused request');});

test('drafts: written in the background from their record; the request carries only given facts; failures are reported',async()=>{
 const db=fakeDb();const src=await saveSource(db,{name:'Expo Day',type:'event',about:'conference'},T);
 const ben=await savePerson(db,{name:'Ben Cart'},T);const ivy=await savePerson(db,{name:'Ivy Tan',role:'Product lead',sourceId:src.id,via:ben.id,notes:'Likes short notes'},T);
 await saveMailSettings(db,{about:'Data engineer',signature:'Alex'});
 let seen;const{id}=await startDraft(db,{personId:ivy.id,tone:'short',intent:'ask for a referral'},{generate:async r=>{seen=r;return{subject:'Quick hello',body:'Hi Ivy — great to meet.\nAlex'}},now:T});
 await new Promise(r=>setTimeout(r,20));
 const d=await draftStatus(db,id);assert.equal(d.status,'done');assert.equal(d.subject,'Quick hello');assert.equal(d.body,'Hi Ivy, great to meet.\nAlex','dashes are taken out');
 assert.match(seen.user,/Introduced by: Ben Cart/);assert.match(seen.user,/Expo Day \(event, conference\)/);assert.match(seen.user,/ask for a referral/);assert.match(seen.system,/four sentences/);assert.match(seen.system,/Never mention a product or platform called Atriveo/);
 const f=await startDraft(db,{personId:ivy.id},{generate:async()=>{throw new Error('Your Mac AI worker is offline.')},now:T});await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(await draftStatus(db,f.id),{status:'failed',subject:'',body:'',error:'Your Mac AI worker is offline.'});
 await assert.rejects(()=>draftStatus(db,'nope'),/expired/);await assert.rejects(()=>startDraft(db,{personId:'nope'},{generate:async()=>({})}),/no longer/);
 assert.match(draftRequest({person:{name:'Q',history:[]},settings:{},tone:'odd'}).system,/warm and friendly/);});
