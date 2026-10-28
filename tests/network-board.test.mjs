import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {boardView,saveBoardItem,removeBoardItem,saveImage,readImage} from '../scripts/network-board.mjs';
import {handleNetwork} from '../scripts/network-routes.mjs';

const fakeDb=()=>{const cols=new Map();const col=n=>{if(!cols.has(n))cols.set(n,new Map());const m=cols.get(n);return{
 find:()=>({toArray:async()=>[...m.values()].map(d=>structuredClone(d))}),findOne:async q=>m.has(q._id)?structuredClone(m.get(q._id)):null,
 insertOne:async d=>{m.set(d._id,structuredClone(d))},updateOne:async(q,u)=>{if(m.has(q._id))m.set(q._id,{...m.get(q._id),...structuredClone(u.$set)})},deleteOne:async q=>({deletedCount:m.delete(q._id)?1:0})}};return{collection:col,cols}};
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('rest')]);
const GIF=Buffer.from('GIF89a....');

test('notes, text boxes and strokes: defaults, partial changes, pins, and limits',async()=>{
 const db=fakeDb();
 const note=await saveBoardItem(db,{kind:'note',x:10,y:20,text:'Ask Dana\r\nabout roles'});
 assert.deepEqual([note.w,note.h,note.color,note.text,note.pin],[190,150,'#fbbf24','Ask Dana\nabout roles',null]);
 const moved=await saveBoardItem(db,{id:note.id,x:99,pin:{id:'p1',dx:-20,dy:40}});assert.equal(moved.x,99);assert.equal(moved.y,20,'y kept');assert.deepEqual(moved.pin,{id:'p1',dx:-20,dy:40});
 assert.equal((await saveBoardItem(db,{id:note.id,pin:null})).pin,null);
 const s=await saveBoardItem(db,{kind:'stroke',points:[[0,0],[5.04,5],[9e9,1]],color:'#F87171',width:8,opacity:.35});
 assert.deepEqual(s.points,[[0,0],[5,5],[100000,1]]);assert.equal(s.color,'#f87171');assert.equal(s.width,8);assert.equal(s.opacity,0.35);
 assert.equal((await saveBoardItem(db,{kind:'stroke',points:[[1,1]]})).color,'ink','default pen colour follows the theme');
 await assert.rejects(()=>saveBoardItem(db,{kind:'stroke',points:[]}),/1 to 4000 points/);
 await assert.rejects(()=>saveBoardItem(db,{kind:'note',color:'yellow'}),/colour/);
 await assert.rejects(()=>saveBoardItem(db,{kind:'balloon'}),/Pick text, note/);
 await assert.rejects(()=>saveBoardItem(db,{kind:'note',x:'left'}),/must be a number/);
 const t=await saveBoardItem(db,{kind:'text',x:0,y:0,text:'x'.repeat(6000)});assert.equal(t.text.length,5000);assert.equal(t.w,230);
 assert.deepEqual((await boardView(db)).items.map(i=>i.kind),['note','stroke','stroke','text']);
 await removeBoardItem(db,{id:t.id});await assert.rejects(()=>removeBoardItem(db,{id:t.id}),/no longer on the board/);});

test('images: checked by their bytes, size-limited, served back, and removed with their board item',async()=>{
 const db=fakeDb();
 const {id}=await saveImage(db,{type:'image/png',base64:PNG.toString('base64')});
 assert.equal((await readImage(db,id)).bytes.equals(PNG),true);
 assert.ok((await saveImage(db,{type:'image/gif',base64:GIF.toString('base64')})).id);
 await assert.rejects(()=>saveImage(db,{type:'image/gif',base64:PNG.toString('base64')}),/not the kind of image/);
 await assert.rejects(()=>saveImage(db,{type:'image/svg+xml',base64:'PHN2Zz4='}),/PNG, JPEG, GIF or WebP/);
 await assert.rejects(()=>saveImage(db,{type:'image/png',base64:Buffer.alloc(2_600_000).toString('base64')}),/under 2.5 MB/);
 await assert.rejects(()=>saveBoardItem(db,{kind:'image',imageId:'nope'}),/Upload the image first/);
 const item=await saveBoardItem(db,{kind:'image',imageId:id,x:1,y:2,w:240,h:160});
 await removeBoardItem(db,{id:item.id});await assert.rejects(()=>readImage(db,id),/gone/);});

test('routes: the board list, an image served with its own type and long cache, a missing image is a 404',async()=>{
 const db=fakeDb();const {id}=await saveImage(db,{type:'image/png',base64:PNG.toString('base64')});
 const call=async(method,path,body)=>{const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;
  const res={headers:{},writeHead(c,h){this.code=c;Object.assign(this.headers,h||{})},end(b){this.body=b}};await handleNetwork(req,res,new URL(path,'http://x'),{withDb:fn=>fn(db)});return res};
 const img=await call('GET',`/network/image?id=${id}`);assert.equal(img.code,200);assert.equal(img.headers['Content-Type'],'image/png');assert.match(img.headers['Cache-Control'],/immutable/);assert.ok(Buffer.from(img.body).equals(PNG));
 assert.equal((await call('GET','/network/image?id=zzz')).code,404);
 const saved=await call('POST','/network/board/save',{kind:'note',x:1,y:1});assert.equal(saved.code,200);
 const list=JSON.parse((await call('GET','/network/board')).body);assert.equal(list.items.length,1);});
