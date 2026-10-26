import {getTailorServerBase} from '../utils/tailorServer';
const CHANNEL='atriveo-companion-v1';
export interface CompanionJob {id:string;resumeSha256?:string|null;applyUrl:string}
interface Kit {version:1;id:string;expiresAt:string;job:{id:string;applyUrl:string};resume:{sha256:string};[key:string]:unknown}
let connected=false;
/** How long the resume follows you after Apply (the extension keeps it within 15 s to 5 min); your choice, kept in this browser. */
export const FOLLOW_OPTIONS=[15,30,45,60,120,180,240,300] as const;
const FOLLOW_KEY='atriveo.companion.followSeconds';
export function readFollowSeconds():number{try{const n=Number(localStorage.getItem(FOLLOW_KEY));return (FOLLOW_OPTIONS as readonly number[]).includes(n)?n:60;}catch{return 60;}}
export function writeFollowSeconds(seconds:number):void{try{localStorage.setItem(FOLLOW_KEY,String(seconds));}catch{/* the choice lasts this visit */}}
const kits=new Map<string,Promise<Kit>>();
function request(action:'PING'|'OPEN'|'DOWNLOAD',kit?:Kit,followSeconds?:number):Promise<{ok:boolean;panelOpened?:boolean;error?:string}>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timeout=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(Error(action==='PING'?'Companion not connected':'The extension did not confirm opening. Check your tabs before trying again.'));},action==='PING'?700:15000);
  function receive(event:MessageEvent){
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL||event.data?.source!=='extension'||event.data.id!==id)return;
   clearTimeout(timeout);window.removeEventListener('message',receive);event.data.ok?resolve(event.data):reject(Error(event.data.error||'Extension unavailable'));
  }
  window.addEventListener('message',receive);window.postMessage({channel:CHANNEL,source:'workspace',id,action,kit,followSeconds},location.origin);
 });
}
const key=(job:CompanionJob)=>`${job.id}|${job.resumeSha256||''}`;
export async function warmApplicationCompanion(job:CompanionJob):Promise<boolean>{
 try {await request('PING');connected=true;}catch{connected=false;return false;}
 const id=key(job);if(kits.has(id))return true;
 const promise=(async()=>{
  if(!job.resumeSha256)throw Error('Refresh this job to load its exact resume version.');
  const response=await fetch(`${getTailorServerBase()}/applications/application-kit`,{signal:AbortSignal.timeout(15000),method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobUrl:job.id,resumeSha256:job.resumeSha256})});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'The selected resume could not be prepared.');
  if(result.kit?.resume?.sha256!==job.resumeSha256||result.kit.job?.id!==job.id)throw Error('The application kit does not match the viewed job and resume.');
  return result.kit as Kit;
 })();
 kits.set(id,promise);void promise.catch(()=>{});
 if(kits.size>3)for(const old of kits.keys()){if(old!==id){kits.delete(old);break;}}
 return true;
}
export function companionIsConnected():boolean{return connected;}
/** Save the job's exact resume through the extension: always "Atishay Kasliwal.pdf", replacing an earlier copy. */
export async function downloadWithCompanion(job:CompanionJob):Promise<void>{
 let promise=kits.get(key(job));
 if(!promise){await warmApplicationCompanion(job);promise=kits.get(key(job));}
 if(!promise)throw Error('Companion not connected');
 await request('DOWNLOAD',await promise);
}
export async function openWithApplicationCompanion(job:CompanionJob):Promise<{panelOpened?:boolean}>{
 let promise=kits.get(key(job));
 if(!promise){await warmApplicationCompanion(job);promise=kits.get(key(job));}
 if(!promise)throw Error('Reload the extension and the matching workspace to connect them.');
 let kit:Kit;try{kit=await promise;}catch(e){kits.delete(key(job));throw e;}
 if(Date.parse(kit.expiresAt)<=Date.now()){kits.delete(key(job));throw Error('This resume kit expired. Click Apply again to prepare it.');}
 return request('OPEN',kit,readFollowSeconds());
}
