import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { subscriptionGenerate } from './resume-ai-provider.mjs';
const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.playatriveo','resume-ai-worker.json'),'utf8'));
let stopped=false;process.on('SIGTERM',()=>stopped=true);process.on('SIGINT',()=>stopped=true);
async function call(op,body={}) {
  const r=await fetch(`${config.base}/resume-builder/${op}`,{method:'POST',headers:{'X-Tailor-Token':config.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error('AI worker relay unavailable');return d;
}
console.log('Mac subscription AI worker started.');
while(!stopped){
  try {
    const {job}=await call('ai-worker-claim');
    if(job){
      let completion;
      const heartbeat=setInterval(()=>void call('ai-worker-claim',{heartbeatOnly:true}).catch(()=>{}),15000);
      try{completion={id:job.id,result:await subscriptionGenerate(job.provider,job.request)};}catch(e){completion={id:job.id,error:e.message};}finally{clearInterval(heartbeat);}
      await call('ai-worker-complete',completion);
      console.log(completion.error?'AI request failed.':'AI request completed.');
    }
  }catch{console.log('Waiting for the secure server relay.');}
  await new Promise(r=>setTimeout(r,3000));
}
