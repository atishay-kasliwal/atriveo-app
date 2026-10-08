// Local browser regression: mock applications only; no employer requests or submissions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const requireEngine=createRequire(path.join(process.env.PLAYATRIVEO_ROOT || path.join(os.homedir(),'playatriveo'),'package.json'));
const {chromium}=requireEngine('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atriveo-queue-test-'));
const entry=path.resolve(`.queue-test-${Date.now()}.tsx`);
fs.writeFileSync(entry,`import {createRoot} from 'react-dom/client';import OpenFillQueue from './src/apply/OpenFillQueue';createRoot(document.getElementById('root')!).render(<OpenFillQueue selected={[{id:'a',company:'Alpha'},{id:'b',company:'Beta'}]} onFinish={()=>{}} onRunning={()=>{}}/>);`);
let browser;
try {
 await build({entryPoints:[entry],bundle:true,jsx:'automatic',format:'iife',outfile:path.join(temp,'queue.js'),define:{'import.meta.env':'{}'}});
 browser=await chromium.launch({headless:true});
 for(const scenario of ['success','failure','stop','old-extension']) {
  const page=await browser.newPage();const actions=[];let active=null;let polls=0;
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('/applications/action')){const body=route.request().postDataJSON();if(body.action!=='open_and_fill')throw Error('Unexpected action');actions.push(body.applicationId);return route.fulfill({json:{ok:true,url:'https://jobs.ashbyhq.com/fixture/'+body.applicationId+'/application'}})}
   if(url.includes('/applications/review-queue')){polls++;return route.fulfill({json:{manual:['a','b'].map(id=>({id,company:id,updatedAt:'version',openFill:active===id&&polls>1?{armedAt:new Date(Date.now()-1000).toISOString(),filledAt:new Date(Date.now()+1000).toISOString(),toCheck:scenario==='failure'?1:0}:null}))}})}
   return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  });
  await page.goto('http://localhost/');
  if(scenario!=='old-extension')await page.evaluate(()=>document.documentElement.setAttribute('data-atriveo-fill-queue','1'));
  await page.exposeFunction('mockArm',id=>{active=id;polls=0});
  await page.evaluate(()=>window.addEventListener('message',e=>{if(e.data.source==='atriveo-dashboard'){if(e.data.openTab!==true)throw Error('Queue must request extension tab creation');window.mockArm(e.data.applicationId);window.postMessage({source:'atriveo-fill',type:'armed',nonce:e.data.nonce,reply:{ok:true}},location.origin)}}));
  await page.addScriptTag({content:fs.readFileSync(path.join(temp,'queue.js'),'utf8')});
  await page.getByRole('button',{name:'Open & Fill selected (2)'}).click();
  if(scenario==='old-extension'){await page.getByText('Update Atriveo Fill to 0.2.2 and reload this dashboard to use the queue.').waitFor();if(actions.length)throw Error('Old extension performed action')}
  else if(scenario==='stop'){await page.getByRole('button',{name:'Stop queue'}).click();await page.waitForTimeout(1500);if(actions.length>1)throw Error('Advanced after Stop')}
  else if(scenario==='failure'){await page.getByRole('button',{name:'Skip & continue'}).waitFor({timeout:10000});if(actions.join(',')!=='a')throw Error('Advanced past failure');await page.getByRole('button',{name:'Stop queue'}).click()}
  else {await page.getByText('Queue finished. Review the open forms and submit each yourself.').waitFor({timeout:15000});if(actions.join(',')!=='a,b')throw Error('Not sequential')}
  console.log(`${scenario}: PASS`);await page.close();
 }
} finally {await browser?.close();fs.rmSync(entry,{force:true});fs.rmSync(temp,{recursive:true,force:true})}
