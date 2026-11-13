import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';

// The Network colour rule and its wording helpers, bundled from the page's own module.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nwc-'));const out=path.join(dir,'network.mjs');
await build({entryPoints:[path.resolve('src/apply/network.ts')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const {branchOf,peopleForSource,organisationInitials,colorsFor,PALETTE,followUp,ago,plusDays,initials,sourceLabel,edgesFor,autoLayout,placeCells,warmPath,withAutoCompanies}=await import(out);
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

test('warm path: the fewest steps from you, through sources and people; none when there is no way; work progress',async()=>{
 const {warmPath,edgesFor,colorsFor,workProgress}=await import(out);
 const data={sources:[src('ev','1'),src('nw','2')],links:[{id:'l1',a:'ben',b:'nw',kind:'works',label:'works at',color:null}],people:[person('ben',{sourceId:'ev'}),person('ivy',{sourceId:'ev',via:'ben'}),person('kofi',{sourceId:'nw'}),person('lone')]};
 const edges=edgesFor(data,colorsFor(data));
 assert.deepEqual(warmPath(edges,'kofi').nodes,['you','nw','kofi'],'you reached the source directly');
 assert.deepEqual(warmPath(edges,'ivy').nodes,['you','ev','ben','ivy']);
 const cut=edges.filter(e=>!(e.a==='you'&&e.b==='nw'));assert.deepEqual(warmPath(cut,'kofi').nodes,['you','ev','ben','nw','kofi'],'through Ben, who works there');
 assert.equal(warmPath(cut.filter(e=>e.kind!=='works'&&!(e.a==='nw')),'kofi'),null);assert.equal(warmPath(edges,'you'),null);
 const w=workProgress({start:'2026-10-12',end:'2026-11-30'},'2026-10-28');assert.deepEqual([w.day,w.total,w.left,w.ending,w.late],[16,49,33,false,false]);
 assert.equal(workProgress({start:'2026-10-18',end:'2026-11-04'},'2026-10-28').ending,true);assert.equal(workProgress({start:'2026-10-01',end:'2026-10-20'},'2026-10-28').late,true);
 assert.equal(workProgress({start:'2026-10-01',end:'2026-10-20',done:true},'2026-10-28').late,false);});


test('introduced source contexts have their own nodes, labels and paths without merging same-name sources',()=>{
 const sources=[{...src('event','2026-01-01'),name:'Open Summit',type:'event'}, {...src('direct','2026-01-02'),name:'Northwind',type:'staffing',context:'Reached out last year'}, {...src('at-event','2026-01-03'),name:'Northwind',type:'staffing',parentSourceId:'event'}];
 const data={sources,people:[],links:[]};const colors=colorsFor(data),edges=edgesFor(data,colors),positions=autoLayout(data);
 assert.equal(sourceLabel(sources[1],sources),'Northwind · Reached out last year');assert.equal(sourceLabel(sources[2],sources),'Northwind · via Open Summit');
 assert.deepEqual(warmPath(edges,'direct').nodes,['you','direct']);assert.deepEqual(warmPath(edges,'at-event').nodes,['you','event','at-event']);
 assert.ok(edges.some(e=>e.a==='event'&&e.b==='at-event'&&e.kind==='intro'));
 assert.notDeepEqual(positions.get('direct'),positions.get('at-event'));assert.notEqual(colors.source.get('direct'),colors.source.get('at-event'));
 sources[2].x=123;sources[2].y=456;assert.deepEqual(autoLayout(data).get('at-event'),{x:123,y:456});
});

test('a source introduced by a person: the line runs from that person, the source sits near them, its own people hang off the source, and paths go through them',async()=>{
 const {autoLayout,edgesFor,colorsFor,warmPath,sourceLabel}=await import(out);
 const fam={...src('fam','1'),type:'family'},nkhs={...src('nkhs','2'),viaPersonId:'chani'};
 const data={sources:[fam,nkhs],links:[],people:[person('chani',{sourceId:'fam'}),person('a',{sourceId:'nkhs'}),person('b',{sourceId:'nkhs'}),person('c',{sourceId:'nkhs'}),person('d',{sourceId:'nkhs',via:'chani'})]};
 const edges=edgesFor(data,colorsFor(data));
 const e=edges.find(x=>x.b==='nkhs');assert.deepEqual([e.a,e.kind,e.label],['chani','via','introduced']);assert.ok(!edges.some(x=>x.a==='you'&&x.b==='nkhs'),'not straight from you');
 for(const p of ['a','b','c'])assert.deepEqual(edges.filter(x=>x.b===p).map(x=>[x.a,x.kind]),[['nkhs','belongs']],'the company\'s own people, not through Chani');
 assert.deepEqual(edges.filter(x=>x.b==='d').map(x=>x.a),['chani'],'one came through Chani herself');
 const pos=autoLayout(data),d=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
 assert.ok(d(pos.get('nkhs'),pos.get('chani'))<=320,'next to Chani');assert.ok(['a','b','c'].every(id=>d(pos.get(id),pos.get('nkhs'))<=420),'its people around it');
 assert.deepEqual(warmPath(edges,'a').nodes,['you','fam','chani','nkhs','a']);
 assert.equal(sourceLabel(nkhs,data.sources,[{id:'chani',name:'Chani Jain'}]),'nkhs · via Chani Jain');
 const gone=edgesFor({...data,people:data.people.filter(p=>p.id!=='chani')},colorsFor(data));assert.equal(gone.find(x=>x.b==='nkhs').a,'you','if Chani is archived, the source comes straight from you again');});

test('introduced by two people: a line from each, and everyone else keeps their own line',async()=>{
 const {edgesFor,colorsFor}=await import(out);
 const data={sources:[src('s','1')],links:[],people:[person('a',{sourceId:'s'}),person('b',{sourceId:'s'}),person('c',{sourceId:'s',via:'a',alsoVia:['b','a']}),person('d',{sourceId:'s'})]};
 const e=edgesFor(data,colorsFor(data));
 assert.deepEqual(e.filter(x=>x.b==='c').map(x=>[x.a,x.label]),[['a','introduced'],['b','also introduced']]);
 for(const id of ['a','b','d'])assert.deepEqual(e.filter(x=>x.b===id).map(x=>x.kind),['belongs']);});

test('met at one place, works at another: a faint "works at" line to the company card, colour and place still from where you met',async()=>{
 const {edgesFor,colorsFor,warmPath}=await import(out);
 const data={sources:[{...src('ato','1'),type:'event'},{...src('rs','2'),name:'Randstad',type:'company'}],links:[],people:[person('el',{sourceId:'ato',company:'Randstad USA'}),person('dana',{sourceId:'rs',company:'Randstad'}),person('x',{sourceId:'ato',company:'Elsewhere'})]};
 const c=colorsFor(data),e=edgesFor(data,c);
 assert.deepEqual(e.filter(x=>x.b==='el').map(x=>[x.a,x.kind,x.label]),[['ato','belongs','first connection'],['rs','employer','works at']]);
 assert.equal(c.person.get('el'),c.source.get('ato'),'colour from where you met');
 assert.deepEqual(e.filter(x=>x.b==='dana').map(x=>x.kind),['belongs'],'met at the company itself: no second line');
 assert.deepEqual(e.filter(x=>x.b==='x').map(x=>x.kind),['belongs'],'no card for where they work: nothing extra');
 assert.deepEqual(warmPath(e,'rs').nodes,['you','rs']);});

test('two people at the same company nobody added: a company card joins the map, linked to both, and goes when a real card exists',()=>{
 const people=[person('dana',{sourceId:'ato',company:'Randstad USA'}),person('priya',{sourceId:'fam',company:'randstad inc.'}),person('solo',{company:'Acme Corp'}),person('ben',{sourceId:'ato'})];
 const data={sources:[src('ato','2026-10-01'),src('fam','2026-10-02')],links:[],people};
 const m=withAutoCompanies(data),auto=m.sources.filter(s=>s.auto);
 assert.deepEqual(auto.map(s=>[s.name,s.type,s.auto]),[['Randstad USA','company',['dana','priya']]]);
 const colors=colorsFor(m);assert.deepEqual([colors.person.get('dana'),colors.person.get('priya')],[colors.source.get('ato'),colors.source.get('fam')]);
 assert.deepEqual(colorsFor(data).source,new Map([...colors.source].filter(([id])=>!id.startsWith('auto:'))),'adding it changes no colour');
 const e=edgesFor(m,colors),id=auto[0].id;
 assert.equal(e.some(x=>x.b===id&&x.a==='you'),false,'it does not hang off you');
 assert.deepEqual(e.filter(x=>x.a===id).map(x=>[x.b,x.kind]),[['dana','employer'],['priya','employer']]);
 const pos=autoLayout(m);assert.ok(pos.has(id));
 assert.deepEqual(warmPath(e.filter(x=>x.key!=='src-priya'),'priya').nodes,['you','ato','dana',id,'priya']);
 const real={...data,sources:[...data.sources,{...src('rs','2026-10-03'),name:'Randstad'}]};
 assert.equal(withAutoCompanies(real).sources.some(s=>s.auto),false);
});

test('a source reached more than once: the main line carries its year, and each other introducer (person or source) gets an "also introduced" line',()=>{
 const rh={...src('rh','2026-10-03'),name:'Red Hat',viaPersonId:'uncle',introYear:'2024',alsoVia:[{id:'ato',year:'2026'},{id:'gone',year:''},{id:'rh',year:''}]};
 const data={sources:[src('ato','2026-10-01'),rh],links:[],people:[person('uncle')]};
 const e=edgesFor(data,colorsFor(data)).filter(x=>x.b==='rh');
 assert.deepEqual(e.map(x=>[x.a,x.kind,x.label]),[['uncle','via','introduced · 2024'],['ato','intro','also introduced · 2026']]);
 assert.deepEqual(warmPath(edgesFor(data,colorsFor(data)).filter(x=>x.key!=='source-rh'),'rh').nodes,['you','ato','rh']);
});

test('suggested companies sit near a person even when coworkers are on opposite sides of the map',()=>{
 const data=withAutoCompanies({sources:[],links:[],people:[person('a',{company:'Orchid',x:-2000,y:800}),person('b',{company:'Orchid',x:2000,y:-800})]});
 const positions=autoLayout(data),company=positions.get(data.sources[0].id);
 assert.ok(data.people.some(p=>Math.hypot(company.x-p.x,company.y-p.y)<325));
});


test('source cards include introduced people, matching employers and explicit work links once', () => {
 const company={...src('company','1'),name:'Fidelity'};
 const data={sources:[company, {...src('event','2'),type:'event'}],links:[{a:'linked',b:'company',kind:'works'},{a:'company',b:'direct',kind:'works'}],people:[
  person('direct',{sourceId:'company',company:'Fidelity Investments'}),
  person('introduced',{sourceId:'company',via:'direct'}),
  person('coworker',{sourceId:'event',company:'Fidelity Investments'}),
  person('linked'),person('unrelated',{sourceId:'event',company:'Other'})]};
 assert.deepEqual(peopleForSource(company,data).map(p=>p.id),['direct','introduced','coworker','linked']);
 assert.deepEqual(peopleForSource(data.sources[1],data).map(p=>p.id),['coworker','unrelated']);
 assert.deepEqual(peopleForSource({...company,id:'auto',name:'Other',auto:['linked','unrelated','missing']},data).map(p=>p.id),['linked','unrelated']);
 assert.equal(peopleForSource({...company,id:'empty',name:'Unconnected'},data).length,0);
});

test('organisation fallback has two letters for single and multiword names', () => {
 assert.equal(organisationInitials('Fidelity'),'FI');
 assert.equal(organisationInitials('Randstad'),'RA');
 assert.equal(organisationInitials('Fidelity Investments'),'FI');
 assert.equal(organisationInitials('  Northstar   Labs '),'NL');
 assert.equal(organisationInitials(''),'?' );
});

test('dragging a card brings its branch: a source its people and the sources under it, all the way down; a person their introductions',()=>{
 const data={sources:[src('li','1'),{...src('d28','2'),parentSourceId:'li'},{...src('d29','3'),parentSourceId:'li'},{...src('nkhs','4'),viaPersonId:'chani'},src('fam','5'),{...src('co','6'),auto:['x','y']}],
  people:[person('ann',{sourceId:'d28'}),person('ben',{sourceId:'d29'}),person('cy',{sourceId:'d29',via:'ben'}),person('chani',{sourceId:'fam'}),person('dev',{sourceId:'nkhs'}),person('eve',{sourceId:'fam',via:'gone'}),person('li-direct',{sourceId:'li'})]};
 assert.deepEqual(branchOf('li',data).sort(),['ann','ben','cy','d28','d29','li-direct']);
 assert.deepEqual(branchOf('d29',data).sort(),['ben','cy'],'cy hangs off Ben, who is in this day');
 assert.deepEqual(branchOf('fam',data).sort(),['chani','dev','eve','nkhs'],'Chani brought NKHS and its people; Eve\'s introducer is gone, so she hangs off the source');
 assert.deepEqual(branchOf('ann',data),[]);assert.deepEqual(branchOf('co',data),[],'an automatic company card carries nothing');
});

test('an event with many employers lays out as a grid of cells: each employer with its people beside it, nothing overlapping',()=>{
 const sources=[{...src('ev','2026-10-01'),type:'event'},...Array.from({length:60},(_,i)=>({...src('co'+i,'2026-10-02'),parentSourceId:'ev'}))];
 const people=[];for(let i=0;i<60;i++)for(let k=0;k<(i%4===0?3:1);k++)people.push(person(`p${i}-${k}`,{sourceId:'co'+i}));
 const pos=autoLayout({sources,people,links:[]});
 for(const s of sources)assert.ok(pos.has(s.id));for(const p of people)assert.ok(pos.has(p.id));
 const near=(a,b)=>Math.abs(pos.get(a).x-pos.get(b).x)<196+24&&Math.abs(pos.get(a).y-pos.get(b).y)<52+18;
 const ids=[...sources.slice(1).map(s=>s.id),...people.map(p=>p.id)];
 let overlaps=0;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)if(near(ids[i],ids[j]))overlaps++;
 assert.equal(overlaps,0,'no two cards overlap');
 const p0=pos.get('p0-0'),c0=pos.get('co0');assert.ok(p0.x>c0.x&&Math.abs(p0.y-c0.y)<5,'the first person sits right beside their employer');
 const xs=ids.map(i=>pos.get(i).x),ys=ids.map(i=>pos.get(i).y);assert.ok((Math.max(...xs)-Math.min(...xs))/(Math.max(...ys)-Math.min(...ys))<4,'a block, not one long strip');
});
