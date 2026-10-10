import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const { build } = requireEngine('esbuild');

test('Today refreshes saved Staffing applications in this tab, across tabs, and on return; old responses cannot overwrite new counts', async () => {
  const bundle = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {useAppliedToday} from './src/apply/todayGoal'; import {notifyApplicationsChanged} from './src/apply/applicationUpdates'; window.notifyApplicationsChanged=notifyApplicationsChanged; function App(){const goal=useAppliedToday();return React.createElement('div',{id:'count'},String(goal.applied));} createRoot(document.getElementById('app')).render(React.createElement(App));`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('http://updates.test/**', r => r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));
    await page.goto('http://updates.test/');
    await page.evaluate(() => {
      window.applied = 0;
      window.fetch = async () => ({ok:true,json:async()=>({ok:true,range:{applied:0,linkedinApplied:window.applied}})});
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(() => document.getElementById('count').textContent === '0');
    await page.evaluate(() => { window.applied=1; window.notifyApplicationsChanged(); });
    await page.waitForFunction(() => document.getElementById('count').textContent === '1');
    const other = await context.newPage();
    await other.route('http://updates.test/**', r => r.fulfill({contentType:'text/html',body:'Staffing'}));
    await other.goto('http://updates.test/staffing');
    await page.evaluate(() => {window.applied=2;});
    await other.evaluate(() => localStorage.setItem('atriveo.applications.changed','staffing-applied'));
    await page.waitForFunction(() => document.getElementById('count').textContent === '2');
    await page.evaluate(() => { window.applied=3; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => document.getElementById('count').textContent === '3');
    await page.evaluate(() => {
      let request=0;
      window.fetch=()=>new Promise(resolve=>{const n=++request;if(n===1)window.finishOld=()=>resolve({ok:true,json:async()=>({ok:true,range:{applied:0,linkedinApplied:1}})});else resolve({ok:true,json:async()=>({ok:true,range:{applied:0,linkedinApplied:4}})});});
      window.notifyApplicationsChanged(); window.notifyApplicationsChanged();
    });
    await page.waitForFunction(() => document.getElementById('count').textContent === '4');
    await page.evaluate(() => window.finishOld());
    assert.equal(await page.locator('#count').textContent(),'4');
  } finally {await browser.close();}
});
