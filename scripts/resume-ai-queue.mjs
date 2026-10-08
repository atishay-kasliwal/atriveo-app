import crypto from 'node:crypto';
export async function queueInference(db,provider,request) {
  const worker=await db.collection('resume_ai_worker').findOne({_id:'mac'});
  if(!worker||Date.now()-new Date(worker.at).getTime()>60000)throw Error('Your Mac AI worker is offline. Wake your Mac and reconnect it, then retry.');
  if(request.parentJobId)await db.collection('resume_ai_jobs').updateOne({_id:request.parentJobId},{$set:{stage:request.purpose==='verify'?'checking':'queued',updatedAt:new Date()}});
  const id=crypto.randomUUID(),now=new Date();
  await db.collection('resume_ai_inference').insertOne({_id:id,status:'queued',provider,request,sessionId:typeof request.sessionId==='string'?request.sessionId.slice(0,100):'',createdAt:now,expiresAt:new Date(Date.now()+240000)});
  while(Date.now()-now.getTime()<240000){
    await new Promise(r=>setTimeout(r,1000));
    const row=await db.collection('resume_ai_inference').findOne({_id:id});
    if(row?.status==='done') { await db.collection('resume_ai_inference').deleteOne({_id:id});return row.result; }
    if(row?.status==='failed') { await db.collection('resume_ai_inference').deleteOne({_id:id});throw Error(row.error||'Subscription request failed'); }
  }
  await db.collection('resume_ai_inference').deleteOne({_id:id});throw Error('Mac AI worker timed out. Retry.');
}
export async function claimInference(db,body={}) {
  await db.collection('resume_ai_worker').updateOne({_id:'mac'},{$set:{at:new Date(),...(body.codexLimits?{codexLimits:body.codexLimits}:{})}},{upsert:true});
  if(body.heartbeatOnly)return {ok:true,job:null};
  const row=await db.collection('resume_ai_inference').findOneAndUpdate({status:'queued',expiresAt:{$gt:new Date()}},{$set:{status:'running'}},{sort:{createdAt:1},returnDocument:'after'});
  if(row?.request?.parentJobId)await db.collection('resume_ai_jobs').updateOne({_id:row.request.parentJobId},{$set:{stage:row.request.purpose==='verify'?'verifying':'thinking',updatedAt:new Date()}});
  return {ok:true,job:row?{id:row._id,provider:row.provider,request:row.request}:null};
}
export async function completeInference(db,body) {
  if(!body.id)throw Error('Missing inference job');
  const job=await db.collection('resume_ai_inference').findOne({_id:body.id,status:'running'});
  if(job&&Array.isArray(body.usage)){for(const [index,item] of body.usage.entries()){if(['claude','codex'].includes(item.provider)&&['input','output','cached','total'].every(k=>Number.isSafeInteger(item[k])&&item[k]>=0))await db.collection('resume_ai_usage').updateOne({_id:body.id+':'+index},{$setOnInsert:{...item,sessionId:job.sessionId||'',createdAt:new Date(),expiresAt:new Date(Date.now()+30*86400000)}},{upsert:true});}}
  const r=await db.collection('resume_ai_inference').updateOne({_id:body.id,status:'running'},{$set:{status:body.error?'failed':'done',...(body.error?{error:String(body.error).slice(0,500)}:{result:body.result})},$unset:{request:''}});
  return {ok:true,recorded:Boolean(r.matchedCount)};
}
