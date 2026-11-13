import { useEffect, useState } from "react";
import { fetchJson, getJson, type ApiBody } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

// Lucky hours (docs/lucky.md): one request a minute, shared by the Lucky page, the nav item and the strip on Matching.
export type Tone = "good" | "mixed" | "avoid";
export interface Span { start: string; end: string }
export interface LuckyWindow extends Span { choghadiya: string; hora: string }
export interface Strength { moonNakshatra: string; tara: string; taraTone: Tone; chandraHouse: number; chandraTone: Tone; verdict: Tone }
export interface LuckyDay {
  day: string; weekday: string; sunrise: string; sunset: string; nextSunrise: string;
  choghadiya: (Span & { name: string; night: boolean })[]; hora: (Span & { name: string })[];
  rahu: Span; abhijit: Span | null; lucky: LuckyWindow | null; strength: Strength | null;
}
export interface Place { name: string; lat: number; lon: number; tz: string }
export interface LuckyData {
  profile: { birthPlace: string; birthLocal: string; hasBirth: boolean; location: Place; workStart: number; workEnd: number; calendar: boolean };
  location: Place; today: string; chart: { nakshatraName: string; rashiName: string; pada: number } | null;
  days: LuckyDay[]; appliedInWindow: number; best: number; history: { _id: string; applied: number }[];
}

let cache: LuckyData | null = null, loadedAt = 0, inflight: Promise<LuckyData> | null = null;
const listeners = new Set<(d: LuckyData) => void>();
export function loadLucky(force = false): Promise<LuckyData> {
  if (!force && cache && Date.now() - loadedAt < 55_000) return Promise.resolve(cache);
  // An error body or a half-filled reply must not reach the nav, which every desktop page renders.
  inflight ??= getJson<LuckyData>("/lucky").then((d) => { if (!d?.location?.tz || !Array.isArray(d.days) || !d.days.length) throw new Error("Lucky data is incomplete"); cache = d; loadedAt = Date.now(); listeners.forEach((f) => f(d)); return d; }).finally(() => { inflight = null; });
  return inflight;
}
export function useLucky(): LuckyData | null {
  const [data, setData] = useState(cache);
  useEffect(() => {
    listeners.add(setData);
    void loadLucky().catch(() => {});
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void loadLucky().catch(() => {}); }, 60_000);
    return () => { listeners.delete(setData); window.clearInterval(t); };
  }, []);
  return data;
}
export function useNow(every = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), every); return () => window.clearInterval(t); }, [every]);
  return now;
}

export async function postLucky<T extends ApiBody>(path: string, body: unknown): Promise<T> {
  const { res, json } = await fetchJson<T>(`${getTailorServerBase()}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------- reading the plan ----------
const ms = (iso: string) => Date.parse(iso);
const fmts = new Map<string, Intl.DateTimeFormat>();
export function clock(iso: string | number, tz: string): string {
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }); fmts.set(tz, f); }
  return f.format(new Date(iso)).replace(":00", "");
}
/** The window that is on now, or the next one to come, with its day. */
export function currentWindow(d: LuckyData, now: number): { day: LuckyDay; w: LuckyWindow; index: number } | null {
  for (let i = 0; i < d.days.length; i++) { const w = d.days[i]!.lucky; if (w && ms(w.end) > now) return { day: d.days[i]!, w, index: i }; }
  return null;
}
export type NavState = "before" | "soon" | "on" | "after" | "none";
/** What the nav item says: the start time, "in 12m", the time left, or the next window. `fill` is the loading bar, 0 to 1. */
export function navState(d: LuckyData, now: number): { state: NavState; text: string; fill: number; title: string } {
  const tz = d.location.tz, today = d.days[0], cur = currentWindow(d, now);
  if (!cur) return { state: "none", text: "", fill: 0, title: "No lucky hour in the next two weeks" };
  const s = ms(cur.w.start), e = ms(cur.w.end), title = `${clock(s, tz)} to ${clock(e, tz)} · ${cur.w.choghadiya} · ${cur.w.hora} hora${today ? ` · Rahu Kaal ${clock(today.rahu.start, tz)}` : ""}`;
  if (now >= s) return { state: "on", text: countdown(e - now), fill: (e - now) / (e - s), title };
  if (cur.index > 0 || !today?.lucky) return { state: "after", text: `${cur.day.weekday} ${clock(s, tz)}`, fill: 0, title };
  const left = s - now;
  if (left <= 15 * 60_000) return { state: "soon", text: `in ${Math.ceil(left / 60_000)}m`, fill: Math.max(0.04, 1 - left / (6 * 3_600_000)), title };
  return { state: "before", text: clock(s, tz), fill: Math.max(0.04, 1 - left / (6 * 3_600_000)), title };
}
export function countdown(left: number): string {
  const m = Math.max(0, Math.floor(left / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
}

// ---------- the sky: u runs 0 to 1 from sunrise to sunset over the top, 1 to 2 through the night underneath ----------
export function uOf(day: LuckyDay, at: number): number {
  const rise = ms(day.sunrise), set = ms(day.sunset), next = ms(day.nextSunrise);
  if (at >= rise && at <= set) return (at - rise) / (set - rise);
  if (at > set) return 1 + Math.min(1, (at - set) / (next - set));
  const prevSet = set - 86_400_000; // before sunrise: the tail of last night
  return 1 + Math.max(0, (at - prevSet) / (rise - prevSet));
}

/** A wall-clock time in a time zone as an ISO instant (for the birth form). */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const want = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let guess = want;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  for (let i = 0; i < 2; i++) { const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value])); guess += want - Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!); }
  return new Date(guess).toISOString();
}
