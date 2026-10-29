import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';
const {chromium}=createRequire(path.join(process.env.PLAYATRIVEO_DIR||path.join(os.homedir(),'playatriveo'),'package.json'))('playwright');
const stamp='2026-10-27T15:00:00Z';
const person=(id,name,company)=>({id,name,company,sourceId:'event',role:'Engineer',city:'Raleigh',email:`${id}@example.com`,linkedin:'',phone:'',notes:'',photoId:null,via:null,color:null,tags:[],lastContact:null,nextFollowUp:'2026-11-01',history:[],archived:false,createdAt:stamp,updatedAt:stamp,watchJobs:false});
async function fixture(t,width){
 const root=path.resolve('dist-apply');const server=http.createServer((req,res)=>{const requested=path.join(root,new URL(req.url,'http://localhost').pathname);const file=fs.existsSync(requested)&&fs.statSync(requested).isFile()?requested:path.join(root,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
 t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
 const data={people:[person('ankit','Ankit Jain','Amazon'),person('colleen','Colleen Bott','Randstad'),person('unrelated','Other Person','Other')],sources:[{id:'event',type:'event',name:'Open Source Summit',about:'',color:null,createdAt:stamp}],links:[]};
 const jobs=Array.from({length:6},(_,n)=>({url:`https://example.com/job/${n}`,applyUrl:`https://example.com/apply/${n}`,title:`Software Engineer ${n+1}`,company:'Amazon',location:'Seattle',status:'new',foundAt:stamp}));
 let expanded=false;let items=[{key:'opportunity:amazon:ankit',kind:'opportunity',stage:'discovered',title:'Amazon',detail:'6 open roles on your board. Ankit Jain works here.',next:'Review the roles first. If one fits, ask your connection about it.',personId:'ankit',people:['ankit'],jobs,relationship:'First connection',firstSeen:stamp},
 {key:'due:colleen:2026-11-01',kind:'follow_up',stage:'discovered',title:'Follow up with Colleen Bott',detail:'Planned for Nov 1.',next:'Prepare your message.',personId:'colleen',people:['colleen'],jobs:[],firstSeen:stamp},
 {key:'reply:ankit:r',kind:'reply',stage:'actionable',title:'Ankit replied',detail:'Read their reply.',next:'Answer Ankit.',personId:'ankit',people:['ankit'],jobs:[],firstSeen:stamp},
 {key:'upcoming:work:2026-11-04',kind:'upcoming',stage:'discovered',title:'Prepare for a conversation',detail:'Starts Nov 4.',next:'Review your notes.',workId:'work',people:['ankit'],jobs:[],firstSeen:stamp}];
 const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/auth/me')return route.fulfill({json:{user:{name:'Test',email:'test@example.com'}}});
 if(u.origin!==base&&u.pathname.startsWith('/network')){
  if(u.pathname==='/network/intelligence/action'){const b=route.request().postDataJSON();writes.push(b);if(b.action==='preference')expanded=b.expanded;else if(b.action!=='review') items=items.filter(i=>i.key!==b.key);return route.fulfill({json:{ok:true}});}
  if(u.pathname==='/network/intelligence')return route.fulfill({json:{items,expanded,generatedAt:stamp}});
  if(u.pathname==='/network')return route.fulfill({json:data});
  if(u.pathname==='/network/maps')return route.fulfill({json:{maps:[{id:'main',name:'My network',people:3,main:true}]}});
  if(u.pathname==='/network/board')return route.fulfill({json:{items:[{id:'work',kind:'work',title:'Prepare for a conversation',start:'2026-11-04',end:'2026-11-05',people:['ankit'],x:600,y:400}]}});
  if(u.pathname==='/network/reminders')return route.fulfill({json:{reminders:[]}});
  if(u.pathname==='/network/jobs')return route.fulfill({json:{jobs,company:'Amazon',groups:[]}});
  return route.fulfill({json:{ok:true,companies:[]}});
 }
 if(u.pathname.startsWith('/api/')||u.origin!==base)return route.fulfill({json:{ok:true,counts:{fillable:0,ready:0},fillable:[],ready:[],manual:[],approved:[],linkedin:[],worker:null}});
 return route.continue();});
 return{page,base,writes,errors};
}
for(const width of [1440,390])test(`intelligence at ${width}px: persistent dock, graph focus, jobs, snooze, dismissal and keyboard`,async t=>{
 const{page,base,writes,errors}=await fixture(t,width);await page.goto(base+'/network?map=main');
 const tab=page.getByRole('button',{name:/Network Intelligence.*4 actionable things/});await tab.waitFor();assert.equal(await tab.getAttribute('aria-expanded'),'false');
 const tabBox=await tab.boundingBox(),zoomBox=await page.locator('.nwg-zoom').boundingBox();
 assert.ok(zoomBox.y+zoomBox.height<=tabBox.y||zoomBox.x+zoomBox.width<=tabBox.x,'zoom controls stay clear of dock');
 if(width>1100){const legend=await page.locator('.nwg-legend').boundingBox();assert.ok(legend.y+legend.height<=zoomBox.y,'legend stays above zoom controls');}
 await page.screenshot({path:`/tmp/atriveo-intelligence-mini-${width}.png`});
 await tab.click();await page.getByRole('heading',{name:'Worth your attention'}).waitFor();
 const dock=page.getByRole('region',{name:'Network Intelligence',exact:true});
 await page.screenshot({path:`/tmp/atriveo-intelligence-feed-${width}.png`});
 let box=await dock.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.y>=60&&box.y+box.height<=900);
 await page.getByRole('button',{name:'See 6 jobs',exact:true}).click();await page.getByRole('heading',{name:'Amazon',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:/Software Engineer/}).count(),6);assert.ok(page.url().includes('/network?map=main'));
 await page.locator('[data-node="intelligence-company"]').waitFor();
 assert.ok(Number(await page.locator('[data-node="unrelated"]').evaluate(el=>el.style.opacity))<.5);
 assert.equal(await page.locator('.nw-panel').count(),0);
 await page.screenshot({path:`/tmp/atriveo-intelligence-context-${width}.png`});
 await page.getByRole('button',{name:'All intelligence'}).click();
 await page.getByRole('button',{name:'View all 4'}).click();await page.getByRole('button',{name:'Prepare for a conversation',exact:true}).waitFor();
 const cards=page.locator('.ni-card');await cards.nth(1).getByRole('button',{name:'Remind me…'}).click();
 const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);await page.getByLabel('Remind me on').fill(future);await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('button',{name:/Network Intelligence.*3 actionable things/}).waitFor();assert.ok(writes.some(w=>w.action==='snooze'&&w.until===future));
 await page.reload();await page.getByRole('heading',{name:'Worth your attention'}).waitFor();assert.equal(await page.locator('.ni-card').count(),3);
 await page.locator('.ni-card').first().getByRole('button',{name:'Don’t show again'}).click();await page.getByRole('button',{name:/Network Intelligence.*2 actionable things/}).waitFor();
 await page.getByRole('button',{name:'Minimize Network Intelligence'}).click();await page.reload();const min=page.getByRole('button',{name:/Network Intelligence.*2 actionable things/});await min.waitFor();assert.equal(await min.getAttribute('aria-expanded'),'false');
 await min.focus();assert.equal(await min.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');assert.deepEqual(errors,[]);
});
test('dock is available on maps home and opens canvas context',async t=>{const{page,base,errors}=await fixture(t,1440);await page.goto(base+'/network');const tab=page.getByRole('button',{name:/Network Intelligence.*4 actionable things/});await tab.click();await page.getByRole('button',{name:'See 6 jobs',exact:true}).click();await page.getByRole('heading',{name:'Amazon',exact:true}).waitFor();assert.ok(page.url().includes('map=main'));assert.deepEqual(errors,[]);});
