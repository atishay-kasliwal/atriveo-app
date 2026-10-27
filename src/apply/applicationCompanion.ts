import {getTailorServerBase} from '../utils/tailorServer';
import {sendToExtension,checkCompanion,companionIsConnected,companionProblem,markDisconnected,NOT_ANSWERING,type CheckOptions} from './companionLink';
export {companionIsConnected,companionProblem,checkCompanion};
export interface CompanionJob {id:string;resumeSha256?:string|null;applyUrl:string;/** No tailored resume: use the general resume for the job's role. */general?:boolean}
interface Kit {version:1;id:string;expiresAt:string;job:{id:string;applyUrl:string};resume:{sha256:string};[key:string]:unknown}
/** How long the resume follows you after Apply (the extension keeps it within 15 s to 5 min); your choice, kept in this browser. */
export const FOLLOW_OPTIONS=[15,30,45,60,120,180,240,300] as const;
const FOLLOW_KEY='atriveo.companion.followSeconds';
export function readFollowSeconds():number{try{const n=Number(localStorage.getItem(FOLLOW_KEY));return (FOLLOW_OPTIONS as readonly number[]).includes(n)?n:60;}catch{return 60;}}
export function writeFollowSeconds(seconds:number):void{try{localStorage.setItem(FOLLOW_KEY,String(seconds));}catch{/* the choice lasts this visit */}}
const kits=new Map<string,Promise<Kit>>();
/** Thrown before anything was sent to the extension (kit could not be prepared, or it is not connected): the caller may open the job itself. */
export class CompanionNotReady extends Error {}
function request(action:'OPEN'|'DOWNLOAD',kit:Kit,followSeconds?:number){
 return sendToExtension(action,15000,{kit,followSeconds}).catch(e=>{if(e instanceof Error&&/Reload the Atriveo extension/.test(e.message))markDisconnected(e.message);throw e;});
}
const key=(job:CompanionJob)=>`${job.id}|${job.general?'general':job.resumeSha256||''}`;
export async function warmApplicationCompanion(job:CompanionJob,options?:CheckOptions):Promise<boolean>{
 if(!await checkCompanion(options))return false;
 const id=key(job);if(kits.has(id))return true;
 const promise=(async()=>{
  if(!job.general&&!job.resumeSha256)throw Error('Refresh this job to load its exact resume version.');
  const response=await fetch(`${getTailorServerBase()}/applications/application-kit`,{signal:AbortSignal.timeout(15000),method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(job.general?{jobUrl:job.id,general:true}:{jobUrl:job.id,resumeSha256:job.resumeSha256})});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'The selected resume could not be prepared.');
  if(result.kit?.job?.id!==job.id||(!job.general&&result.kit?.resume?.sha256!==job.resumeSha256))throw Error('The application kit does not match the viewed job and resume.');
  return result.kit as Kit;
 })();
 kits.set(id,promise);void promise.catch(()=>{});
 if(kits.size>3)for(const old of kits.keys()){if(old!==id){kits.delete(old);break;}}
 return true;
}
/** Save the job's exact resume through the extension: always "Atishay Kasliwal.pdf", replacing an earlier copy. */
export async function downloadWithCompanion(job:CompanionJob):Promise<void>{
 let promise=kits.get(key(job));
 if(!promise){await warmApplicationCompanion(job);promise=kits.get(key(job));}
 if(!promise)throw new CompanionNotReady(companionProblem()||NOT_ANSWERING);
 await request('DOWNLOAD',await promise);
}
export async function openWithApplicationCompanion(job:CompanionJob):Promise<{panelOpened?:boolean}>{
 let promise=kits.get(key(job));
 if(!promise){await warmApplicationCompanion(job);promise=kits.get(key(job));}
 if(!promise)throw new CompanionNotReady(companionProblem()||NOT_ANSWERING);
 let kit:Kit;try{kit=await promise;}catch(e){kits.delete(key(job));throw new CompanionNotReady(e instanceof Error?e.message:String(e));}
 if(Date.parse(kit.expiresAt)<=Date.now()){kits.delete(key(job));throw new CompanionNotReady('This resume kit expired. Click Apply again to prepare it.');}
 return request('OPEN',kit,readFollowSeconds());
}
