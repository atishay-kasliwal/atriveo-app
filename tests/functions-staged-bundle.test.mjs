import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
import {build} from 'esbuild';

// scripts/deploy-apply.sh deploys the Pages functions from a staging folder holding functions/ and the files in
// FUNCTION_SHARED. Bundle every function from a copy staged the same way, so an import of a file left out of that
// list fails here and not in the deploy (as scripts/place.mjs did on Nov 27).
const script=fs.readFileSync('scripts/deploy-apply.sh','utf8');
const shared=(script.match(/^FUNCTION_SHARED=\(([^)]*)\)/m)?.[1]??'').split(/\s+/).filter(Boolean);
const entries=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?entries(path.join(dir,e.name)):/\.(ts|js|mjs)$/.test(e.name)&&!e.name.endsWith('.d.ts')?[path.join(dir,e.name)]:[]);

test('deploy-apply lists the shared files it copies',()=>{
 assert.ok(shared.includes('scripts/place.mjs'),'FUNCTION_SHARED is read from the script');
});
test('every function bundles from the staged copy deploy-apply makes',async()=>{
 // Inside the repo, like $APP_DIR/.deploy-apply, so packages resolve from its node_modules.
 const stage=fs.mkdtempSync(path.join(process.cwd(),'.deploy-apply-test-'));
 try{
 fs.cpSync('functions',path.join(stage,'functions'),{recursive:true});
 for(const f of shared){fs.mkdirSync(path.join(stage,path.dirname(f)),{recursive:true});fs.copyFileSync(f,path.join(stage,f));}
 const files=entries(path.join(stage,'functions'));
 assert.ok(files.length>10);
 for(const file of files){
  const r=await build({entryPoints:[file],bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent',external:['node:*','cloudflare:*','__STATIC_CONTENT_MANIFEST'],mainFields:['module','main']}).then(()=>null,e=>e.errors?.map(x=>x.text).join('; ')||String(e));
  assert.equal(r,null,path.relative(stage,file));
 }
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
});
