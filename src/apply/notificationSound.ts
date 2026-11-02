// The Atriveo notification sound: played by the open app when a push arrives (the service worker then shows the
// notification silently). On by default; the choice lives in Cache Storage so sw.js can read it too.
const PREF = "/__prefs/notification-sound";
const SRC = "/notification.m4a";

export async function notificationSoundOn(): Promise<boolean> {
  try { const res = await caches.match(PREF); return !res || (await res.text()) !== "off"; } catch { return true; }
}

export async function setNotificationSound(on: boolean): Promise<void> {
  const cache = await caches.open("atriveo-prefs");
  await cache.put(PREF, new Response(on ? "on" : "off"));
}

let audio: HTMLAudioElement | null = null;
const sound = () => (audio ??= Object.assign(new Audio(SRC), { preload: "auto" }));

export function playNotificationSound(): Promise<void> {
  const a = sound();
  a.currentTime = 0;
  return a.play().catch(() => {});
}

/** Listen for the service worker's "play" message. iOS only lets a page play sound after a tap, so the first tap
 *  plays the sound muted once to unlock it. */
export function installNotificationSound(): void {
  const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (typeof sw?.addEventListener !== "function" || typeof caches === "undefined") return;
  sw.addEventListener("message", (e) => {
    if (e.data?.type === "atriveo-notification-sound") void playNotificationSound();
  });
  const unlock = () => {
    const a = sound();
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; }, () => {}).finally(() => { a.muted = false; });
  };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
}
