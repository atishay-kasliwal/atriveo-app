import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The Atriveo notification sound: with the app open on screen the notification is silent and the page is told to play
// the sound; closed, hidden or with the sound off, the notification keeps the system sound.
function worker({ clients = [], pref = null }) {
  const handlers = {}, shown = [];
  const self = { location: { origin: 'https://apply.atriveo.com' }, addEventListener: (n, fn) => { handlers[n] = fn; }, registration: { showNotification: async (...a) => shown.push(a) }, clients: { matchAll: async () => clients, openWindow: async () => {} } };
  const caches = { match: async (key) => (key === '/__prefs/notification-sound' && pref ? { text: async () => pref } : undefined) };
  vm.runInNewContext(fs.readFileSync('apply-public/sw.js', 'utf8'), { self, URL, caches });
  const push = async () => { let work; handlers.push({ data: { json: () => ({ title: 'Atriveo', body: 'Saved job' }) }, waitUntil: (p) => { work = p; } }); await work; };
  return { shown, push };
}
const client = (visibilityState) => { const sent = []; return { visibilityState, sent, postMessage: (m) => sent.push(m) }; };

test('app open on screen: the notification is silent and the page is told to play the Atriveo sound', async () => {
  const open = client('visible'), hidden = client('hidden');
  const w = worker({ clients: [open, hidden] });
  await w.push();
  assert.equal(w.shown[0][1].silent, true);
  assert.equal(JSON.stringify(open.sent), JSON.stringify([{ type: 'atriveo-notification-sound' }]));
  assert.deepEqual(hidden.sent, []);
});

test('app closed or in the background: the notification keeps the system sound', async () => {
  for (const clients of [[], [client('hidden')]]) {
    const w = worker({ clients });
    await w.push();
    assert.equal(w.shown[0][1].silent, undefined);
    assert.equal(w.shown[0][0], 'Atriveo');
  }
});

test('sound turned off in Settings: the notification keeps the system sound and nothing is played', async () => {
  const open = client('visible');
  const w = worker({ clients: [open], pref: 'off' });
  await w.push();
  assert.equal(w.shown[0][1].silent, undefined);
  assert.deepEqual(open.sent, []);
});
