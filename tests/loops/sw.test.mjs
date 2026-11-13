import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The service worker's Loops behaviour: action buttons on the notification, the deep link, and falling back to opening the capture.
function worker({ fetchResult }) {
  const handlers = {}, shown = [], navigation = [], fetched = [];
  const self = { location: { origin: 'https://apply.atriveo.com' }, addEventListener: (n, fn) => { handlers[n] = fn; }, registration: { showNotification: async (...a) => shown.push(a) }, clients: { matchAll: async () => [], openWindow: async (u) => navigation.push(u) } };
  const fetchFn = async (url, init) => { fetched.push({ url, init }); if (fetchResult === 'throw') throw new Error('offline'); return { ok: fetchResult === 'ok' }; };
  vm.runInNewContext(fs.readFileSync('apply-public/sw.js', 'utf8'), { self, URL, fetch: fetchFn });
  const click = async (action, data) => { let work; handlers.notificationclick({ action, notification: { data, close() {} }, waitUntil: (p) => { work = p; } }); await work; };
  return { handlers, shown, navigation, fetched, click };
}
const data = { url: 'https://apply.atriveo.com/loops?id=cap_000001', data: { loopId: 'cap_000001' } };

test('a Loops push shows its Done and Snooze buttons', async () => {
  const w = worker({ fetchResult: 'ok' }); let work;
  w.handlers.push({ data: { json: () => ({ title: 'Atriveo', body: 'Still open', url: '/loops?id=cap_000001', tag: 'loop:cap_000001', data: { loopId: 'cap_000001' }, actions: [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 6h' }] }) }, waitUntil: (p) => { work = p; } });
  await work;
  assert.deepEqual(w.shown[0][1].actions.map((a) => a.action), ['done', 'snooze']);
  assert.equal(w.shown[0][1].tag, 'loop:cap_000001');
  assert.equal(w.shown[0][1].data.data.loopId, 'cap_000001');
});

test('Done and Snooze act from the notification and do not open a window', async () => {
  const w = worker({ fetchResult: 'ok' });
  await w.click('done', data);
  assert.equal(w.fetched[0].url, '/api/loops/cap_000001/done');
  assert.equal(w.fetched[0].init.method, 'POST');
  assert.equal(w.fetched[0].init.credentials, 'include');
  await w.click('snooze', data);
  assert.equal(w.fetched[1].url, '/api/loops/cap_000001/snooze');
  assert.deepEqual(JSON.parse(w.fetched[1].init.body), { hours: 6 });
  assert.deepEqual(w.navigation, []);
});

test('if the button action fails (signed out, offline) the capture is opened instead', async () => {
  for (const fetchResult of ['fail', 'throw']) {
    const w = worker({ fetchResult });
    await w.click('done', data);
    assert.deepEqual(w.navigation, ['https://apply.atriveo.com/loops?id=cap_000001']);
  }
});

test('tapping the notification itself deep-links to the capture; a bad id never reaches the API', async () => {
  const w = worker({ fetchResult: 'ok' });
  await w.click('', data);
  assert.deepEqual(w.navigation, ['https://apply.atriveo.com/loops?id=cap_000001']);
  assert.equal(w.fetched.length, 0);
  await w.click('done', { url: 'https://apply.atriveo.com/loops', data: { loopId: '../../admin' } });
  assert.equal(w.fetched.length, 0);
  assert.equal(w.navigation.length, 2);
});
