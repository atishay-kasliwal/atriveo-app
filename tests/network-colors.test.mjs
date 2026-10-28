import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';

// The Network colour rule and its wording helpers, bundled from the page's own module.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nwc-'));const out=path.join(dir,'network.mjs');
await build({entryPoints:[path.resolve('src/apply/network.ts')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const {colorsFor,PALETTE,followUp,ago,plusDays,initials}=await import(out);
const src=(id,at,color=null)=>({id,name:id,type:'company',about:'',color,createdAt:at});
const person=(id,f={})=>({id,name:id,sourceId:null,via:null,color:null,...f});

test('a source keeps its colour, and every first connection from it shares it; adding a newer source changes nobody',()=>{
 const data={sources:[src('rs','2026-10-01'),src('fam','2026-10-02')],links:[],people:[person('a',{sourceId:'rs'}),person('b',{sourceId:'rs'}),person('c',{sourceId:'fam'}),person('d')]};
 const c=colorsFor(data);
 assert.equal(c.source.get('rs'),PALETTE[0]);assert.equal(c.person.get('a'),c.source.get('rs'));assert.equal(c.person.get('b'),c.source.get('rs'));
 assert.equal(c.person.get('c'),c.source.get('fam'));assert.notEqual(c.source.get('rs'),c.source.get('fam'));
 assert.equal(c.person.get('d'),'#8a919c','no source: neutral');
 const later=colorsFor({...data,sources:[...data.sources,src('ev','2026-10-03')]});
 assert.equal(later.source.get('rs'),c.source.get('rs'));assert.equal(later.source.get('fam'),c.source.get('fam'));});

test('someone introduced starts a branch: a colour of their own, never close to any source colour; your own picks win',()=>{
 const sources=[src('rs','1'),src('fam','2'),src('ev','3')];
 const people=Array.from({length:30},(_,i)=>person('p'+i,{sourceId:'rs',via:'x'}));
 const c=colorsFor({sources,links:[],people});const used=[...c.source.values()];
 for(const p of people)assert.ok(!used.includes(c.person.get(p.id)),'not a source colour');
 assert.deepEqual([...new Set(people.map(p=>c.person.get(p.id)))].sort(),['#2dd4bf','#34d399','#a78bfa'],'pink-magenta and amber-orange pairs are left out');
 const mine=colorsFor({sources:[src('rs','1','#123456')],links:[],people:[person('a',{sourceId:'rs'}),person('b',{sourceId:'rs',color:'#abcdef'})]});
 assert.equal(mine.source.get('rs'),'#123456');assert.equal(mine.person.get('a'),'#123456');assert.equal(mine.person.get('b'),'#abcdef');
 const same=colorsFor({sources:[src('a','1',PALETTE[0]),src('b','2')],links:[],people:[]});assert.notEqual(same.source.get('b'),PALETTE[0],'a colour someone picked is not handed out again');});

test('wording: follow-up due or late, last contact, quick dates, initials',()=>{
 assert.equal(followUp(null),null);assert.deepEqual(followUp(plusDays(0)),{text:'today',due:true});
 assert.deepEqual(followUp(plusDays(-2)),{text:'2 days late',due:true});assert.deepEqual(followUp(plusDays(1)),{text:'tomorrow',due:false});
 assert.deepEqual(followUp(plusDays(7)),{text:'in 7 days',due:false});
 assert.equal(ago(null),'never');assert.equal(ago(new Date().toISOString()),'today');assert.equal(ago(new Date(Date.now()-3*864e5).toISOString()),'3 days ago');
 assert.equal(ago(new Date(Date.now()-21*864e5).toISOString()),'3 weeks ago');
 assert.equal(initials('Dana  Whitlock'),'DW');assert.equal(initials('  '),'?');});

test('layout: saved spots win; new people fan out around their source without two cards overlapping, even a list of 40',async()=>{
 const {autoLayout}=await import(out);
 const overlap=(a,b)=>Math.abs(a.x-b.x)<196+8&&Math.abs(a.y-b.y)<52+8;
 for(const n of [1,2,3,5,8,9,15,40])for(const angle of [0,1,2,3,4,5]){
  const sources=Array.from({length:6},(_,i)=>src('s'+i,String(i)));
  const people=Array.from({length:n},(_,i)=>person('p'+i,{sourceId:'s'+angle}));
  const pos=autoLayout({sources,links:[],people});
  const pts=people.map(p=>pos.get(p.id));
  for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)assert.ok(!overlap(pts[i],pts[j]),`${n} people around source ${angle}: cards ${i} and ${j} overlap`);
 }
 const saved=autoLayout({sources:[{...src('s','1'),x:10,y:20}],links:[],people:[person('a',{sourceId:'s',x:5,y:6})],you:{x:-3,y:4}});
 assert.deepEqual(saved.get('s'),{x:10,y:20});assert.deepEqual(saved.get('a'),{x:5,y:6});assert.deepEqual(saved.get('you'),{x:-3,y:4});
 const chain=autoLayout({sources:[src('s','1')],links:[],people:[person('a',{sourceId:'s'}),person('b',{sourceId:'s',via:'a'}),person('c',{sourceId:'s',via:'b'})]});
 const d=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);assert.ok(d(chain.get('b'),chain.get('a'))<260&&d(chain.get('c'),chain.get('b'))<260,'each introduction sits next to who made it');});
