import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inboxSummary} from '../scripts/applications-analytics.mjs';

test('employer stages remain separate from receipt counts and appear in recent/review',()=>{
 const rows=['applied','assessment','interview','offer','rejected'].map((kind,i)=>({_id:String(i),receivedAt:`2026-10-${20+i}T12:00:00Z`,kind,state:kind==='interview'?'needs_confirm':'updated',subject:kind,companies:['Example'],titles:['Engineer'],match:{reason:'Choose a role',candidates:['a']}}));
 const summary=inboxSummary(rows,[{_id:'a',company:'Example',title:'Engineer'}]);
 assert.equal(summary.confirmed,1);assert.equal(summary.rejected,1);
 for(const kind of ['assessment','interview','offer'])assert.equal(summary[kind],1);
 assert.equal(summary.recent.length,5);assert.equal(summary.confirm.length,1);
 assert.equal(summary.confirm[0].kind,'interview');assert.equal(summary.confirm[0].target,'engine');
 assert.equal(summary.confirm[0].candidates[0].id,'a');
 const dismissed=inboxSummary(rows.map(e=>({...e,state:'dismissed'})),[]);
 assert.equal(dismissed.confirmed,0);assert.equal(dismissed.offer,0);assert.equal(dismissed.recent.length,0);
});
