import { streakOf, useAppliedToday, useApplyHistory } from "../apply/todayGoal";

// Applied per day for the last 12 weeks, GitHub-style: a column per week (Sunday on top), darker green = more.

export default function ApplyHeatmap() {
  const rows = useApplyHistory(84);
  // Today as Today counts it (LinkedIn postings you marked applied included), so both pages show the same streak.
  const today = useAppliedToday().applied ?? 0;
  if (!rows) return <div className="apps-heatmap apps-muted">Loading your last 12 weeks…</div>;
  const max = Math.max(1, ...rows.map((r) => r.applied));
  const lead = new Date(`${rows[0]?.day ?? "2026-01-01"}T12:00:00Z`).getUTCDay();
  const cells: Array<{ day: string; applied: number } | null> = [...Array.from({ length: lead }, () => null), ...rows];
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const total = rows.reduce((s, r) => s + r.applied, 0);
  const active = rows.filter((r) => r.applied > 0).length;
  return (
    <figure className="apps-heatmap" aria-label={`Applications per day, last 12 weeks: ${total} in all`}>
      <figcaption><b>{streakOf(rows, today)}-day streak</b><span className="apps-muted"> · {total} applied in 12 weeks · {active} active days · weekends don't break a streak</span></figcaption>
      <div className="apps-heatmap-grid">
        {cells.map((c, i) => c ? <i key={c.day} className={`l${level(c.applied)}`} title={`${c.day}: ${c.applied} applied`} /> : <i key={`pad${i}`} className="pad" />)}
      </div>
    </figure>
  );
}
