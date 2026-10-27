import { dayKeyOf, shiftDay } from "./applied-core.mjs";
import { trackOf } from "./applications-analytics.mjs";
import { streakOf, tierOf } from "./phone-summary.mjs";

// The numbers behind the Stats page: how much you apply and how it is going, where it stands with replies, where you apply, and what is
// waiting. Everything is derived from the same applied rows the Applied page uses, so the figures agree. Counts and company-free summaries only.

const DAY = 86_400_000;
const median = (list) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tally = (items) => { const m = new Map(); for (const k of items) m.set(k, (m.get(k) ?? 0) + 1); return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)); };

/** Pure: the whole answer from the applied rows (appliedAt, source, title, outcome, mail) and the few other facts. */
export function buildInsights({ rows, goal, now = Date.now(), pipeline = null, general = null, assessments = [] }) {
  const today = dayKeyOf(new Date(now));
  const keys = Array.from({ length: 30 }, (_, i) => shiftDay(today, i - 29));
  const byDay = new Map(keys.map((k) => [k, 0]));
  const recent = [];
  for (const r of rows) {
    const day = dayKeyOf(r.appliedAt);
    if (day && byDay.has(day)) { byDay.set(day, byDay.get(day) + 1); recent.push(r); }
  }
  const days = keys.map((day) => ({ day, applied: byDay.get(day) }));
  const sum = (from, to) => days.slice(from, to).reduce((n, d) => n + d.applied, 0);
  const todayCount = days[29].applied, last7 = sum(23, 30), prev7 = sum(16, 23);
  const best = days.reduce((b, d) => (d.applied > b.applied ? d : b), { day: null, applied: 0 });

  const settled = rows.filter((r) => Date.parse(r.appliedAt) <= now - 7 * DAY);
  const replied = (list) => list.filter((r) => r.outcome).length;
  const delays = rows.filter((r) => r.mail?.length && r.appliedAt).map((r) => (Date.parse(r.mail[0].at) - Date.parse(r.appliedAt)) / DAY).filter((d) => d >= 0 && d < 90);
  const outcome = (kind) => rows.filter((r) => r.outcome?.status === kind).length;
  const funnel = {
    applied: rows.length, replied: replied(rows), interview: outcome("interview"), assessment: outcome("assessment"), offer: outcome("offer"), rejected: outcome("rejected"), none: rows.filter((r) => !r.outcome).length,
    replyRate: settled.length >= 10 ? Math.round((replied(settled) / settled.length) * 100) : null,
    medianReplyDays: delays.length >= 3 ? Math.round(median(delays) * 10) / 10 : null,
  };
  // How many days reached each lap of the goal (goal, 2x, 3x ...): over the last 30 days and over everything.
  const g = Math.max(1, goal), perDay = new Map();
  for (const r of rows) { const day = dayKeyOf(r.appliedAt); if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1); }
  const counts = [...perDay.values()], topDay = Math.max(0, ...counts), maxLap = Math.min(Math.floor(2000 / g), Math.floor(topDay / g));
  const milestones = Array.from({ length: Math.min(maxLap, 12) }, (_, i) => { const lap = i + 1, need = lap * g; return { lap, need, days30: days.filter((d) => d.applied >= need).length, daysAll: counts.filter((c) => c >= need).length }; });
  const open = assessments;
  const next = open.find((a) => a.deadlineAt && a.state !== "unknown") ?? null;
  return {
    ok: true, generatedAt: new Date(now).toISOString(), today: { applied: todayCount, goal, tier: tierOf(todayCount, goal), fraction: Math.min(1, todayCount / Math.max(1, goal)) },
    totals: { today: todayCount, last7, prev7, last30: sum(0, 30), all: rows.length, avg7: Math.round((last7 / 7) * 10) / 10 }, best, streak: streakOf(days, today, goal, todayCount), days,
    sources: tally(recent.map((r) => String(r.source || "other").toLowerCase())).slice(0, 6),
    tracks: tally(recent.map((r) => trackOf(r.title) || "other")).slice(0, 6), funnel,
    pipeline: pipeline ? { done: pipeline.done ?? 0, queued: pipeline.queued ?? 0, running: pipeline.running ?? 0, failed: pipeline.failed ?? 0 } : null,
    milestones, milestoneMore: Math.max(0, maxLap - 12),
    waiting: { general }, assessments: { open: open.length, unknown: open.filter((a) => a.state === "unknown").length, next: next ? { company: next.company, deadlineAt: next.deadlineAt, state: next.state, when: next.when } : null },
  };
}

let memo = { at: 0, value: null };
/** The page's data, read from Mongo; cached for a minute because it reads every application. */
export async function insights(db, { now = Date.now(), outRoot } = {}) {
  if (memo.value && now - memo.at < 60_000) return memo.value;
  const [{ loadAppliedRows }, { readGoal }, { resumePipeline }, { generalCount }, { listAssessments }] = await Promise.all([
    import("./applied-history.mjs"), import("./phone-summary.mjs"), import("./resume-queue.mjs"), import("./no-text-jobs.mjs"), import("./assessments.mjs")]);
  const [{ all }, goal, pipeline, general, assessments] = await Promise.all([
    loadAppliedRows(db, { now }), readGoal(db),
    resumePipeline(db, { now }).catch(() => null), generalCount(db, { period: "all", outRoot, now }).catch(() => null), listAssessments(db, { now }).catch(() => [])]);
  const value = buildInsights({ rows: all, goal, now, pipeline, general, assessments });
  memo = { at: now, value };
  return value;
}
