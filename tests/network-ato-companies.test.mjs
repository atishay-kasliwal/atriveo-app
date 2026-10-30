import test from 'node:test';import assert from 'node:assert/strict';
import {savePerson,saveSource,networkView} from '../scripts/network.mjs';
import {saveMap,mapView,listMaps,openMapFile,addToMap} from '../scripts/network-maps.mjs';
import {planAtoCompanies,colorAt,colorsFor} from '../scripts/network-ato-companies.mjs';

// An in-memory stand-in for the Mongo calls the network code makes. Every name here is invented.
const match=(d,q={})=>Object.entries(q).every(([k,v])=>d[k]===v);
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:(q)=>({toArray:async()=>[...m.values()].filter(d=>match(d,q)).map(clone)}),findOne:async q=>{const d=q._id!==undefined?m.get(q._id):[...m.values()].find(x=>match(x,q));return d?clone(d):null},
 insertOne:async d=>{if(m.has(d._id))throw new Error('dup');m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...clone(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...clone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-30T15:00:00Z');

test('ATO people move from the event card onto their employer\'s card, each employer with its own colour',async()=>{
 const db=fakeDb();
 const map=await saveMap(db,{name:'ATO 2026'},T);
 const mine=await saveSource(db,{name:'Contoso',type:'company'},T),self=await savePerson(db,{name:'My Friend',company:'Contoso',sourceId:mine.id},T);
 const ato=await saveSource(db,{name:'All Things Open 2026',type:'event',color:'#f87171'},T);
 const north=await saveSource(db,{name:'Northwind',type:'company',parentSourceId:ato.id,about:'Hiring at ATO: Engineer'},T);
 const a=await savePerson(db,{name:'Dana Whit',company:'Northwind',sourceId:ato.id,tags:['ATO 2026','Cold']},T);
 const b=await savePerson(db,{name:'Marco Lind',company:'Contoso',sourceId:ato.id,tags:['ATO 2026']},T);
 const c=await savePerson(db,{name:'Ben Carv',company:'',sourceId:ato.id,tags:['ATO 2026']},T);
 const other=await savePerson(db,{name:'Not Atoo',company:'Contoso',sourceId:ato.id,tags:[]},T);
 await addToMap(db,{mapId:map.id,ids:[ato.id,north.id,a.id,b.id,c.id]}); // what opening the file did
 const dry=await planAtoCompanies(db,{},T);
 assert.deepEqual([dry.people,dry.moved,dry.created.sort()],[3,3,['Contoso','Independent']],'your own parentless Contoso is not reused');
 assert.equal((await networkView(db)).people.find(p=>p.id===a.id).sourceId,ato.id,'a dry run changes nothing');
 const done=await planAtoCompanies(db,{apply:true},T);assert.equal(done.moved,3);
 const v=await mapView(db,map.id),src=n=>v.sources.find(s=>s.name===n&&s.parentSourceId===ato.id);
 assert.equal(v.people.find(p=>p.id===a.id).sourceId,north.id,'an existing company card is reused');
 assert.equal(v.people.find(p=>p.id===b.id).sourceId,src('Contoso').id);assert.equal(v.people.find(p=>p.id===c.id).sourceId,src('Independent').id);
 assert.equal(v.people.find(p=>p.id===other.id),undefined,'people without the ATO tag were never on that map');
 const home=await networkView(db);
 assert.deepEqual(home.people.map(p=>p.name).sort(),['My Friend','Not Atoo'],'My network keeps your own people and drops the ATO ones');
 assert.deepEqual(home.sources.map(s=>s.name).sort(),['Contoso'],'and only your own sources');
 assert.equal(home.sources[0].id,mine.id);assert.equal(home.people.find(p=>p.name==='My Friend').sourceId,mine.id,'your own Contoso card is untouched');
 assert.equal((await listMaps(db)).maps[0].people,2,'the My network count drops the ATO people');
 assert.equal(v.people.length,3,'the ATO map still has all three');
 assert.equal(src('Contoso').parentSourceId,ato.id);
 const colors=['Northwind','Contoso','Independent'].map(n=>v.sources.find(s=>s.name===n&&s.parentSourceId===ato.id).color);
 assert.equal(new Set(colors).size,3,'one colour each');assert.ok(!colors.includes('#f87171'),'none is the event card colour');
 const again0=await planAtoCompanies(db,{apply:true},T);void again0;
 const again=await planAtoCompanies(db,{apply:true},T);assert.deepEqual([again.moved,again.created.length,again.recolored],[0,0,0],'running again changes nothing');
 assert.notEqual(colorAt(0),colorAt(1));
 const many=colorsFor(150,'#f87171');assert.equal(new Set(many).size,150,'150 companies, 150 colours');
});

test('opening a file with "keep off My network" adds its people and sources to that map only; matched ones are reused as they are',async()=>{
 const db=fakeDb();
 const mine=await saveSource(db,{name:'Northwind',type:'company'},T);const known=await savePerson(db,{name:'Dana Whit',sourceId:mine.id},T);
 const file={type:'atriveo-network',version:1,sources:[{id:'e',name:'Event',type:'event'},{id:'c',name:'Fabrikam',type:'company',parentSourceId:'e'}],
  people:[{id:'p1',name:'Dana Whit',sourceId:'e'},{id:'p2',name:'Marco Lind',sourceId:'c'}],links:[],board:[]};
 const r=await openMapFile(db,{name:'Event 2026',file,separate:true},T);
 assert.equal(r.separate,true);assert.deepEqual([r.summary.people.added,r.summary.people.matched],[1,1]);
 const home=await networkView(db);assert.deepEqual(home.people.map(p=>p.name),['Dana Whit'],'only the person you already had');assert.deepEqual(home.sources.map(s=>s.name),['Northwind']);
 assert.equal(home.people[0].sourceId,mine.id,'and she is exactly as she was');
 const m=await mapView(db,r.map.id);assert.deepEqual(m.people.map(p=>p.name).sort(),['Dana Whit','Marco Lind']);assert.equal(m.sources.filter(s=>s.mapOnly===r.map.id).length,2);
 const plain=await openMapFile(db,{name:'Open one',file:{...file,people:[{id:'p3',name:'Zed New',sourceId:'e'}],sources:[]}},T);
 assert.equal(plain.separate,false);assert.ok((await networkView(db)).people.some(p=>p.name==='Zed New'),'without the option, new people join My network as before');
 const flagged=await openMapFile(db,{name:'File says so',file:{...file,separate:true,people:[{id:'p4',name:'Ann Flagged',sourceId:'e'}],sources:[]}},T);
 assert.equal(flagged.separate,true,'a file can ask to be kept off My network itself');void addToMap;
});

test('the same employer spelled several ways gets one card, and cards the file put under the event with nobody on them go off My network too',async()=>{
 const db=fakeDb();
 const map=await saveMap(db,{name:'ATO 2026 network map'},T);
 const ato=await saveSource(db,{name:'All Things Open 2026',type:'event'},T);
 const quiet=await saveSource(db,{name:'Quiet Hiring Co',type:'company',parentSourceId:ato.id,about:'Hiring at ATO: Engineer'},T);
 const ids=[ato.id,quiet.id];
 for(const [n,c] of [['A One','AWS'],['B Two','Amazon Web Services'],['C Three','Amazon / Linux TV'],['D Four','Google Cloud'],['E Five','Google'],['F Six','CISSP / VCSO (independent security leadership)'],['G Seven','']]) ids.push((await savePerson(db,{name:n,company:c,sourceId:ato.id,tags:['ATO 2026']},T)).id);
 await addToMap(db,{mapId:map.id,ids});
 const plan=await planAtoCompanies(db,{apply:true,map:'ATO 2026 network map'},T);
 assert.deepEqual(plan.created.sort(),['Amazon','Google','Independent'],'three employers, not seven');
 const home=await networkView(db);assert.deepEqual([home.people.length,home.sources.length],[0,0],'nothing from the file is left on My network, including the quiet company');
 const v=await mapView(db,map.id);assert.equal(v.people.length,7);
 const amazon=v.sources.find(s=>s.name==='Amazon');assert.equal(v.people.filter(p=>p.sourceId===amazon.id).length,3);
 assert.ok(v.sources.some(s=>s.name==='Quiet Hiring Co'),'and it is still on the map');
});
