// Resume output paths: OUT_ROOT/YYYY-MM-DD/HH/NN_company-role

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

export function parseSessionHour(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return String(n).padStart(2, "0");
}

/** Ensure OUT_ROOT/date/hour exists; return that hour directory. */
export function resolveResumeSessionDir(outRoot, batchTime, sessionHourOverride = null) {
  const parts = etParts(batchTime);
  const date = parts?.date || new Date().toISOString().slice(0, 10);
  const hour = parseSessionHour(sessionHourOverride) || parts?.hour || "00";
  const dateDir = path.join(outRoot, date, hour);
  fs.mkdirSync(dateDir, { recursive: true });
  return { dateDir, date, hour };
}
