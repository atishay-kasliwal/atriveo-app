import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_PLACE, normalizePlace, stateAt, type Place } from "../../scripts/place.mjs";

/**
 * Where you are, shared by every page that stars and orders jobs by location:
 * - your states (Settings → Where I am): saved on the server so the phone and the laptop agree, and kept in this
 *   browser too, so cards don't reshuffle while it loads;
 * - the state you are in now ("Use my location"): this device only. The position is turned into a state here, in
 *   the browser, and only the state is kept; the coordinates are never sent anywhere.
 */
const KEY = "atriveo.place", HERE_KEY = "atriveo.here";
/** How long a detected state counts before it is checked again (when the browser already allows location). */
const FRESH_MS = 30 * 60_000;

export type HereStatus = "off" | "asking" | "on" | "outside" | "denied" | "unavailable";
interface Here { state: string | null; at: number; status: HereStatus }

const fallback = (): Place => ({ states: [...DEFAULT_PLACE.states], remote: DEFAULT_PLACE.remote });
let saved: Place = (() => { try { const raw = localStorage.getItem(KEY); return raw ? normalizePlace(JSON.parse(raw)) : fallback(); } catch { return fallback(); } })();
let here: Here = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(HERE_KEY) || "null") as { state?: unknown; at?: unknown } | null;
    if (v && typeof v.at === "number") return { state: typeof v.state === "string" ? v.state : null, at: v.at, status: typeof v.state === "string" ? "on" : "outside" };
  } catch { /* nothing remembered */ }
  return { state: null, at: 0, status: "off" };
})();
let current: Place = { ...saved, here: here.state };
let loading: Promise<void> | null = null;
let autoChecked = false;
const listeners = new Set<() => void>();
const emit = () => { current = { ...saved, here: here.state }; for (const l of listeners) l(); };

/** The place right now, for code that fetches outside a render (it may still be the remembered one). */
export const currentPlace = (): Place => current;
const currentHere = (): Here => here;

/** Use these states everywhere at once (Settings calls it after a save). The state you are in now is kept. */
export function setPlace(next: Place) {
  saved = normalizePlace(next);
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* only not remembered here */ }
  emit();
}

function setHere(next: Here) {
  here = next;
  try {
    if (next.status === "on" || next.status === "outside") localStorage.setItem(HERE_KEY, JSON.stringify({ state: next.state, at: next.at }));
    else if (next.status === "off" || next.status === "denied") localStorage.removeItem(HERE_KEY);
  } catch { /* only not remembered here */ }
  emit();
}

/**
 * Ask the browser where you are and keep the state. The first time, the browser shows its own "Allow location?"
 * prompt; only a click calls this, except the quiet re-check below when it is already allowed.
 */
export async function detectHere(): Promise<HereStatus> {
  if (!("geolocation" in navigator)) { setHere({ ...here, status: "unavailable" }); return "unavailable"; }
  setHere({ ...here, status: "asking" });
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15_000, maximumAge: FRESH_MS }));
    const borders = (await import("../data/us-states.json")).default as Record<string, number[][]>;
    const state = stateAt(pos.coords.latitude, pos.coords.longitude, borders);
    setHere({ state, at: Date.now(), status: state ? "on" : "outside" });
    return state ? "on" : "outside";
  } catch (e) {
    const denied = (e as GeolocationPositionError)?.code === 1;
    // A failed check keeps the last state you were in (if any); a refusal forgets it.
    setHere(denied ? { state: null, at: 0, status: "denied" } : { ...here, status: here.state ? "on" : "unavailable" });
    return denied ? "denied" : "unavailable";
  }
}

/** Stop using your location on this device (the browser's permission stays as you set it). */
export function forgetHere() { setHere({ state: null, at: 0, status: "off" }); }

/** When the browser already allows location, check it again once a visit if the last check is old. Never prompts. */
async function autoCheck() {
  if (autoChecked) return;
  autoChecked = true;
  if (here.status === "off" || Date.now() - here.at < FRESH_MS) return;
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (p?.state === "granted") await detectHere();
  } catch { /* the permissions API is missing: wait for a click */ }
}

function load() {
  loading ??= fetch("/api/progress/preferences", { credentials: "include", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { place?: unknown } | null) => { if (j && j.place) setPlace(normalizePlace(j.place)); })
    .catch(() => { /* keep the one this browser remembers */ });
  return loading;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The current place; loads the saved states once per visit and updates when Settings or your location change it. */
export function usePlace(): Place {
  useEffect(() => { void load(); void autoCheck(); }, []);
  return useSyncExternalStore(subscribe, currentPlace);
}

/** The state you are in now and how the last check went. */
export function useHere(): Here {
  return useSyncExternalStore(subscribe, currentHere);
}
