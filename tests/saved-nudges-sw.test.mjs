import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The service worker's saved-job nudge buttons: I applied and Not applying send what the page buttons send.
function worker(ok = true) {
  const handlers = {}, navigation = [], fetched = [];
  const self = { location: { origin: 'https://apply.atriveo.com' }, addEventListener: (n, fn) => { handlers[n] = fn; }, registration: { showNotification: async () => {} }, clients: { matchAll: async () => [], openWindow: async (u) => navigation.push(u) } };
  const fetchFn = async (url, init) => { fetched.push({ url, body: JSON.parse(init.body), credentials: init.credentials }); return { ok }; };
  vm.runInNewContext(fs.readFileSync('apply-public/sw.js', 'utf8'), { self, URL, fetch: fetchFn });
  const click = async (action, data) => { let work; handlers.notificationclick({ action, notification: { data, close() {} }, waitUntil: (p) => { work = p; } }); await work; };
  return { navigation, fetched, click };
}
const matching = { url: 'https://apply.atriveo.com/job-matching?saved=1', data: { savedJob: { source: 'matching', jobUrl: 'https://jobs.example/a' } } };
const staffing = { url: 'https://apply.atriveo.com/staffing?view=saved', data: { savedJob: { source: 'staffing', jobUrl: 'https://staffing.example/1', staffingId: 'abc123' } } };

test('Matching: I applied marks it applied, Not applying skips it, without opening a window', async () => {
  const w = worker();
  await w.click('applied', matching); await w.click('skip', matching);
  assert.deepEqual(w.fetched.map((f) => [f.url, f.body]), [
    ['/tailor/applications/job-applied', { jobUrl: 'https://jobs.example/a' }],
    ['/tailor/applications/job-decision', { jobUrl: 'https://jobs.example/a', decision: 'skip' }],
  ]);
  assert.ok(w.fetched.every((f) => f.credentials === 'include'));
  assert.deepEqual(w.navigation, []);
});

test('Staffing: I applied and Not applying set Applied and Passed', async () => {
  const w = worker();
  await w.click('applied', staffing); await w.click('skip', staffing);
  assert.deepEqual(w.fetched.map((f) => [f.url, f.body]), [
    ['/tailor/staffing/decision', { id: 'abc123', state: 'applied' }],
    ['/tailor/staffing/decision', { id: 'abc123', state: 'passed' }],
  ]);
});

test('a tap, or a button that fails, opens the Saved list', async () => {
  const tap = worker(); await tap.click('', matching);
  assert.deepEqual(tap.fetched, []); assert.deepEqual(tap.navigation, ['https://apply.atriveo.com/job-matching?saved=1']);
  const failed = worker(false); await failed.click('applied', staffing);
  assert.deepEqual(failed.navigation, ['https://apply.atriveo.com/staffing?view=saved']);
});
