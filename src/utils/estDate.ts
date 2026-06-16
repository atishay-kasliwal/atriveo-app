import { useEffect, useState } from "react";

/** Calendar day YYYY-MM-DD in America/New_York. */
export function estDateKey(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
}

/** Hour bucket key for ET, e.g. 2026-06-15T16 */
export function estHourKey(date = new Date()): string {
  const day = estDateKey(date);
  const hour = Number(
    date.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  return `${day}T${String(hour).padStart(2, "0")}`;
}

/** Short hour label for KPIs, e.g. "4 PM" */
export function estHourLabel(date = new Date()): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: true,
  });
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
