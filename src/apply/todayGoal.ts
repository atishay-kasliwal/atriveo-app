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
