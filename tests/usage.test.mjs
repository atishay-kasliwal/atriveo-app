import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';
import {SignJWT} from 'jose';

// The usage API (bundled and run with a fake request and an in-memory D1) and the registry that decides what gets counted.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-'));
const bundle=async(entry,name)=>{const out=path.join(dir,`${name}.mjs`);await build({entryPoints:[path.resolve(entry)],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});return import(out);};
const api=await bundle('functions/api/usage.ts','api'),reg=await bundle('src/apply/usage.ts','reg');
const env0={JWT_SECRET:'x'.repeat(40),SITE:'apply',ADMIN_EMAILS:'me@example.test'};
const session=email=>new SignJWT({email,name:'Me'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(env0.JWT_SECRET));
function fakeD1(){const rows=new Map();const q=(sql,args=[])=>({bind:(...a)=>q(sql,a),
 async run(){return this.runSync();},runSync(){const [email,day,kind,key,seconds,count]=args;const id=[email,day,kind,key].join('|');const r=rows.get(id)??{email,day,kind,key,seconds:0,count:0};r.seconds+=seconds;r.count+=count;rows.set(id,r);return {};},
 async all(){const [email,from]=args;const g=new Map();for(const r of rows.values()){if(r.email!==email||r.day<from)continue;const k=r.kind+'|'+r.key;const x=g.get(k)??{kind:r.kind,key:r.key,seconds:0,count:0,days:new Set(),last:''};x.seconds+=r.seconds;x.count+=r.count;x.days.add(r.day);if(r.day>x.last)x.last=r.day;g.set(k,x);}return {results:[...g.values()].map(x=>({...x,days:x.days.size}))};},
 async first(){const [email]=args;const d=[...rows.values()].filter(r=>r.email===email).map(r=>r.day).sort();return {since:d[0]??null};}});
 return {rows,prepare:sql=>q(sql),async batch(stmts){for(const s of stmts)s.runSync();return [];}};}
const call=async(method,body,{email='me@example.test',url='https://apply.atriveo.com/api/usage',d1}={})=>{const headers={cookie:email?`atriveo_token=${await session(email)}`:'','content-type':'application/json'};return api.onRequest({request:new Request(url,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env:{...env0,atriveo_auth:d1}});};

test('only a signed-in admin can record or read usage',async()=>{const d1=fakeD1();
 assert.equal((await call('POST',{items:[]},{email:'',d1})).status,401);assert.equal((await call('GET',null,{email:'',d1})).status,401);
 assert.equal((await call('POST',{items:[]},{email:'stranger@example.test',d1})).status,401);});
test('a batch is added to the New York day and summed across batches',async()=>{const d1=fakeD1();
 const item=(kind,key,seconds,count)=>({kind,key,seconds,count});
 assert.equal((await call('POST',{items:[item('page','matching',30,1),item('action','matching.apply',0,2)]},{d1})).status,200);
 assert.equal((await call('POST',{items:[item('page','matching',45,0),item('action','matching.apply',0,1)]},{d1})).status,200);
 const body=await (await call('GET',null,{d1,url:'https://apply.atriveo.com/api/usage?range=7d'})).json();
 const row=k=>body.rows.find(r=>r.key===k);
 assert.equal(row('matching').seconds,75);assert.equal(row('matching').count,1);assert.equal(row('matching.apply').count,3);
 assert.equal(body.since,body.today);});
test('anything that is not plain counts is refused',async()=>{const d1=fakeD1();const bad=[
 {items:[{kind:'page',key:'Matching Page',seconds:1}]},{items:[{kind:'page',key:'x',seconds:-1}]},{items:[{kind:'page',key:'x',seconds:9999}]},{items:[{kind:'text',key:'x',count:1}]},
 {items:[{kind:'page',key:'x',seconds:1.5}]},{items:[{kind:'page',key:'company-'.repeat(20)}]},{items:'nope'},{items:Array.from({length:81},()=>({kind:'page',key:'x',count:1}))},{}];
 for(const b of bad)assert.equal((await call('POST',b,{d1})).status,400,JSON.stringify(b).slice(0,50));
 assert.equal(d1.rows.size,0);});
test('range starts are New York calendar days',()=>{const now=Date.parse('2026-10-27T03:00:00Z');// still Oct 26 in New York
 assert.equal(api.rangeStart('today',now),'2026-10-26');assert.equal(api.rangeStart('yesterday',now),'2026-10-25');assert.equal(api.rangeStart('7d',now),'2026-10-20');assert.equal(api.rangeStart('30d',now),'2026-09-27');assert.equal(api.rangeStart('all',now),'0000-00-00');});
test('pages and features are told apart by route and button label, and unknown labels are never counted',()=>{
 assert.equal(reg.pageIdOf('/job-matching'),'matching');assert.equal(reg.pageIdOf('/applied/a%3A2'),'applied');assert.equal(reg.pageIdOf('/'),'today');assert.equal(reg.pageIdOf('/general/'),'general');
 assert.equal(reg.featureForClick('matching','apply ↗'),'matching.apply');assert.equal(reg.featureForClick('matching','not apply n'),'matching.skip');
 assert.equal(reg.featureForClick('general','skip stripe'),'general.skip');assert.equal(reg.featureForClick('general','apply ↗'),'general.apply');
 assert.equal(reg.featureForClick('matching','northwind labs'),null,'a company name matches nothing');assert.equal(reg.featureForClick('today','apply'),null,'features belong to their own page');
 assert.equal(reg.featureForKey('matching','S'),'matching.shortcuts');assert.equal(reg.featureForKey('general','s'),null);
 assert.equal(new Set(reg.FEATURES.map(f=>f.key)).size,reg.FEATURES.length,'feature keys are unique');
 for(const f of reg.FEATURES)assert.ok(/^[a-z0-9_.-]{1,60}$/.test(f.key),f.key);});
