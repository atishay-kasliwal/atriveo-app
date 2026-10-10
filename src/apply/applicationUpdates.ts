const EVENT = "atriveo-applications-changed";
const STORAGE_KEY = "atriveo.applications.changed";

/** Notify this page and other open Apply tabs after a saved application change. */
export function notifyApplicationsChanged(): void {
  window.dispatchEvent(new Event(EVENT));
  try { localStorage.setItem(STORAGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* this page still refreshes */ }
}

export function onApplicationsChanged(refresh: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refresh(); };
  const visible = () => { if (document.visibilityState === "visible") refresh(); };
  window.addEventListener(EVENT, refresh);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", visible);
  return () => {
    window.removeEventListener(EVENT, refresh);
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visible);
  };
}
