// The one definition of "applied", read by the Mac widget, the Applied page, Matching's progress, Today's goal and history.
// An applied item is a tracked application that was submitted, or a job you marked applied that no tracked application covers
// (each such job once). Nothing else counts, so every screen shows the same numbers.

export const APPLIED_TZ = "America/New_York";
const formats = new Map();
export function dayKeyOf(value, timeZone = APPLIED_TZ) {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  let f = formats.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); formats.set(timeZone, f); }
  return f.format(new Date(t));
}
/** A day key moved by whole days (calendar arithmetic, so a daylight-saving change never skips or repeats a day). */
export const shiftDay = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function appliedItems(applications, swipes) {
  const items = [];
  const linked = new Set(applications.flatMap((a) => a.jobUrls || []));
  for (const a of applications) {
    // A tracked application with no recorded time still counts in the total (it was submitted), just on no day.
    const at = a.lifecycle?.appliedAt || a.submission?.submittedAt;
    items.push({ kind: "application", key: `a:${a._id}`, id: String(a._id), appliedAt: Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null, jobUrl: (a.jobUrls || [])[0] ?? null });
  }
  const seen = new Set();
  for (const s of swipes) {
    if (s.direction !== "applied" || linked.has(s.job_url) || seen.has(s.job_url)) continue;
    const at = s.applied_at || s.swiped_at;
    seen.add(s.job_url);
    items.push({ kind: "marked", key: `m:${s.job_url}`, id: null, appliedAt: Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null, jobUrl: s.job_url });
  }
  return items;
}

/** Applied per day for the last `days` days (oldest first), today's count and the total. */
export function appliedCounts(items, { now = new Date(), timeZone = APPLIED_TZ, days = 14 } = {}) {
  const byDay = new Map();
  for (const it of items) { const d = it.appliedAt ? dayKeyOf(it.appliedAt, timeZone) : null; if (d) byDay.set(d, (byDay.get(d) || 0) + 1); }
  const today = dayKeyOf(now, timeZone);
  const list = [];
  for (let i = days - 1; i >= 0; i--) { const day = shiftDay(today, -i); list.push({ day, applied: byDay.get(day) || 0 }); }
  const weekAgo = shiftDay(today, -6);
  return { dayKey: today, today: byDay.get(today) || 0, total: items.length, last7: list.filter((d) => d.day >= weekAgo).reduce((n, d) => n + d.applied, 0), days: list };
}

export async function loadAppliedItems(db) {
  const [applications, swipes] = await Promise.all([
    db.collection("applications").find({ status: "APPLIED" }, { projection: { _id: 1, jobUrls: 1, "lifecycle.appliedAt": 1, "submission.submittedAt": 1 } }).toArray(),
    db.collection("job_swipes").find({ direction: "applied" }, { projection: { _id: 0, job_url: 1, direction: 1, applied_at: 1, swiped_at: 1 } }).toArray(),
  ]);
  return appliedItems(applications, swipes);
}

let memo = { at: 0, key: "", value: null };
/** What every screen reads: GET /applications/applied-summary. Kept for ten seconds, since Today asks every half minute. */
export async function appliedSummary(db, { days = 14, now = new Date(), timeZone = APPLIED_TZ } = {}) {
  const n = Math.min(400, Math.max(1, Math.round(days) || 14)), key = `${n}|${timeZone}`;
  if (memo.value && memo.key === key && now.getTime() - memo.at < 10_000) return memo.value;
  const value = { ok: true, timeZone, generatedAt: now.toISOString(), ...appliedCounts(await loadAppliedItems(db), { now, timeZone, days: n }) };
  memo = { at: now.getTime(), key, value };
  return value;
}
