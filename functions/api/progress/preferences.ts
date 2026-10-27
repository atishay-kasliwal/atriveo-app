import {jwtVerify} from 'jose';
import {emailAllowed,isAdminSite,type AdminEnv} from '../../_lib/admin';
interface Env extends AdminEnv {JWT_SECRET:string;atriveo_auth:D1Database}
async function identity(request:Request,env:Env){
 if(!isAdminSite(env))return null;
 const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
 if(!token)return null;
 try{const {payload}=await jwtVerify(token,new TextEncoder().encode(env.JWT_SECRET));return typeof payload.email==='string'&&emailAllowed(env,payload.email)?payload.email:null;}catch{return null;}
}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const onRequest:PagesFunction<Env>=async({request,env})=>{
 const email=await identity(request,env);if(!email)return json({error:'Unauthorized'},401);
 if(request.method==='GET'){
  const row=await env.atriveo_auth.prepare('SELECT goal FROM daily_goals WHERE email = ?').bind(email).first<{goal:number}>();
  return json({goal:row?.goal??15,timeZone:'America/New_York'});
 }
 if(request.method==='PUT'){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  let body:{goal?:unknown};try{body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  if(!Number.isInteger(body.goal)||Number(body.goal)<1||Number(body.goal)>200)return json({error:'Goal must be between 1 and 200'},400);
  await env.atriveo_auth.prepare("INSERT INTO daily_goals(email,goal,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(email) DO UPDATE SET goal=excluded.goal,updated_at=excluded.updated_at").bind(email,body.goal).run();
  return json({goal:body.goal,timeZone:'America/New_York'});
 }
 return json({error:'Method not allowed'},405);
};
