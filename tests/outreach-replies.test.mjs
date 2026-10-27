import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {outreachReplies} from '../scripts/outreach/replies.mjs';
import {createOutreachRoutes} from '../scripts/outreach/routes.mjs';

const fakeDb=docs=>({collection:()=>({find:(q,o)=>({sort:()=>({limit:n=>({toArray:async()=>docs.filter(d=>d.reply).sort((a,b)=>b.reply.at.localeCompare(a.reply.at)).slice(0,n).map(d=>({_id:d._id,reply:d.reply}))})})})})});

test('replies are a map of record id to when and a short subject, newest first, and only records that have one',async()=>{
 const r=await outreachReplies(fakeDb([{_id:'a',reply:{at:'2026-10-26T10:00:00Z',subject:'Re: your application'}},{_id:'b'},{_id:'c',reply:{at:'2026-10-27T09:00:00Z',subject:'x'.repeat(300)}}]));
 assert.deepEqual(Object.keys(r),['c','a']);assert.equal(r.a.subject,'Re: your application');assert.equal(r.c.subject.length,120);assert.deepEqual(Object.keys(r.a),['at','subject'],'no message text leaves');});

test('the replies route answers only your own sites, and an empty map when nothing feeds it',async t=>{
 const serve=async replies=>{const handler=createOutreachRoutes(async()=>({}),async()=>({}),async()=>({}),replies);const server=http.createServer((q,s)=>void handler(q,s,new URL(q.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}/outreach/replies`;};
 const withData=await serve(async()=>({d1:{at:'2026-10-27T09:00:00Z',subject:'Re: hello'}}));
 assert.deepEqual((await (await fetch(withData)).json()),{ok:true,replies:{d1:{at:'2026-10-27T09:00:00Z',subject:'Re: hello'}}});
 assert.equal((await fetch(withData,{headers:{Origin:'https://attacker.com'}})).status,403);
 assert.equal((await fetch(withData,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404,'it cannot be written to');
 assert.deepEqual((await (await fetch(await serve(null))).json()),{ok:true,replies:{}});});
