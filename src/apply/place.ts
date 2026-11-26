import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_PLACE, normalizePlace, type Place } from "../../scripts/place.mjs";

/**
 * Where you are (Settings → Where I am), shared by every page that stars and orders jobs by location.
 * Saved on the server so the phone and the laptop agree; kept in this browser too, so cards don't
 * reshuffle while it loads.
 */
const KEY = "atriveo.place";
let current: Place = (() => { try { const raw = localStorage.getItem(KEY); return raw ? normalizePlace(JSON.parse(raw)) : { states: [...DEFAULT_PLACE.states], remote: DEFAULT_PLACE.remote }; } catch { return { states: [...DEFAULT_PLACE.states], remote: DEFAULT_PLACE.remote }; } })();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The place right now, for code that fetches outside a render (it may still be the remembered one). */
export const currentPlace = (): Place => current;

/** Use this place everywhere at once (Settings calls it after a save). */
export function setPlace(next: Place) {
  current = normalizePlace(next);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* only not remembered here */ }
  for (const l of listeners) l();
}

function load() {
  loading ??= fetch("/api/progress/preferences", { credentials: "include", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { place?: unknown } | null) => { if (j && j.place) setPlace(normalizePlace(j.place)); })
    .catch(() => { /* keep the one this browser remembers */ });
  return loading;
}

/** The current place; loads the saved one once per visit and updates when Settings changes it. */
export function usePlace(): Place {
  useEffect(() => { void load(); }, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, currentPlace);
}
