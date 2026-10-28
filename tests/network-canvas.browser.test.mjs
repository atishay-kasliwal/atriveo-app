import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const requireEngine = createRequire(path.join(process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo'), 'package.json'));
const { chromium } = requireEngine('playwright');
const root = path.resolve('dist-apply');
const stamp = '2026-10-01T12:00:00.000Z';
function person(id, name, sourceId, company = '') {
  return { id, name, role: 'Software engineer', company, city: 'New York', photoId: null, watchJobs: false, email: '', linkedin: '', phone: '', notes: '', sourceId, via: null, color: null, tags: [], lastContact: null, nextFollowUp: null, history: [], archived: false, createdAt: stamp, updatedAt: stamp };
}
async function fixture(t, width, linkedin = false, suggested = false, mapId = "main") {
  const errors = [], writes = [];
  const data = {
    sources: [{ id: 'company-1', name: 'Northstar', type: 'company', about: 'Technology', color: null, createdAt: stamp }, { id: 'family-1', name: 'Family', type: 'family', about: 'People close to you', color: null, createdAt: stamp }, { id: 'event-1', name: 'Design meetup', type: 'event', about: 'Brooklyn', color: null, createdAt: stamp }],
    people: [person('person-1', 'Mira Chen', 'company-1', 'Northstar'), person('person-2', 'Alex Rivera', 'company-1', 'Northstar'), person('person-3', 'Sam Patel', 'family-1', 'Example Research'), person('person-4', 'Robin Park', 'event-1', 'Orchid'), person('person-5', 'Jordan Lee', 'event-1', 'Fieldwork')], links: [],
  };
  if (mapId !== "main") data.onMap = data.sources.map(s => s.id);
  if (suggested) data.people.find(p => p.id === "person-5").company = "Orchid";
  if (linkedin) {
    data.sources.push({ id: 'linkedin', name: 'LinkedIn', type: 'other', createdAt: stamp });
    data.people.push(person('old-linkedin', 'Old Contact', 'linkedin'));
  }
  const board = [{ id: 'note-1', kind: 'note', text: 'A warm introduction starts here.', x: -250, y: -260, w: 190, h: 120, color: '#fbbf24' }];
  const server = http.createServer((req, res) => {
    const requested = path.join(root, new URL(req.url, 'http://localhost').pathname);
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/auth/me') return route.fulfill({ json: { user: { name: 'Test Applicant', email: 'test@example.org' } } });
    if (u.origin !== base && u.pathname.startsWith('/network')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); writes.push({ path: u.pathname, body });
        if (u.pathname === '/network/linkedin/today') {
          const source = { id: 'linkedin-day', name: 'Oct 28, 2026', type: 'other', parentSourceId: 'linkedin', when: '2026-10-28', createdAt: stamp };
          if (!data.sources.some(s => s.id === source.id)) data.sources.push(source);
          return route.fulfill({ json: { source } });
        }
        if (u.pathname === '/network/linkedin/sort') {
          data.people.find(p => p.id === 'old-linkedin').sourceId = 'linkedin-day';
          return route.fulfill({ json: { moved: 1, days: 1 } });
        }
        if (u.pathname === '/network/source') { const source = { id: body.id || 'new-source', createdAt: stamp, about: '', color: null, ...body, ...(body.position || {}) }; if (body.positions) for (const item of body.positions) { const card = [...data.people, ...data.sources].find(c => c.id === item.id); if (card) Object.assign(card, item); } data.sources.push(source); if (data.onMap) data.onMap.push(source.id); return route.fulfill({ json: { source } }); }
        if (u.pathname === '/network/person') { const p = person(body.id || 'added-person', body.name || 'Mira Chen', body.sourceId || null, body.company || ''); data.people.push(p); return route.fulfill({ json: { person: p } }); }
        if (u.pathname === '/network/board/save') { const item = { id: 'added-note', ...body }; board.push(item); return route.fulfill({ json: { item } }); }
        return route.fulfill({ json: { ok: true } });
      }
      if (u.pathname === '/network') return route.fulfill({ json: data });
      if (u.pathname === '/network/board') return route.fulfill({ json: { items: board } });
      if (u.pathname === '/network/reminders') return route.fulfill({ json: { reminders: [] } });
      if (u.pathname === '/network/jobs') return route.fulfill({ json: { company: 'Northstar', jobs: [], groups: [] } });
      return route.fulfill({ json: { ok: true, companies: [] } });
    }
    if (u.pathname === '/applications/resume-pipeline') return route.fulfill({ json: { queued: 0, running: 0, done: 0, failed: 0, stuck: 0, current: [], next: [], reasons: [] } });
    if (u.pathname.startsWith('/api/') || u.origin !== base) return route.fulfill({ json: { ok: true, counts: { fillable: 0, ready: 0 }, fillable: [], ready: [], manual: [], approved: [], linkedin: [], worker: null } });
    return route.continue();
  });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  await page.goto(base + '/network?map=' + mapId); await page.locator('.nwg').waitFor();
  return { page, errors, writes, data };
}
for (const width of [1440, 1024, 390, 320]) test(`Network canvas fills the viewport below navigation at ${width}px`, async t => {
  const { page, errors } = await fixture(t, width);
  const header = await page.locator('.apply-header').boundingBox(); const canvas = await page.locator('.nwg').boundingBox();
  assert.ok(Math.abs(canvas.x) < 1 && Math.abs(canvas.width - width) < 1);
  assert.ok(Math.abs(canvas.y - (header.y + header.height)) < 1);
  assert.ok(Math.abs(canvas.y + canvas.height - 900) < 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
  const controls = await page.getByRole('button', { name: 'Add to network', exact: true }).boundingBox();
  assert.ok(controls.width <= 40 && controls.height <= 40, 'compact controls');
  await page.getByRole('button', { name: 'People list', exact: true }).click();
  await page.locator('.nw-view-surface').waitFor();
  assert.deepEqual(await page.locator('.nwg').boundingBox(), canvas, 'list floats above unchanged canvas');
  await page.getByRole('button', { name: 'Close view', exact: true }).click();
  if (process.env.NETWORK_QA_DIR) { fs.mkdirSync(process.env.NETWORK_QA_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.NETWORK_QA_DIR, `network-${width}.png`) }); }
  assert.deepEqual(errors, []);
});
test('layers, stacks, details, company search and new employer field preserve the canvas', async t => {
  const { page, errors, writes } = await fixture(t, 1440);
  const original = await page.locator('.nwg').boundingBox();
  await page.getByRole('button', { name: 'Show layers and filters' }).click();
  await page.getByRole('checkbox', { name: 'People', exact: true }).uncheck(); assert.equal(await page.locator('[data-node="person-1"]').count(), 0);
  await page.getByRole('checkbox', { name: 'People', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Notes, images & drawings' }).uncheck(); assert.equal(await page.locator('[data-board="note-1"]').count(), 0);
  await page.getByRole('checkbox', { name: 'Notes, images & drawings' }).check();
  await page.getByRole('checkbox', { name: 'Stack people by source' }).check();
  assert.equal(await page.locator('[data-node="person-1"]').count(), 0);
  await page.getByRole('button', { name: 'Close layers' }).click();
  await page.getByRole('button', { name: 'Expand Northstar stack: 2 people' }).click();
  await page.locator('[data-node="person-1"]').waitFor();
  await page.getByRole('button', { name: 'Collapse stacks' }).click(); assert.equal(await page.locator('[data-node="person-1"]').count(), 0);
  await page.getByRole('button', { name: 'Expand Northstar stack: 2 people' }).focus(); await page.keyboard.press('Enter');
  await page.locator('[data-node="person-1"]').focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Mira Chen' }); await panel.waitFor();
  assert.deepEqual(await page.locator('.nwg').boundingBox(), original, 'details do not resize map');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Search network' }).click(); await page.getByRole('searchbox', { name: 'Search people' }).fill('Example Research');
  await page.getByRole('button', { name: 'People list', exact: true }).click();
  assert.equal(await page.locator('.nw-rows>li').count(), 1); await page.getByRole('button', { name: 'Close view' }).click();
  await page.getByRole('button', { name: 'Add to network', exact: true }).click(); await page.getByRole('button', { name: 'Add person', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add person' });
  await dialog.getByLabel('Name', { exact: true }).fill('Taylor Morgan');
  await dialog.locator('#nw-add-company').fill('Example Research');
  await dialog.locator('select').first().selectOption('family-1');
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const create = writes.find(w => w.path === '/network/person'); assert.equal(create.body.company, 'Example Research'); assert.equal(create.body.sourceId, 'family-1');
  assert.deepEqual(errors, []);
});

test('a same-name staffing source can be introduced through a different source', async t => {
  const { page, data, writes, errors } = await fixture(t, 1440);
  await page.getByRole('button', { name: 'Add to network', exact: true }).click();
  await page.getByRole('button', { name: 'New source or company', exact: true }).click();
  const dialog=page.getByRole('dialog',{name:'New source'});
  await dialog.locator('#nw-src-name').fill('Northstar');
  await dialog.locator('#nw-src-type').selectOption('staffing');
  await dialog.locator('#nw-src-parent').selectOption('event-1');
  await dialog.locator('#nw-src-context').fill('Met at the meetup');
  await dialog.getByRole('button',{name:'Create source'}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(data.sources.filter(s=>s.name==='Northstar').length,2);
  const saved=writes.find(w=>w.path==='/network/source').body;
  assert.equal(saved.parentSourceId,'event-1');assert.equal(saved.type,'staffing');assert.equal(saved.context,'Met at the meetup');
  await page.getByRole('button',{name:'Add to network',exact:true}).click();await page.getByRole('button',{name:'Add person',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add person'});
  await add.locator('#nw-pick-source').selectOption('__new');
  await add.locator('#nw-new-type').selectOption('staffing');
  await add.locator('#nw-new-parent').selectOption('event-1');
  assert.equal(await add.locator('#nw-new-context').isVisible(),true);
  assert.deepEqual(errors,[]);
});

test('pan, zoom and board tools work on the full canvas and reveal a hidden drawing layer', async t => {
  const {page,writes,errors}=await fixture(t,1024);
  const world=page.locator('.nwg-svg>g');
  const initial=await world.getAttribute('transform');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  assert.notEqual(await world.getAttribute('transform'),initial);
  await page.getByRole('button',{name:'Pan the map',exact:true}).click();
  const canvas=await page.locator('.nwg').boundingBox();const before=await world.getAttribute('transform');
  await page.mouse.move(canvas.x+80,canvas.y+180);await page.mouse.down();await page.mouse.move(canvas.x+160,canvas.y+240,{steps:5});await page.mouse.up();
  assert.notEqual(await world.getAttribute('transform'),before);
  await page.getByRole('button',{name:'Show layers and filters'}).click();await page.getByRole('checkbox',{name:'Notes, images & drawings'}).uncheck();await page.getByRole('button',{name:'Close layers'}).click();
  await page.getByRole('button',{name:/^Sticky note:/}).click();
  await page.locator('.nwg').click({position:{x:45,y:180}});
  await page.locator('[data-board="added-note"]').waitFor();
  assert.equal(writes.find(w=>w.path==='/network/board/save').body.kind,'note');
  assert.deepEqual(errors,[]);
});

test('LinkedIn opens today’s day card for bulk entry and sorts older contacts', async t => {
  const { page, errors, writes } = await fixture(t, 1440, true);
  await page.locator('[data-node="linkedin"]').focus(); await page.keyboard.press('Enter');
  let panel = page.getByRole('complementary', { name: 'LinkedIn', exact: true });
  await panel.getByRole('button', { name: "Add today's reach-outs" }).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(await dialog.locator('select').first().inputValue(), 'linkedin-day');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await panel.getByRole('button', { name: 'Sort 1 into day cards' }).click();
  await page.getByText('Sorted 1 person into 1 day card.', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Sort 1 into day cards' }).count(), 0);
  await panel.locator('.pp-day').click();
  panel = page.getByRole('complementary', { name: 'Oct 28, 2026', exact: true });
  await panel.waitFor(); await panel.getByText('Old Contact', { exact: true }).waitFor();
  assert.ok(writes.some(w => w.path === '/network/linkedin/today'));
  assert.deepEqual(errors, []);
});

for (const [width,mapId] of [[1440,"main"],[390,"main"],[1440,"custom-map"]]) test(`confirm a suggested source stays near its people at ${width}px on ${mapId} and after reload`,async t=>{
 const {page,errors,writes}=await fixture(t,width,false,true,mapId);
 const suggested=page.locator('[data-node="auto:orchid"]');await suggested.waitFor();
 const before=await suggested.getAttribute('transform');
 const personBefore=await page.locator('[data-node="person-4"]').getAttribute('transform');
 await suggested.focus();await page.keyboard.press('Enter');
 const panel=page.getByRole('complementary',{name:'Orchid',exact:true});
 await panel.getByRole('region',{name:'Confirm source'}).waitFor();
 if(process.env.NETWORK_QA_DIR) await page.screenshot({path:path.join(process.env.NETWORK_QA_DIR,`confirm-source-${width}.png`)});
 await panel.getByRole('button',{name:'Not now',exact:true}).click();assert.equal(writes.filter(w=>w.path==='/network/source').length,0);
 await suggested.focus();await page.keyboard.press('Enter');
 await panel.getByRole('button',{name:'Confirm source',exact:true}).click();
 const saved=page.locator('[data-node="new-source"]');await saved.waitFor();
 await panel.waitFor({state:"hidden"});
 assert.equal(await saved.getAttribute('transform'),before,'saved source keeps its suggested position');
 assert.equal(await page.locator('[data-node="person-4"]').getAttribute('transform'),personBefore,'people stay put');
 const body=writes.find(w=>w.path==='/network/source').body;assert.ok(Number.isFinite(body.position.x));assert.ok(body.positions.some(p=>p.id==='person-4'));
 await page.reload();await saved.waitFor();assert.equal(await saved.getAttribute('transform'),before,'source position survives reload');
 assert.equal(await page.locator('[data-node="person-4"]').getAttribute('transform'),personBefore);
 assert.deepEqual(errors,[]);
});


test('company counts employer contacts and introduced members, with a two-letter logo fallback', async t => {
  const { page, data } = await fixture(t, 1440);
  await page.route('https://logo.clearbit.com/**', route => route.abort());
  await page.route('https://www.google.com/s2/favicons**', route => route.abort());
  data.people.find(p => p.id === 'person-2').via = 'person-1';
  data.people.find(p => p.id === 'person-3').company = 'Northstar';
  await page.reload();
  const card = page.locator('[data-node="company-1"]');
  await page.waitForFunction(() => document.querySelector('[data-node="company-1"] .nwg-tile')?.textContent === 'NO');
  assert.equal(await card.locator('.nwg-pill').textContent(), '3 people');
  assert.equal(await card.locator('.nwg-face').count(), 3);
  await card.focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('.pp-where').textContent(), /3 people/);
});
