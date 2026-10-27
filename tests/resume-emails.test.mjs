import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

// A worker's own profile file, as it ships baked into its container, and a fake app_settings collection.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'emails-'));process.env.RESUME_PROFILE_PATH=path.join(dir,'resume-profile.json');
fs.writeFileSync(process.env.RESUME_PROFILE_PATH,JSON.stringify({name:'Alex Rivera',email:'old@example.test'}));
const {getResumeEmails,changeResumeEmails,syncDefaultEmail,forgetEmailSync,cleanEmail}=await import('../scripts/resume-emails.mjs');
const {loadResumeProfile}=await import('../scripts/resume-profile.mjs');
const fakeDb=()=>{const docs=new Map();return {docs,collection:()=>({findOne:async q=>docs.get(q._id)??null,updateOne:async(q,u)=>{docs.set(q._id,{...(docs.get(q._id)??{_id:q._id}),...u.$set});}})};};
const A='one@example.test',B='two@example.test',C='three@example.test';

test('nothing is chosen at first: an empty list, no default, and builds keep their own email',async()=>{
 const db=fakeDb();assert.deepEqual(await getResumeEmails(db),{list:[],default:null});
 forgetEmailSync();assert.deepEqual(await syncDefaultEmail(db,{force:true}),{default:null,changed:false});assert.equal(loadResumeProfile().email,'old@example.test');});

test('add keeps an address, default also chooses it, remove forgets it (and un-defaults it); lists are tidy',async()=>{
 const db=fakeDb();
 assert.deepEqual(await changeResumeEmails(db,{action:'add',email:' One@Example.test '}),{list:[A],default:null});
 await changeResumeEmails(db,{action:'add',email:A});assert.deepEqual((await getResumeEmails(db)).list,[A],'no duplicates');
 assert.deepEqual(await changeResumeEmails(db,{action:'default',email:B}),{list:[A,B],default:B},'a default is added to the list');
 await changeResumeEmails(db,{action:'default',email:A});assert.equal((await getResumeEmails(db)).default,A);
 assert.deepEqual(await changeResumeEmails(db,{action:'remove',email:A}),{list:[B],default:null});
 await assert.rejects(()=>changeResumeEmails(db,{action:'add',email:'nope'}),/not an email/);
 await assert.rejects(()=>changeResumeEmails(db,{action:'wipe',email:A}),/Unknown action/);
 for(let i=0;i<7;i++)await changeResumeEmails(db,{action:'add',email:`p${i}@example.test`});assert.equal((await getResumeEmails(db)).list.length,8,'one kept plus seven added');
 await assert.rejects(()=>changeResumeEmails(db,{action:'add',email:'extra@example.test'}),/can keep 8/);
 assert.equal(cleanEmail('x@y'),null);assert.equal(cleanEmail(' A@B.CO '),'a@b.co');});

test('a build in another container picks up the chosen default: its own old email is replaced, then left alone',async()=>{
 const db=fakeDb();await changeResumeEmails(db,{action:'default',email:C});
 forgetEmailSync();assert.deepEqual(await syncDefaultEmail(db,{force:true}),{default:C,changed:true});
 assert.equal(loadResumeProfile().email,C);assert.equal(loadResumeProfile().name,'Alex Rivera','only the email changes');
 assert.equal(JSON.parse(fs.readFileSync(process.env.RESUME_PROFILE_PATH,'utf8')).email,C,'written to the profile file the builders read');
 forgetEmailSync();assert.equal((await syncDefaultEmail(db,{force:true})).changed,false,'already the default: nothing is rewritten');
 // the choice changes later; within 20 seconds the remembered answer is used, after that (or forced) the new one
 await changeResumeEmails(db,{action:'default',email:B});
 assert.equal((await syncDefaultEmail(db,{now:Date.now()+1000})).default,C,'remembered for 20 s');
 assert.equal((await syncDefaultEmail(db,{now:Date.now()+30000})).default,B);assert.equal(loadResumeProfile().email,B);});

test('removing the default leaves builds on whatever their profile already has',async()=>{
 const db=fakeDb();await changeResumeEmails(db,{action:'default',email:A});forgetEmailSync();await syncDefaultEmail(db,{force:true});
 await changeResumeEmails(db,{action:'remove',email:A});forgetEmailSync();
 assert.deepEqual(await syncDefaultEmail(db,{force:true}),{default:null,changed:false});assert.equal(loadResumeProfile().email,A);});
