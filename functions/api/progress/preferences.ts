import {jwtVerify} from 'jose';
import {emailAllowed,isAdminSite,type AdminEnv} from '../../_lib/admin';
interface Env extends AdminEnv {JWT_SECRET:string;atriveo_auth:D1Database}
const ACCENTS=['blue','green','amber','rose'] as const;
type Accent=typeof ACCENTS[number];
interface Widget {responses:boolean;interviews:boolean;review:boolean;streak:boolean;trend:boolean;accent:Accent}
const DEFAULTS:Widget={responses:true,interviews:true,review:true,streak:true,trend:true,accent:'blue'};
const FLAGS=['responses','interviews','review','streak','trend'] as const;
async function identity(request:Request,env:Env){
 if(!isAdminSite(env))return null;
 const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
 if(!token)return null;
 try{const {payload}=await jwtVerify(token,new TextEncoder().encode(env.JWT_SECRET));return typeof payload.email==='string'&&emailAllowed(env,payload.email)?payload.email:null;}catch{return null;}
}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
/** Stored widget content, with anything missing or invalid replaced by its default. */
export function readWidget(raw:unknown):Widget{
 let stored:Record<string,unknown>={};
 try{const v=JSON.parse(String(raw||'{}'));if(v&&typeof v==='object'&&!Array.isArray(v))stored=v as Record<string,unknown>;}catch{/* defaults */}
 const out={...DEFAULTS};
 for(const f of FLAGS)if(typeof stored[f]==='boolean')out[f]=stored[f] as boolean;
 if(typeof stored.accent==='string'&&(ACCENTS as readonly string[]).includes(stored.accent))out.accent=stored.accent as Accent;
 return out;
}
/** A submitted widget object: only known flags (booleans) and a known accent; anything else is refused. */
export function parseWidget(input:unknown):Widget|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const v=input as Record<string,unknown>,out={...DEFAULTS};
 for(const f of FLAGS){if(f in v){if(typeof v[f]!=='boolean')return null;out[f]=v[f] as boolean;}}
 if('accent' in v){if(typeof v.accent!=='string'||!(ACCENTS as readonly string[]).includes(v.accent))return null;out.accent=v.accent as Accent;}
 return out;
}
export const onRequest:PagesFunction<Env>=async({request,env})=>{
 const email=await identity(request,env);if(!email)return json({error:'Unauthorized'},401);
 const row=await env.atriveo_auth.prepare('SELECT goal, prefs FROM daily_goals WHERE email = ?').bind(email).first<{goal:number;prefs:string}>();
 const current={goal:row?.goal??15,widget:readWidget(row?.prefs)};
 if(request.method==='GET')return json({...current,timeZone:'America/New_York'});
 if(request.method==='PUT'){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  let body:{goal?:unknown;widget?:unknown};try{body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  let goal=current.goal,widget=current.widget;
  if('goal' in body){if(!Number.isInteger(body.goal)||Number(body.goal)<1||Number(body.goal)>200)return json({error:'Goal must be between 1 and 200'},400);goal=Number(body.goal);}
  if('widget' in body){const next=parseWidget({...current.widget,...(body.widget as object)});if(!next)return json({error:'Unknown widget setting'},400);widget=next;}
  await env.atriveo_auth.prepare("INSERT INTO daily_goals(email,goal,prefs,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(email) DO UPDATE SET goal=excluded.goal,prefs=excluded.prefs,updated_at=excluded.updated_at").bind(email,goal,JSON.stringify(widget)).run();
  return json({goal,widget,timeZone:'America/New_York'});
 }
 return json({error:'Method not allowed'},405);
};
