import { useEffect, useState } from "react";

/** Calendar day in America/New_York (matches Applied Today on the board). */
export function estDateKey(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
}

/** Re-renders when the EST calendar day rolls over (midnight ET). */
export function useEstDayKey(): string {
  const [dayKey, setDayKey] = useState(() => estDateKey());

  useEffect(() => {
    const sync = () => {
      const next = estDateKey();
      setDayKey((prev) => (prev === next ? prev : next));
    };
    sync();
    const id = window.setInterval(sync, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return dayKey;
}
