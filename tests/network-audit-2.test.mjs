import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nwaud-'));process.env.RESUME_PROFILE_PATH=path.join(dir,'p.json');fs.writeFileSync(process.env.RESUME_PROFILE_PATH,JSON.stringify({name:'Alex Rivera',email:'alex.rivera@example.test'}));
const {savePerson,saveSource,logHistory,removeHistory,removeSource,networkView}=await import('../scripts/network.mjs');
const {openMapFile,saveMap,addToMap}=await import('../scripts/network-maps.mjs');
const {sendNetworkMail}=await import('../scripts/network-mail.mjs');

// An in-memory stand-in whose updateOne honours an `updatedAt` condition the way Mongo does (matchedCount 0 when it no longer matches). Invented data.
const match=(d,q={})=>Object.entries(q).every(([k,v])=>d[k]===v);
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:(q)=>({toArray:async()=>[...m.values()].filter(d=>match(d,q)).map(clone)}),findOne:async q=>{const d=q._id!==undefined?m.get(q._id):[...m.values()].find(x=>match(x,q));return d?clone(d):null},
 insertOne:async d=>{m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{const d=m.get(q._id);if(d&&match(d,q)){m.set(q._id,{...d,...clone(u.$set)});return{matchedCount:1}}if(!d&&o?.upsert){m.set(q._id,{_id:q._id,...clone(u.$set)});return{matchedCount:0,upsertedCount:1}}return{matchedCount:0}},
 deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col}};
const T=new Date('2026-10-30T15:00:00Z'),at=ms=>new Date(T.getTime()+ms);

test('two notes saved at the same moment both survive',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Dana Whit'},T);
 await Promise.all([logHistory(db,{id:p.id,type:'note',text:'first'},at(1)),logHistory(db,{id:p.id,type:'note',text:'second'},at(2)),logHistory(db,{id:p.id,type:'email',text:'third'},at(3))]);
 const h=(await db.collection('network_people').findOne({_id:p.id})).history.map(x=>x.text).sort();
 assert.deepEqual(h,['first','second','third']);
 const left=await removeHistory(db,{id:p.id,entryId:(await db.collection('network_people').findOne({_id:p.id})).history[0].id},at(9));
 assert.equal(left.history.length,2);
});

test('contact cannot be dated in the future, a note can be anything',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Dana Whit'},T);
 await assert.rejects(()=>logHistory(db,{id:p.id,type:'email',text:'x',at:'2027-03-01T00:00:00Z'},T),/future/);
 await logHistory(db,{id:p.id,type:'note',text:'remember',at:'2027-03-01T00:00:00Z'},T);
 const r=await logHistory(db,{id:p.id,type:'met',text:'booth',at:'2026-10-20T12:00:00Z'},T);assert.equal(r.lastContact,'2026-10-20T12:00:00.000Z');
});

test('removing a source takes its logo, its place on maps and "also introduced by" with it',async()=>{
 const db=fakeDb();
 await db.collection('network_images').insertOne({_id:'logo1',type:'image/png',bytes:'AA',size:2});
 const a=await saveSource(db,{name:'Northwind',type:'company'},T);await db.collection('network_sources').updateOne({_id:a.id},{$set:{photoId:'logo1'}});
 const b=await saveSource(db,{name:'Contoso',type:'company',alsoVia:[{id:a.id,year:'2025'}]},T);
 const map=await saveMap(db,{name:'M'},T);await addToMap(db,{mapId:map.id,ids:[a.id]});
 await removeSource(db,{id:a.id},T);
 assert.equal(await db.collection('network_images').findOne({_id:'logo1'}),null,'the logo bytes are gone');
 assert.deepEqual(await db.collection('network_map_cards').find({}).toArray(),[],'its place on the map is gone');
 assert.deepEqual((await db.collection('network_sources').findOne({_id:b.id})).alsoVia,[],'nothing points at it any more');
});

test('opening a file does not merge two people who only share a name',async()=>{
 const db=fakeDb();
 const mine=await savePerson(db,{name:'Dana Whit',company:'Northwind'},T);
 const file={type:'atriveo-network',version:1,sources:[],links:[],board:[],people:[{id:'a',name:'Dana Whit',company:'Contoso'},{id:'b',name:'Marco Lind',company:'Contoso'},{id:'c',name:'Dana Whit',company:'Northwind'}]};
 const r=await openMapFile(db,{name:'Event',file},T);
 assert.deepEqual([r.summary.people.added,r.summary.people.matched],[2,1],'the Dana at Contoso is new; the Dana at Northwind is you existing one');
 assert.equal((await networkView(db)).people.filter(p=>p.name==='Dana Whit').length,2);void mine;
});

test('the same email to the same person within a minute is sent once; a different subject, or later, is fine',async()=>{
 const db=fakeDb();const p=await savePerson(db,{name:'Dana Whit',email:'dana@example.test'},T);
 const sent=[];const sender={send:async e=>{sent.push(e);return{state:'sent',messageId:'m'+sent.length}}};
 const mail=(subject,when)=>sendNetworkMail(db,{personId:p.id,to:'dana@example.test',subject,body:'Hi Dana'},{sender,outRoot:dir,now:when});
 await mail('Following up',T);
 await assert.rejects(()=>mail('Following up',at(5_000)),/just sent/);
 assert.equal(sent.length,1,'the double click sent nothing');
 await mail('A different subject',at(6_000));await mail('Following up',at(120_000));
 assert.equal(sent.length,3);
});
