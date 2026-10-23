import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const { chromium } = createRequire(path.join(os.homedir(), 'playatriveo/package.json'))('playwright');
const root = path.resolve(import.meta.dirname, '..');
const full = 'Required Skills\nJava, React.js, and Python.\nResponsibilities\n' + 'Build APIs and collaborate with the team.\n'.repeat(70) + 'End of full posting.';
const sample = { ok: true, total: 1, jobs: [{ id: 'https://example.org/job/1', company: 'Example', title: 'Full Stack Developer', location: 'NY - New York', track: 'software-engineer', saved: false, applyUrl: 'https://example.org/job/1', resumePath: '/resume.pdf', jd: { full, flags: [] }, ats: { score: 78, required: {matched: 2, total: 3}, keywords: [{name:'Java', matched:false}, {name:'React',matched:true}, {name:'Python',matched:true}], highlights: [{start: full.indexOf('React.js'), end: full.indexOf('React.js') + 8}, {start: full.indexOf('Python'), end: full.indexOf('Python') + 6}], pages:1, roomLines:0 } }] };

test('full description, green PDF keywords and ATS score fit desktop and mobile', async t => {
 const fixture = process.env.JM_UI_FIXTURE ? JSON.parse(fs.readFileSync(process.env.JM_UI_FIXTURE, 'utf8')) : sample;
 const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const requested = path.join(root,'dist-apply',pathname);
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root,'dist-apply/index.html');
  res.setHeader('Content-Type', file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base = `http://localhost:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));});
 const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 t.after(async()=>{await browser.close();});
 const page = await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', route=>{
  const url=new URL(route.request().url());
  const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true'};
  if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:{id:1,email:'katishay@gmail.com',name:'Test'}},headers});
  if(url.pathname==='/applications/matching-queue')return route.fulfill({json:fixture,headers});
  if(url.pathname==='/applications/resume-image')return route.fulfill(process.env.JM_UI_IMAGE ? {path:process.env.JM_UI_IMAGE,contentType:'image/png',headers} : {status:404,headers});
  if(url.origin===base)return route.continue();
  return route.abort();
 });
 await page.goto(base+'/job-matching');
 await page.getByRole('heading',{name:'Full job description'}).waitFor();
 const score=page.getByLabel('ATS match score');
 assert.ok((await score.innerText()).includes(`${fixture.jobs[0].ats.score}`));
 assert.equal(await page.locator('.jm-panel .jm-description').innerText(),fixture.jobs[0].jd.full);
 assert.ok(await page.locator('.jm-panel mark').count()>0);
 assert.equal(await page.locator('.jm-facts').innerText().then(s=>s.includes('New York, NY')),true);
 for(const viewport of [{width:1600,height:1000},{width:1280,height:720},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  assert.ok(await score.isVisible());
  const bounds=await score.boundingBox();assert.ok(bounds.y+bounds.height<viewport.height, JSON.stringify({viewport,bounds}));
  assert.ok(await page.getByRole('button',{name:/^Apply/}).isVisible());
  const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerHeight}));
  assert.ok(dimensions.width<=viewport.width);assert.ok(dimensions.height<=dimensions.viewport+1);
 }
 await page.setViewportSize({width:1600,height:1000});
 if(process.env.JM_UI_SCREENSHOT)await page.screenshot({path:process.env.JM_UI_SCREENSHOT});
 await page.getByRole('button',{name:/^Expand/}).click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.locator('.jm-sheet .jm-description').innerText(),fixture.jobs[0].jd.full);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.deepEqual(errors,[]);
});
