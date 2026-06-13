/** Parse queue/process log timestamps stored as ISO or legacy locale strings. */
export function parseProcessLogAt(value: string): Date | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime()) && /[tT]|Z|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return iso;
  }
  const today = new Date().toDateString();
  const locale = new Date(`${today} ${trimmed}`);
  if (!Number.isNaN(locale.getTime())) return locale;
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Queue log wall time — always `h:mm:ss AM/PM`. */
export function formatProcessLogTime(date = new Date()): string {
  const h24 = date.getHours();
  const h12 = h24 % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  return `${h12}:${m}:${s} ${ampm}`;
}

/** Process step log — 24h `HH:MM:SS`. */
export function formatProcessLogTime24(value: string | Date): string {
  const date = value instanceof Date ? value : parseProcessLogAt(value);
  if (!date) return "—";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Render any stored `at` value with seconds (handles legacy entries). */
export function displayProcessLogAt(value: string): string {
  const date = parseProcessLogAt(value);
  return date ? formatProcessLogTime(date) : value || "—";
}
