/** Subscription access stays inside the officially signed-in CLIs; never extract their OAuth tokens. */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export const AI_PROVIDERS = ['claude', 'codex', 'claude-codex'];
export function cliEnvironment(input=process.env) {
  const env={...input};
  // Avoid an API key taking precedence over the subscription, or exposing dashboard credentials to a child.
  for(const key of Object.keys(env))if(/^(OPENAI_API_KEY|CODEX_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_PROFILE|ANTHROPIC_FEDERATION_|CLAUDE_CODE_USE_|MONGO_|TAILOR_TOKEN|RESUME_AI_)/.test(key))delete env[key];
  delete env.CLAUDECODE;
  return env;
}
export function commandFor(provider,{schemaFile,resultFile,schema,system}) {
  if(provider==='claude')return {command:'claude',args:['--print','--output-format','json','--json-schema',JSON.stringify(schema),'--system-prompt',system,'--tools','','--disable-slash-commands','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence','--permission-mode','dontAsk']};
  if(provider==='codex')return {command:'codex',args:['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-c','approval_policy="never"','-c','features.shell_tool=false','--output-schema',schemaFile,'--output-last-message',resultFile,'-']};
  throw Error('Choose Claude, Codex, or Claude + Codex');
}
async function run(command,args,{cwd,input,timeoutMs=180000}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:cliEnvironment(),stdio:['pipe','pipe','pipe']});let out='',err='',finished=false;
    const done=(e,v)=>{if(finished)return;finished=true;clearTimeout(timer);e?reject(e):resolve(v);};
    const timer=setTimeout(()=>{child.kill('SIGTERM');done(Error('AI subscription request timed out. Try again.'));},timeoutMs);
    child.on('error',()=>done(Error(`${command} is unavailable on this machine. Install it and sign in with your subscription.`)));
    child.stdout.on('data',c=>{out+=c;if(out.length>4e6){child.kill('SIGTERM');done(Error('AI response too large'));}});
    child.stderr.on('data',c=>{err+=c;if(err.length>100000)err=err.slice(-100000);});
    child.on('close',code=>{if(code!==0){const message=/limit|quota|usage/i.test(err+out)?'Subscription usage limit reached. Try later or select the other provider.':/auth|login|sign.in/i.test(err+out)?`Sign in to ${command} with your subscription and retry.`:`${command} could not complete the request. Check its sign-in and availability.`;done(Error(message));}else done(null,out);});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export async function subscriptionGenerate(provider, request, {runner=run}={}) {
  const selected=provider==='claude-codex'?(request.purpose==='verify'?'codex':'claude'):provider;
  if(!AI_PROVIDERS.includes(provider))throw Error('Unknown AI provider');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atriveo-resume-ai-'));
  try {
    const schemaFile=path.join(dir,'schema.json'),resultFile=path.join(dir,'result.json');
    await fs.writeFile(schemaFile,JSON.stringify(request.schema),{mode:0o600});
    const c=commandFor(selected,{schemaFile,resultFile,schema:request.schema,system:request.system});
    const input=selected==='claude'?request.user:`${request.system}\nReturn only the required structured JSON. Do not use tools, browse, inspect files, or modify anything.\nINPUT DATA\n${request.user}`;
    const stdout=await runner(c.command,c.args,{cwd:dir,input});
    if(selected==='codex')return JSON.parse(await fs.readFile(resultFile,'utf8'));
    const data=JSON.parse(stdout);
    if(data.is_error)throw Error('Claude subscription request failed. Check usage and retry.');
    if(data.structured_output)return data.structured_output;
    throw Error('Claude did not return structured content. Retry the request.');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
