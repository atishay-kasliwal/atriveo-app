// The page's side of the bridge to the "Apply with Atriveo" extension: messages, and a connection check that survives a sleeping service worker.
export const CHANNEL='atriveo-companion-v1';
export interface Reply {ok:boolean;panelOpened?:boolean;error?:string;counts?:Record<string,number>}
export class BridgeTimeout extends Error {}
export const NOT_ANSWERING='The Atriveo extension did not answer. If you just updated or reloaded it, refresh this page; otherwise check it is installed and enabled.';
export const OPEN_UNCONFIRMED='The extension did not confirm opening. Check your tabs before trying again.';
export function sendToExtension(action:'PING'|'OPEN'|'DOWNLOAD'|'PROFILE'|'USAGE',timeoutMs:number,extra:Record<string,unknown>={}):Promise<Reply>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new BridgeTimeout(action==='PING'?NOT_ANSWERING:OPEN_UNCONFIRMED));},timeoutMs);
  function receive(event:MessageEvent){
   if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL||event.data?.source!=='extension'||event.data.id!==id)return;
   clearTimeout(timer);window.removeEventListener('message',receive);if(event.data.ok)resolve(event.data);else reject(Error(event.data.error||'Extension unavailable'));
  }
  window.addEventListener('message',receive);window.postMessage({channel:CHANNEL,source:'workspace',id,action,...extra},location.origin);
 });
}
/** The extension was reloaded or updated, so this page's old connection to it is dead: one refresh (not a loop) gives it a fresh one. */
function reloadOnce(){try{const key='atriveo-bridge-reload',last=Number(sessionStorage.getItem(key)||0);if(Date.now()-last>60_000){sessionStorage.setItem(key,String(Date.now()));location.reload();}}catch{/* the message still tells the user to refresh */}}
let connected=false,problem='',inflight:Promise<boolean>|null=null;
export const companionIsConnected=()=>connected;
/** Why the last check failed (empty when connected); safe to show to the user. */
export const companionProblem=()=>problem;
export function markDisconnected(reason:string){connected=false;problem=reason;}
export interface CheckOptions {attempts?:number;timeoutMs?:number;gapMs?:number}
/**
 * Ping the extension until it answers: a sleeping MV3 service worker needs a moment to wake, so a single short wait is not proof.
 * Concurrent calls share one check. Resolves false (with companionProblem() set) only after every attempt failed.
 */
export function checkCompanion({attempts=3,timeoutMs=2500,gapMs=250}:CheckOptions={}):Promise<boolean>{
 if(inflight)return inflight;
 inflight=(async()=>{
  for(let i=0;i<attempts;i++){
   try{await sendToExtension('PING',timeoutMs);connected=true;problem='';return true;}
   catch(e){problem=e instanceof Error?e.message:NOT_ANSWERING;if(/Reload the Atriveo extension/.test(problem)){reloadOnce();return false;}if(i<attempts-1)await new Promise(r=>setTimeout(r,gapMs));}
  }
  connected=false;return false;
 })().finally(()=>{inflight=null;});
 return inflight;
}
