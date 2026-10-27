import {jwtVerify} from 'jose';
import {emailAllowed,isAdminSite,type AdminEnv} from '../_lib/admin';
interface Env extends AdminEnv {JWT_SECRET:string;atriveo_auth:D1Database}
const TZ='America/New_York';
const KEY=/^[a-z0-9_.-]{1,60}$/;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function identity(request:Request,env:Env){
 if(!isAdminSite(env))return null;
 const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
 if(!token)return null;
 try{const {payload}=await jwtVerify(token,new TextEncoder().encode(env.JWT_SECRET));return typeof payload.email==='string'&&emailAllowed(env,payload.email)?payload.email:null;}catch{return null;}
}
const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
export const nyDay=(ms:number)=>dayFmt.format(ms);
export interface UsageItem {kind:'page'|'action';key:string;seconds:number;count:number}
/** A submitted batch: only known kinds, plain keys and small non-negative whole numbers. Anything else refuses the whole batch. */
export function parseUsage(input:unknown):UsageItem[]|null{
 const items=(input as {items?:unknown})?.items;
 if(!Array.isArray(items)||items.length>80)return null;
 const out:UsageItem[]=[];
 for(const raw of items){
  if(!raw||typeof raw!=='object')return null;
  const {kind,key,seconds=0,count=0}=raw as Record<string,unknown>;
  if((kind!=='page'&&kind!=='action')||typeof key!=='string'||!KEY.test(key))return null;
  if(!Number.isInteger(seconds)||!Number.isInteger(count)||(seconds as number)<0||(count as number)<0||(seconds as number)>600||(count as number)>500)return null;
  if(!seconds&&!count)continue;
  out.push({kind,key,seconds:seconds as number,count:count as number});
 }
 return out;
}
/** The first day included in a range, as a New York calendar day. */
export function rangeStart(range:string,now=Date.now()):string{
 const back=(n:number)=>nyDay(now-n*86400000);
 return range==='today'?back(0):range==='yesterday'?back(1):range==='7d'?back(6):range==='30d'?back(29):'0000-00-00';
}
export const onRequest:PagesFunction<Env>=async({request,env})=>{
 const email=await identity(request,env);if(!email)return json({error:'Unauthorized'},401);
 if(request.method==='POST'){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  let body:unknown;try{body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  const items=parseUsage(body);if(!items)return json({error:'Invalid usage batch'},400);
  const day=nyDay(Date.now());
  if(items.length)await env.atriveo_auth.batch(items.map(i=>env.atriveo_auth.prepare("INSERT INTO usage_daily(email,day,kind,key,seconds,count,updated_at) VALUES(?,?,?,?,?,?,datetime('now')) ON CONFLICT(email,day,kind,key) DO UPDATE SET seconds=seconds+excluded.seconds,count=count+excluded.count,updated_at=excluded.updated_at").bind(email,day,i.kind,i.key,i.seconds,i.count)));
  return json({ok:true,saved:items.length});
 }
 if(request.method==='GET'){
  const range=new URL(request.url).searchParams.get('range')||'7d';
  const from=rangeStart(range);
  const rows=(await env.atriveo_auth.prepare('SELECT kind,key,SUM(seconds) AS seconds,SUM(count) AS count,COUNT(DISTINCT day) AS days,MAX(day) AS last FROM usage_daily WHERE email = ? AND day >= ? GROUP BY kind,key').bind(email,from).all<{kind:string;key:string;seconds:number;count:number;days:number;last:string}>()).results??[];
  const first=await env.atriveo_auth.prepare('SELECT MIN(day) AS since FROM usage_daily WHERE email = ?').bind(email).first<{since:string|null}>();
  return json({range,from:from==='0000-00-00'?null:from,since:first?.since??null,today:nyDay(Date.now()),rows});
 }
 return json({error:'Method not allowed'},405);
};
