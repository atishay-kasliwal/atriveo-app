import test from 'node:test';
import assert from 'node:assert/strict';
// A fake page: window.postMessage delivers to listeners; `behave` plays the extension's bridge.
function page(behave){
 const listeners=new Set(),win={
  addEventListener:(t,f)=>t==='message'&&listeners.add(f),removeEventListener:(t,f)=>listeners.delete(f),
  postMessage(data){if(data.source!=='workspace')return;const reply=behave(data);if(reply)setTimeout(()=>{for(const f of [...listeners])f({source:win,origin:'https://x.test',data:{channel:'atriveo-companion-v1',source:'extension',id:data.id,...reply}});},0);},
 };
 globalThis.window=win;globalThis.location={origin:'https://x.test'};
}
const load=()=>import(`../src/apply/companionLink.ts?${Math.random()}`);
test('connects on a later attempt after the service worker was asleep',async()=>{
 let pings=0;page(()=>++pings>=3?{ok:true}:null);
 const {checkCompanion,companionIsConnected}=await load();
 assert.equal(await checkCompanion({attempts:3,timeoutMs:30,gapMs:1}),true);
 assert.equal(pings,3);assert.equal(companionIsConnected(),true);
});
test('fails after every attempt and says why',async()=>{
 let pings=0;page(()=>{pings++;return null;});
 const {checkCompanion,companionIsConnected,companionProblem}=await load();
 assert.equal(await checkCompanion({attempts:3,timeoutMs:20,gapMs:1}),false);
 assert.equal(pings,3);assert.equal(companionIsConnected(),false);assert.match(companionProblem(),/did not answer/);
});
test('a dead content script reply is surfaced as the problem',async()=>{
 page(()=>({ok:false,error:'Reload the Atriveo extension and this page.'}));
 const {checkCompanion,companionProblem}=await load();
 assert.equal(await checkCompanion({attempts:2,timeoutMs:50,gapMs:1}),false);
 assert.equal(companionProblem(),'Reload the Atriveo extension and this page.');
});
test('concurrent checks share one ping series',async()=>{
 let pings=0;page(()=>{pings++;return {ok:true};});
 const {checkCompanion}=await load();
 await Promise.all([checkCompanion(),checkCompanion(),checkCompanion()]);
 assert.equal(pings,1);
});
