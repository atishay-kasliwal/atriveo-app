import {spawn} from 'node:child_process';
import {cliEnvironment} from './resume-ai-provider.mjs';
export function normalizeUsage(provider,data) {
  const n=x=>Number.isSafeInteger(x)&&x>=0?x:0;
  if(!data||(!Number.isFinite(data.input_tokens)&&!Number.isFinite(data.output_tokens)))return null;
  const cached=n(data.cache_read_input_tokens??data.cached_input_tokens),created=n(data.cache_creation_input_tokens);
  const input=n(data.input_tokens)+(provider==='claude'?cached+created:0),output=n(data.output_tokens);
  return {provider,input,output,cached,total:input+output};
}
export function limitWindows(result) {
  const limits=result?.rateLimitsByLimitId||{codex:result?.rateLimits};
  return Object.entries(limits).flatMap(([id,limit])=>['primary','secondary'].flatMap(key=>{
    const w=limit?.[key];if(!w||!Number.isFinite(w.usedPercent))return [];
    return [{bucket:id,window:key,remainingPercent:Math.max(0,Math.min(100,100-w.usedPercent)),durationMinutes:w.windowDurationMins??null,resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt:null}];
  }));
}
export async function readCodexLimits() {
  return new Promise((resolve,reject)=>{
    const child=spawn('codex',['app-server'],{env:cliEnvironment(),stdio:['pipe','pipe','ignore']});let buffer='',done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGTERM');err?reject(err):resolve(value);};
    const timer=setTimeout(()=>finish(Error('Usage unavailable')),15000);
    child.on('error',()=>finish(Error('Usage unavailable')));child.on('exit',()=>{if(!done)finish(Error('Usage unavailable'));});child.stdin.on('error',()=>{});
    const send=x=>child.stdin.write(JSON.stringify(x)+'\n');
    child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>1000000)return finish(Error('Usage unavailable'));let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}if(m.id===1){if(m.error)return finish(Error('Usage unavailable'));send({method:'initialized'});send({method:'account/rateLimits/read',id:2});}if(m.id===2){if(m.error)return finish(Error('Usage unavailable'));finish(null,{windows:limitWindows(m.result),checkedAt:new Date().toISOString()});}}});
    send({method:'initialize',id:1,params:{clientInfo:{name:'atriveo_usage',version:'1.0.0'},capabilities:null}});
  });
}
export async function dashboardAiUsage(db,body={}) {
  const worker=await db.collection('resume_ai_worker').findOne({_id:'mac'});
  const sessionId=typeof body.sessionId==='string'?body.sessionId.slice(0,100):'';
  const entries=await db.collection('resume_ai_usage').find({sessionId}).toArray();
  const totals=Object.fromEntries(['claude','codex'].map(provider=>{const rows=entries.filter(e=>e.provider===provider);return [provider,{tokens:rows.reduce((n,e)=>n+e.total,0),requests:rows.length}];}));
  return {ok:true,online:Boolean(worker&&Date.now()-new Date(worker.at).getTime()<60000),codex:worker?.codexLimits||null,totals};
}
