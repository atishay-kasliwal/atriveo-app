import { useEffect, useRef, useState } from 'react';

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out. Close and reopen Atriveo, then try again.`)), 15000); })]).finally(() => clearTimeout(timer));
}

async function api(route: string, method = 'GET', body?: object) {
  const res = await fetch(`/api/push/${route}`, { method, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) } : {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Notifications could not be saved');
  return data;
}
function keyBytes(key: string) {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export default function PushSettings() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const needsInstall = ios && !installed;
  const supported = window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const subscription = useRef<PushSubscription | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    if (!supported || needsInstall) { setBusy(false); return; }
    let active = true;
    setMessage('Preparing notifications…');
    // Prepare registration and public key ahead of the click, preserving iOS user activation.
    Promise.all([bounded(navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready), 'Notification setup'), api('config')]).then(async ([reg, config]) => {
      if (!active) return;
      setRegistration(reg); setKey(config.publicKey || '');
      const sub = await reg.pushManager.getSubscription();
      subscription.current = sub;
      if (sub && Notification.permission === 'granted') { await api('subscription', 'POST', sub.toJSON()); if (active) setEnabled(true); }
      if (active) setMessage(config.publicKey ? '' : 'Notifications are not configured on the server yet.');
    }).catch(e => { if (active) setMessage(`Prepare notifications: ${e.message}`); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [supported, needsInstall]);
  async function enable() {
    if (!registration || !key) { setMessage('Notifications are still preparing. Close and reopen Atriveo, then try again.'); return; }
    setBusy(true); setMessage('Waiting for notification permission…');
    let stage = 'Enable notifications';
    try {
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Allow Atriveo in iPhone notification settings, then reopen the app.');
      // Safari requires subscribe() itself to run directly in the tap handler.
      // Use the subscription read during preparation: no asynchronous work before subscribe.
      const pending = subscription.current ? Promise.resolve(subscription.current) : registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key).buffer });
      const sub = await pending;
      subscription.current = sub;
      stage = 'Save this device'; setMessage('Saving this device…');
      await api('subscription', 'POST', sub.toJSON()); setEnabled(true); setMessage('');
    } catch (e) { setMessage(`${stage}: ${e instanceof Error ? `${e.name}: ${e.message}` : 'Could not enable notifications'}`); }
    finally { setBusy(false); }
  }
  async function action(test: boolean) {
    setBusy(true); setMessage('');
    try {
      if (test) { const result = await api('test', 'POST'); setMessage(result.sent ? 'Test notification sent.' : 'No notification delivered. Try enabling notifications again.'); }
      else {
        const sub = await registration?.pushManager.getSubscription();
        if (sub) { await api('subscription', 'DELETE', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
        subscription.current = null;
        setEnabled(false);
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Notification request failed'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="push-heading">
    <h2 id="push-heading">Atriveo notifications</h2>
    <p className="st-hint" role="status">{needsInstall ? 'On iPhone, open Atriveo in Safari, tap Share → Add to Home Screen, then launch Atriveo from that icon to enable notifications.' : !supported ? 'Notifications unsupported in this browser.' : enabled ? 'Notifications enabled' : 'Notifications disabled'}</p>
    {supported && !needsInstall && <div className="st-presets">
      <button type="button" disabled={busy || !key} onClick={() => enabled ? void action(false) : void enable()}>{busy ? 'Please wait…' : enabled ? 'Disable notifications' : 'Enable notifications'}</button>
      {enabled && <button type="button" disabled={busy} onClick={() => void action(true)}>Send test notification</button>}
    </div>}
    {message && <p className="st-hint" role="status">{message}</p>}
  </section>;
}
