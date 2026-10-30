import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
const {chromium}=createRequire(path.join(os.homedir(),'playatriveo/package.json'))('playwright');const root=path.resolve(import.meta.dirname,'..');
const p=(label,strength,entry='Stony Brook University')=>({label,strength,status:strength==='strong'?'matched':strength==='missing'?'missing':'partial',class:'required',entry,text:strength==='missing'?null:`Built ${label} production services with measured improvements.`,source:`Experience in ${label}`,tier:'job_bullet',box:strength==='strong'?{x:10,y:25,width:75,height:5}:null});
const proofs=[p('Python','strong'),p('AWS','strong'),p('Machine learning','strong','Wake Forest – CAIR'),p('C++','partial'),p('SageMaker','missing')];
const mk=(key,company,title)=>({key,id:`https://example.org/${key}`,company,title,source:key==='1'?'linkedin':key==='2'?'staffing':'greenhouse',location:'Bellevue, WA',position:1,level:'Entry',track:'ai-engineer',foundAt:'2026-10-24T12:00:00Z',applyUrl:`https://example.org/apply/${key}`,postingUrl:`https://example.org/${key}`,resumePath:'/resume.pdf',resumeObject:key==='2'?{sha256:'a'.repeat(64),hasImage:false}:null,resumeMatch:key==='2'?{score:null,status:'stale',reason:'Scoring rules changed; assessment needs refresh'}:{score:84},jd:{full:'Required Skills\nPython and AWS.\nResponsibilities\nBuild reliable inference services.',work:null,kind:'Full-time',salary:null,flags:[]},fit:{score:87,confidence:'high',confidence_reasons:[],ledger:{unparsed:[{classification:"required",source:"Demonstrated ability to handle ambiguous stakeholder needs."}],unrecognized:["ExampleTool"],required:{matched:3,total:5},total:{matched:3,total:5},skills:proofs.map(x=>({...x,alternatives:[x.label],evidence:x.text?{entry:x.entry,text:x.text,tier:x.tier}:undefined}))},knockouts:{verdict:'clear',items:[]}},ats:{proofs,highlights:[],pages:1,roomLines:0},ready:{status:'Review',reasons:['Check the skills left off this resume.']},similar:[]});
const jobs=[mk('1','Amazon Web Services (AWS)','Software Development Engineer II, SageMaker AI Inference'),mk('2','NVIDIA','AI Systems Engineer'),mk('3','Google','Applied ML Engineer')];jobs.forEach(j=>j.similar=jobs.filter(x=>x.id!==j.id).map(({id,key,company,title,location})=>({id,key,company,title,location,score:87})));
const companies=['Amazon Web Services (AWS)','NVIDIA','Google','Meta','Microsoft','Apple','OpenAI','Tesla','Stripe','Databricks','Netflix',...Array.from({length:416},(_,i)=>`Company ${i+12}`)].map((name,i)=>({key:name.toLowerCase(),name,source:i===0?'linkedin':i===1?'staffing':i===2?'greenhouse':null,count:5,newToday:2,bestMatch:87,saved:1}));
test('cover letters support drafting, edits, download, reopen, mobile and changed resume points',async t=>{
 const source=null;const list=source?.jobs??jobs;
 const server=http.createServer((req,res)=>{const f=path.join(root,'dist-apply',new URL(req.url,'http://localhost').pathname);const file=fs.existsSync(f)&&fs.statSync(f).isFile()?f:path.join(root,'dist-apply/index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1660,height:1000}});page.setDefaultTimeout(10000);const errors=[],decisions=[],confirmations=[],requests=[];page.on('pageerror',e=>errors.push(e.message));const base=`http://localhost:${server.address().port}`;
 await page.route('**/*',async route=>{const u=new URL(route.request().url());const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type'};
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
 if(u.pathname==='/api/auth/me')return route.fulfill({json:{user:{id:1,name:'Test',email:'katishay@gmail.com'}}});
 if(u.pathname==='/applications/matching-queue'){requests.push(u);const selected=u.searchParams.get('job');const filter=u.searchParams.get('company');const excluded=new Set((u.searchParams.get('exclude')||'').split(','));let rows=list.filter(j=>!excluded.has(j.key)&&(!filter||j.company.toLowerCase()===filter));if(selected)rows.sort((a,b)=>Number(b.id===selected)-Number(a.id===selected));return route.fulfill({json:{...(source??{}),ok:true,total:list.length,jobs:rows,companies:source?.companies??companies,stats:source?.stats??{opened:2,skipped:1,saved:1,remaining:list.length,applied:96,appliedToday:0},preference:{active:false,limit:2}},headers});}
 if(u.pathname==='/applications/matching-event')return route.fulfill({json:{ok:true},headers});
 if(u.pathname==='/applications/job-applied'){confirmations.push(route.request().postDataJSON());return route.fulfill({json:{ok:true},headers});}
 if(u.pathname==='/applications/job-decision'){decisions.push(route.request().postDataJSON());return route.fulfill({json:{ok:true},headers});}
 if((u.pathname==='/serve-pdf'||u.pathname==='/applications/resume-file')&&u.searchParams.get('dl')==='1')return route.fulfill({body:'%PDF-1.4 fixture',contentType:'application/pdf',headers:{...headers,'Content-Disposition':'attachment; filename="Atishay Kasliwal.pdf"'}});
 if(u.pathname==='/applications/resume-image'||u.pathname==='/applications/resume-file')return route.fulfill(process.env.JM_UI_IMAGE?{path:process.env.JM_UI_IMAGE,contentType:'image/png',headers}:{status:404,headers});
 if(u.origin===base)return route.continue();return route.abort();});
 let letterDraft=null;let stale=false;const letterCalls=[];
 await page.route('**/matching-cover-letter',async route=>{const b=route.request().postDataJSON();letterCalls.push(b);if(b.action==='generate')letterDraft={version:'v1',paragraphs:['I am applying for this role.','My selected resume points include financial reporting.','Thank you for considering my application.'],pdfPath:null};if(b.action==='save'||b.action==='pdf')letterDraft={...letterDraft,paragraphs:b.paragraphs,pdfPath:b.action==='pdf'?'/letters/cover-letter.pdf':null};await route.fulfill({json:{ok:true,version:'v1',draft:letterDraft,busy:false,stale}});});
 await page.goto(base+'/job-matching');await page.getByRole('heading',{name:list[0].title,exact:true}).waitFor();
 await page.getByRole('button',{name:'Cover Letter',exact:true}).filter({visible:true}).click();
 await page.getByRole('dialog',{name:'Cover Letter',exact:true}).waitFor();
 await page.getByRole('button',{name:'Create with Codex',exact:true}).click();
 await page.getByLabel('Letter body',{exact:true}).waitFor();
 assert.equal(letterCalls.find(b=>b.action==='generate').source.jobUrl,list[0].id);
 await page.getByLabel('Letter body',{exact:true}).fill('I am applying for this role.\n\nI built financial reporting systems.\n\nThank you for your time.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByRole('button',{name:'Generate PDF',exact:true}).click();
 await page.getByRole('link',{name:'Download',exact:true}).waitFor();
 assert.match(await page.getByRole('link',{name:'Download',exact:true}).getAttribute('href'),/cover-letter.pdf.*dl=1/);
 if(process.env.JM_UI_SCREENSHOT)await page.screenshot({path:process.env.JM_UI_SCREENSHOT.replace('.png','-cover-letter.png')});
 await page.getByRole('button',{name:'Close cover letter',exact:true}).click();
 await page.getByRole('button',{name:'Cover Letter',exact:true}).filter({visible:true}).click();
 assert.match(await page.getByLabel('Letter body',{exact:true}).inputValue(),/I built financial reporting systems/);
 await page.keyboard.press('Escape');


 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Cover Letter',exact:true}).filter({visible:true}).click();
 await page.getByLabel('Letter body',{exact:true}).waitFor();
 assert.ok(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
 if(process.env.JM_UI_SCREENSHOT)await page.screenshot({path:process.env.JM_UI_SCREENSHOT.replace('.png','-mobile-cover-letter.png')});
 await page.keyboard.press('Escape');
 stale=true;
 await page.getByRole('button',{name:'Cover Letter',exact:true}).filter({visible:true}).click();
 await page.getByText('Your resume points changed. Regenerate this letter to match the current resume.').waitFor();
 assert.equal(await page.getByLabel('Letter body',{exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('link',{name:'Download',exact:true}).count(),0);
 await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
});
