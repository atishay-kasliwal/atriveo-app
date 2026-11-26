import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';
import {SignJWT} from 'jose';

// Settings → Where I am, saved by the preferences API (bundled, a fake request, an in-memory D1) beside the goal and widget.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prefs-place-'));
const out=path.join(dir,'prefs.mjs');
await build({entryPoints:[path.resolve('functions/api/progress/preferences.ts')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const api=await import(out);
const env0={JWT_SECRET:'x'.repeat(40),SITE:'apply',ADMIN_EMAILS:'me@example.test'};
const session=email=>new SignJWT({email,name:'Me'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(env0.JWT_SECRET));
function fakeD1(seed){let row=seed??null;const q=(sql,args=[])=>({bind:(...a)=>q(sql,a),
 async first(){return row;},async run(){const [,goal,prefs]=args;row={goal,prefs};return {};}});
 return {get row(){return row;},prepare:sql=>q(sql)};}
const call=async(method,body,d1)=>{const headers={cookie:`atriveo_token=${await session('me@example.test')}`,'content-type':'application/json'};
 return api.onRequest({request:new Request('https://apply.atriveo.com/api/progress/preferences',{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env:{...env0,atriveo_auth:d1}});};

test('with nothing saved, the place is WA, IL, MI with remote on',async()=>{
 const body=await (await call('GET',null,fakeD1())).json();
 assert.deepEqual(body.place,{states:['WA','IL','MI'],remote:true});
});
test('saving the place keeps the goal and widget, and saving those keeps the place',async()=>{
 const d1=fakeD1({goal:20,prefs:JSON.stringify({responses:false,accent:'green'})});
 const saved=await (await call('PUT',{place:{states:['ny','WA'],remote:false}},d1)).json();
 assert.deepEqual(saved.place,{states:['NY','WA'],remote:false});
 assert.equal(saved.goal,20);assert.equal(saved.widget.responses,false);assert.equal(saved.widget.accent,'green');
 await call('PUT',{goal:12,widget:{trend:false}},d1);
 const body=await (await call('GET',null,d1)).json();
 assert.equal(body.goal,12);assert.equal(body.widget.trend,false);assert.equal(body.widget.accent,'green');
 assert.deepEqual(body.place,{states:['NY','WA'],remote:false},'the goal save did not drop the place');
});
test('an unknown state is refused and nothing changes',async()=>{
 const d1=fakeD1({goal:15,prefs:JSON.stringify({place:{states:['IL'],remote:true}})});
 const res=await call('PUT',{place:{states:['IL','ZZ']}},d1);
 assert.equal(res.status,400);
 assert.deepEqual((await (await call('GET',null,d1)).json()).place,{states:['IL'],remote:true});
});
