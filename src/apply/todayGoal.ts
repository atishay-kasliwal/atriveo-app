import { useCallback, useEffect, useState } from "react";
import { getTailorServerBase } from "../utils/tailorServer";

// Today's daily goal: how many you applied to today (engine submissions + LinkedIn postings you marked applied,
// from the Stats summary for today, America/New_York), plus what you marked on this page since it last loaded.

const TZ = "America/New_York";
export const todayKey = () => new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10);

/** Per-viewer settings kept in this browser (the filters you picked, your goal); never required. */
export function readPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`today.${key}`); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
export function writePref(key: string, value: unknown): void {
  try { localStorage.setItem(`today.${key}`, JSON.stringify(value)); } catch { /* private window: not remembered */ }
}

export const GOALS = [10, 15, 20, 25];

/** Applied today, from the server, plus the marks you made here after it answered. */
export function useAppliedToday() {
  const [server, setServer] = useState<{ n: number; at: number; day: string } | null>(null);
  const [marks, setMarks] = useState<number[]>([]);
  const load = useCallback(async () => {
    const day = todayKey();
    const at = Date.now();
    try {
      const res = await fetch(`${getTailorServerBase()}/applications/analytics?view=summary&from=${day}&to=${day}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) return;
      setServer({ n: (json.range?.applied ?? 0) + (json.range?.linkedinApplied ?? 0), at, day });
    } catch { /* keep the last count */ }
  }, []);
  useEffect(() => { const first = setTimeout(load, 0); const t = setInterval(load, 300_000); return () => { clearTimeout(first); clearInterval(t); }; }, [load]);
  const mark = useCallback(() => setMarks((m) => [...m, Date.now()]), []);
  // Re-check every 15 s so a combo ends on screen once 3 minutes pass without a mark.
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!marks.length) return; const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, [marks.length]);
  const day = todayKey();
  const sinceLoad = marks.filter((t) => !server || (t > server.at && server.day === day)).length;
  // A combo: marks no more than 3 minutes apart, counted back from the latest one.
  let combo = 0;
  for (let i = marks.length - 1; i >= 0; i--) {
    const next = i === marks.length - 1 ? Math.max(now, marks[i]!) : marks[i + 1]!;
    if (next - marks[i]! > 180_000) break;
    combo += 1;
  }
  return { applied: server && server.day === day ? server.n + sinceLoad : server ? sinceLoad : null, combo, mark, refresh: load };
}

// --- History: applied per day (engine, Open & Fill and extension submissions; America/New_York) --------------

export interface DayCount { day: string; applied: number }

const dayShift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

/** The last `days` days of applied counts, oldest first (refreshed every 30 minutes). */
export function useApplyHistory(days = 84): DayCount[] | null {
  const [rows, setRows] = useState<DayCount[] | null>(null);
  useEffect(() => {
    const load = async () => {
      const to = todayKey(), from = dayShift(to, -(days - 1));
      try {
        const res = await fetch(`${getTailorServerBase()}/applications/analytics?view=summary&from=${from}&to=${to}`, { credentials: "include", cache: "no-store" });
        const json = await res.json();
        if (res.ok && json.ok !== false && Array.isArray(json.daily)) setRows(json.daily.map((d: { day: string; applied: number }) => ({ day: d.day, applied: d.applied ?? 0 })));
      } catch { /* keep the last history */ }
    };
    const first = setTimeout(load, 0);
    const t = setInterval(load, 1_800_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [days]);
  return rows;
}

/** Days in a row with an application, ending today (or yesterday, before today's first); weekends never break it. */
export function streakOf(rows: DayCount[], appliedToday = 0): number {
  const by = new Map(rows.map((r) => [r.day, r.applied]));
  const today = todayKey();
  by.set(today, Math.max(by.get(today) ?? 0, appliedToday));
  let day = (by.get(today) ?? 0) > 0 ? today : dayShift(today, -1);
  let n = 0;
  for (let i = 0; i < 400; i++, day = dayShift(day, -1)) {
    const c = by.get(day);
    if (c === undefined) break;
    if (c > 0) n += 1;
    else if (!weekend(day)) break;
  }
  return n;
}

// --- Sprint: 25 minutes, how many you applied to in it, your best -----------------------------------------------

export const SPRINT_MS = 25 * 60_000;
export function useSprint(applied: number | null) {
  const [sprint, setSprint] = useState<{ start: number; base: number } | null>(() => { const s = readPref<{ start: number; base: number } | null>("sprint", null); return s && Date.now() - s.start < SPRINT_MS ? s : null; });
  const [best, setBest] = useState<number>(() => readPref<number>("sprintBest", 0));
  const [now, setNow] = useState(Date.now);
  const count = sprint && applied != null ? Math.max(0, applied - sprint.base) : 0;
  const left = sprint ? Math.max(0, SPRINT_MS - (now - sprint.start)) : 0;
  const stop = useCallback(() => {
    setBest((b) => { const next = Math.max(b, count); writePref("sprintBest", next); return next; });
    setSprint(null); writePref("sprint", null);
  }, [count]);
  // Ticks each second; the sprint ends by itself after 25 minutes, keeping your best.
  useEffect(() => {
    if (!sprint) return;
    const t = setInterval(() => { const at = Date.now(); setNow(at); if (at - sprint.start >= SPRINT_MS) stop(); }, 1000);
    return () => clearInterval(t);
  }, [sprint, stop]);
  const start = () => { if (applied == null) return; const s = { start: Date.now(), base: applied }; setNow(s.start); setSprint(s); writePref("sprint", s); };
  return { running: Boolean(sprint), left, count, best, start, stop };
}
