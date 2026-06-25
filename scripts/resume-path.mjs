// Resume output paths: OUT_ROOT/YYYY-MM-DD/company-slug/HH-MM_NN_role-slug

import fs from "node:fs";
import path from "node:path";

const TZ = "America/New_York";

export function etParts(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = String(Number(parts.hour)).padStart(2, "0");
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
  };
}

export function hourEtFromBatch(batchTime) {
  return etParts(batchTime)?.hour ?? null;
}

/** Calendar date YYYY-MM-DD in America/New_York. */
export function etDateKey(iso = new Date()) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10);
}

/** UTC bounds [start, end) for an ET calendar day (0 = today). Matches job-pipeline export. */
export function etDayBoundsUtc(daysAgo = 0) {
  const dateKey = etDateKey(new Date(Date.now() - daysAgo * 86_400_000));
  const [y, m, d] = dateKey.split("-").map(Number);
  const probeBase = Date.UTC(y, m - 1, d, 5, 0, 0);

  let start = null;
  for (let delta = -12; delta <= 12; delta += 1) {
    const cand = new Date(probeBase + delta * 3_600_000);
    const parts = etParts(cand.toISOString());
    if (parts?.date === dateKey && parts.hour === "00") {
      start = cand;
      break;
    }
  }

  return {
    dateKey,
    start,
    end: start ? new Date(start.getTime() + 86_400_000) : null,
  };
}

export function parseSessionHour(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return String(n).padStart(2, "0");
}

/**
 * Return OUT_ROOT/YYYY-MM-DD using TODAY's date (ET), regardless of when the
 * job was scraped. batchTime is kept for backward-compat but no longer drives
 * the date folder — only the hour label (used for logging).
 */
export function resolveResumeSessionDir(outRoot, batchTime, sessionHourOverride = null) {
  const today = etDateKey(new Date()) || new Date().toISOString().slice(0, 10);
  const batchParts = etParts(batchTime);
  const hour = parseSessionHour(sessionHourOverride) || batchParts?.hour || "00";
  const dateDir = path.join(outRoot, today);
  fs.mkdirSync(dateDir, { recursive: true });
  return { dateDir, date: today, hour };
}
