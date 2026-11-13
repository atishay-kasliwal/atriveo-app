import test from 'node:test';import assert from 'node:assert/strict';
import {addPeople,previewList,previewContacts,savePerson,saveSource,networkView,autoFollowUp,isUntouchedMapOnly,logHistory} from '../scripts/network.mjs';
import {reminders} from '../scripts/network-reminders.mjs';
import {knownCompanies} from '../scripts/network-jobs.mjs';

// People kept off My network (an event's speaker list) must not leak into My network's duplicate checks, reminders or "you know someone here". Invented names.
const match=(d,q={})=>Object.entries(q).every(([k,v])=>d[k]===v);
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:(q)=>({toArray:async()=>[...m.values()].filter(d=>match(d,q)).map(clone)}),findOne:async q=>{const d=q._id!==undefined?m.get(q._id):[...m.values()].find(x=>match(x,q));return d?clone(d):null},
 insertOne:async d=>{if(m.has(d._id))throw new Error('dup');m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...clone(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...clone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-30T15:00:00Z');
const setup=async()=>{
 const db=fakeDb();
 const ev=await saveSource(db,{name:'Event 2026',type:'event'},T);
 const cold=await savePerson(db,{name:'Dana Whit',company:'Northwind',sourceId:ev.id,tags:['Cold']},T);
 const met=await savePerson(db,{name:'Marco Lind',company:'Contoso',sourceId:ev.id},T);
 await logHistory(db,{id:met.id,type:'met',text:'Spoke at the booth'},T);
 for(const id of [cold.id,met.id]) await db.collection('network_people').updateOne({_id:id},{$set:{mapOnly:'map-1'}});
 await db.collection('network_sources').updateOne({_id:ev.id},{$set:{mapOnly:'map-1'}});
 return {db,ev,cold,met};
};

test('a map-only person you have not contacted gets no weekly follow-up and no "never heard from you"; once contacted they behave like anyone',async()=>{
 const {db,ev}=await setup();
 const people=await db.collection('network_people').find({}).toArray();
 const mapped=people.map(({_id,...p})=>({id:_id,...p})),sources=[{id:ev.id,name:'Event 2026',type:'event',createdAt:'2026-10-01T00:00:00.000Z'}];
 const cold=mapped.find(p=>p.name==='Dana Whit'),met=mapped.find(p=>p.name==='Marco Lind');
 assert.equal(isUntouchedMapOnly(cold),true);assert.equal(isUntouchedMapOnly(met),false);
 assert.equal(autoFollowUp(cold,sources),null,'no automatic follow-up for a cold list entry');
 assert.ok(autoFollowUp(met,sources),'someone you met still gets one');
 const week=reminders({people:mapped,sources},{today:'2026-11-06'});
 assert.deepEqual(week.map(r=>r.title),['Follow up with Marco Lind'],'only the person you met; no flood, no "never heard from you"');
 assert.equal(isUntouchedMapOnly({name:'Ordinary',lastContact:null,history:[]}),false,'people on My network are untouched by the rule');
});

test('names that are only on a map do not count as already in your network',async()=>{
 const {db}=await setup();
 assert.deepEqual((await networkView(db)).people,[],'My network has nobody');
 assert.equal((await previewList(db,'Dana Whit'))[0].exists,false);
 const r=await addPeople(db,{rows:[{name:'Dana Whit'}]},T);
 assert.deepEqual([r.added.length,r.skipped.length],[1,0],'she can be added to My network');
 await db.collection('network_people').updateOne({_id:(await db.collection('network_people').find({}).toArray()).find(p=>p.name==='Dana Whit'&&!p.mapOnly)._id},{$set:{email:'dana@example.org'}});
 assert.equal((await previewContacts(db,'Name,Email Address\nMarco Lind,\nDana Whit,dana@example.org')).rows.map(x=>x.exists).join(),'false,true','a real duplicate is still caught');
});

test('"you know someone here" counts people you have been in touch with, not a speaker list',async()=>{
 const {db}=await setup();
 await savePerson(db,{name:'My Friend',company:'Fabrikam'},T);
 const known=(await knownCompanies(db)).map(c=>c.name).sort();
 assert.deepEqual(known,['Contoso','Fabrikam'],'Contoso (met) and Fabrikam (friend); Northwind (cold speaker) is left out');
});
