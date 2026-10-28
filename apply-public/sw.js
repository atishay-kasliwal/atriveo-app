/* Push only: no fetch handler or application caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function destination(value) {
  try { const url = new URL(value || '/', self.location.origin); return url.origin === self.location.origin ? url.href : self.location.origin + '/'; }
  catch { return self.location.origin + '/'; }
}
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Atriveo', {
    body: payload.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: payload.tag,
    data: { url: destination(payload.url), type: payload.type, data: payload.data },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = destination(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (client) { await client.navigate(url); await client.focus(); }
    else await self.clients.openWindow(url);
  })());
});
