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
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 3) : undefined,
  }));
});
// A Loops reminder's Done / Snooze buttons act from the notification itself, with the signed-in cookie; if that fails (signed out,
// offline) the capture is opened instead so nothing is silently dropped.
async function loopAction(id, action) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(id || ''))) return false;
  try {
    const res = await fetch(`/api/loops/${id}/${action === 'done' ? 'done' : 'snooze'}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'done' ? {} : { hours: 6 }) });
    return res.ok;
  } catch { return false; }
}
// A saved-job nudge's I applied / Not applying buttons do what Mark applied and Skip (Matching) or Applied and Pass
// (Staffing) do on the page; if that fails the Saved list is opened instead.
async function savedAction(job, action) {
  if (!job || !/^https?:\/\//.test(String(job.jobUrl || ''))) return false;
  const staffing = job.source === 'staffing';
  if (staffing && !/^[A-Za-z0-9_-]{1,128}$/.test(String(job.staffingId || ''))) return false;
  const [path, body] = staffing ? ['/tailor/staffing/decision', { id: job.staffingId, state: action === 'applied' ? 'applied' : 'passed' }]
    : action === 'applied' ? ['/tailor/applications/job-applied', { jobUrl: job.jobUrl }] : ['/tailor/applications/job-decision', { jobUrl: job.jobUrl, decision: 'skip' }];
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = destination(event.notification.data?.url);
  const loopId = event.notification.data?.data?.loopId;
  const savedJob = event.notification.data?.data?.savedJob;
  event.waitUntil((async () => {
    if ((event.action === 'done' || event.action === 'snooze') && loopId && await loopAction(loopId, event.action)) return;
    if ((event.action === 'applied' || event.action === 'skip') && savedJob && await savedAction(savedJob, event.action)) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (client) { await client.navigate(url); await client.focus(); }
    else await self.clients.openWindow(url);
  })());
});
