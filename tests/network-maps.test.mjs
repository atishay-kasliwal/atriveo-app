import test from 'node:test';import assert from 'node:assert/strict';
import {addPeople,parseList,savePerson,saveSource,saveLink,networkView,NetworkError} from '../scripts/network.mjs';
import {saveBoardItem,boardView} from '../scripts/network-board.mjs';
import {listMaps,saveMap,removeMap,addToMap,removeFromMap,saveMapPositions,mapView,openMapFile} from '../scripts/network-maps.mjs';

// An in-memory stand-in that understands simple equality filters, which the map code uses. Every name here is invented.
const match=(d,q={})=>Object.entries(q).every(([k,v])=>d[k]===v);
const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);const clone=d=>structuredClone(d);return{
 find:(q)=>({toArray:async()=>[...m.values()].filter(d=>match(d,q)).map(clone)}),findOne:async q=>{const d=q._id!==undefined?m.get(q._id):[...m.values()].find(x=>match(x,q));return d?clone(d):null},
 insertOne:async d=>{if(m.has(d._id))throw new Error('dup');m.set(d._id,clone(d))},insertMany:async ds=>{for(const d of ds)m.set(d._id,clone(d))},
 updateOne:async(q,u,o)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...clone(u.$set)});else if(o?.upsert)m.set(q._id,{_id:q._id,...clone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const T=new Date('2026-10-28T15:00:00Z');

test('maps: My network shows everyone; a new map shows only what is put on it, with its own positions and board',async()=>{
 const db=fakeDb();
 const {added:[dana,marco],sourceId:rs}=await addPeople(db,{rows:parseList('Dana Whit\nMarco Lind'),newSource:{name:'Northwind Staffing',type:'staffing'}},T);
 const ben=await savePerson(db,{name:'Ben Carv',x:10,y:20},T);
 await db.collection('network_people').updateOne({_id:dana.id},{$set:{x:100,y:100}});
 const m=await saveMap(db,{name:'  Conference  follow-ups '},T);assert.equal(m.name,'Conference follow-ups');
 assert.deepEqual((await mapView(db,m.id)).people,[],'a new map is empty');
 await addToMap(db,{mapId:m.id,ids:[dana.id,'gone']});
 let v=await mapView(db,m.id);
 assert.deepEqual(v.people.map(p=>p.name),['Dana Whit']);assert.deepEqual(v.onMap,[rs],'her source comes along for her line');assert.equal(v.sources.length,1,'all sources still come back for the pickers');
 assert.equal(v.people[0].x,undefined,'no position on this map yet: laid out fresh');assert.deepEqual(v.map,{id:m.id,name:'Conference follow-ups'});
 await saveMapPositions(db,{mapId:m.id,items:[{id:dana.id,x:-50,y:7},{id:'you',x:5,y:5}]});
 v=await mapView(db,m.id);assert.deepEqual([v.people[0].x,v.people[0].y,v.you.x],[-50,7,5]);
 assert.equal((await networkView(db)).people.find(p=>p.id===dana.id).x,100,'My network keeps its own layout');
 await saveBoardItem(db,{kind:'note',text:'ask about Q1',mapId:m.id},T);await saveBoardItem(db,{kind:'note',text:'main note'},T);
 assert.deepEqual((await boardView(db,m.id)).items.map(i=>i.text),['ask about Q1']);assert.deepEqual((await boardView(db)).items.map(i=>i.text),['main note']);
 const list=(await listMaps(db)).maps;assert.deepEqual(list.map(x=>[x.name,x.people]),[['My network',3],['Conference follow-ups',1]]);
 await removeFromMap(db,{mapId:m.id,id:dana.id});assert.equal((await mapView(db,m.id)).people.length,0);
 await assert.rejects(()=>removeFromMap(db,{mapId:'main',id:dana.id}),NetworkError);await assert.rejects(()=>removeMap(db,{id:'main'}),NetworkError);
 const r=await removeMap(db,{id:m.id});assert.equal(r.removedBoard,1);
 assert.equal((await networkView(db)).people.length,3,'deleting a map keeps its people');assert.deepEqual((await boardView(db)).items.map(i=>i.text),['main note']);
 await assert.rejects(()=>mapView(db,m.id),/no longer exists/);void marco;void ben;
});

test('opening a saved file makes a new map: matches are reused untouched, the rest is added with its layout, links and board',async()=>{
 const db=fakeDb();
 const rs=await saveSource(db,{name:'Northwind Staffing',type:'staffing'},T);
 const dana=await savePerson(db,{name:'Dana Whit',email:'dana@example.com',role:'Recruiter',sourceId:rs.id,notes:'mine'},T);
 const file={type:'atriveo-network',version:1,you:{x:3,y:4},
  sources:[{id:'s1',name:'northwind staffing',type:'staffing',x:1,y:1},{id:'s2',name:'Open Summit',type:'event',place:'Raleigh, NC',when:'Oct 2024',viaPersonId:'p2',x:200,y:0}],
  people:[{id:'p1',name:'D. Whitlock',email:'DANA@example.com',role:'changed',notes:'theirs',x:10,y:10},{id:'p2',name:'Ben Carv',history:[{at:'2026-10-01',type:'met',text:'Met at the summit'}],x:20,y:20},{id:'p3',name:'Ivy Tran',sourceId:'s2',via:'p2',photoId:'nope',x:30,y:30}],
  links:[{a:'p1',b:'p2',kind:'works',label:'same office'},{a:'p1',b:'zz'}],
  board:[{id:'b1',kind:'note',text:'call Ben',pin:{id:'p2',dx:5,dy:5}},{id:'b2',kind:'group',ids:['p2','p3'],label:'Summit'},{id:'b3',kind:'image',imageId:'x'},{id:'b4',kind:'bogus'}]};
 const {map,summary}=await openMapFile(db,{name:'Summit export',file},T);
 assert.deepEqual(summary,{people:{added:2,matched:1},sources:{added:1,matched:1},links:1,board:2,left:1},'the image is left out (no bytes in the file); an unknown kind is ignored');
 const d=(await networkView(db)).people.find(p=>p.id===dana.id);assert.deepEqual([d.role,d.notes,d.name],['Recruiter','mine','Dana Whit'],'a match is never changed');
 const v=await mapView(db,map.id),by=n=>v.people.find(p=>p.name===n);
 assert.deepEqual(v.people.map(p=>p.name).sort(),['Ben Carv','Dana Whit','Ivy Tran']);assert.deepEqual([by('Dana Whit').x,by('Ivy Tran').y,v.you.x],[10,30,3]);
 const summit=v.sources.find(s=>s.name==='Open Summit');assert.ok(v.onMap.includes(summit.id));
 assert.deepEqual([summit.place,summit.viaPersonId],['Raleigh, NC',by('Ben Carv').id],'the source is introduced by the new Ben');
 assert.deepEqual([by('Ivy Tran').via,by('Ivy Tran').sourceId,by('Ivy Tran').photoId],[by('Ben Carv').id,summit.id,null]);
 assert.equal(by('Ben Carv').history[0].text,'Met at the summit');
 const b=(await boardView(db,map.id)).items;assert.deepEqual(b.map(i=>i.kind).sort(),['group','note']);
 assert.equal(b.find(i=>i.kind==='note').pin.id,by('Ben Carv').id);
 assert.equal((await networkView(db)).people.length,3,'My network now has the newcomers too');
 await assert.rejects(()=>openMapFile(db,{name:'x',file:{type:'excalidraw'}}),/not a saved network map/);
});
