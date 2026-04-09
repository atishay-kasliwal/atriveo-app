import { useMemo } from "react";
import type { Job } from "../types";

interface Props {
  jobs: Job[];
}

function BarRow({ label, count, max, color }: { label: string; count: number; max: number; color?: string }) {
  return (
    <div className="chart-row">
      <span className="chart-label">{label}</span>
      <div className="chart-bar-wrap">
        <div className={`chart-bar${color ? ` ${color}` : ""}`} style={{ width: `${(count / Math.max(max, 1)) * 100}%` }} />
      </div>
      <span className="chart-count">{count}</span>
    </div>
  );
}

export default function Sidebar({ jobs }: Props) {
  const scoreBuckets = [
    { label: "80–100%", fn: (j: Job) => (j.score_pct ?? 0) >= 80, color: "" },
    { label: "60–79%",  fn: (j: Job) => (j.score_pct ?? 0) >= 60 && (j.score_pct ?? 0) < 80, color: "green" },
    { label: "40–59%",  fn: (j: Job) => (j.score_pct ?? 0) >= 40 && (j.score_pct ?? 0) < 60, color: "orange" },
    { label: "< 40%",   fn: (j: Job) => (j.score_pct ?? 0) < 40, color: "muted" },
  ];

  const levelBuckets = [
    { label: "New Grad", fn: (j: Job) => j.level === "New Grad", color: "green" },
    { label: "Entry",    fn: (j: Job) => j.level === "Entry", color: "" },
    { label: "Mid",      fn: (j: Job) => j.level === "Mid", color: "orange" },
  ];

  const expBuckets = [
    { label: "0–1 yr",    fn: (j: Job) => j.min_exp !== null && j.min_exp !== undefined && (j.min_exp ?? 0) <= 1, color: "green" },
    { label: "1–2 yrs",   fn: (j: Job) => (j.min_exp ?? 0) > 1 && (j.min_exp ?? 0) <= 2, color: "" },
    { label: "2–3 yrs",   fn: (j: Job) => (j.min_exp ?? 0) > 2 && (j.min_exp ?? 0) <= 3, color: "orange" },
    { label: "Not listed", fn: (j: Job) => j.min_exp === null || j.min_exp === undefined, color: "muted" },
  ];

  const topCompanies = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach((j) => { if (j.company) counts[j.company] = (counts[j.company] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50);
  }, [jobs]);

  const scoreMax = Math.max(...scoreBuckets.map((b) => jobs.filter(b.fn).length), 1);
  const levelMax = Math.max(...levelBuckets.map((b) => jobs.filter(b.fn).length), 1);
  const expMax   = Math.max(...expBuckets.map((b) => jobs.filter(b.fn).length), 1);
  const compMax  = Math.max(...topCompanies.map(([, c]) => c), 1);

  return (
    <aside className="left-panel">
      <div className="panel-card">
        <div className="panel-title">Match Score</div>
        {scoreBuckets.map((b) => (
          <BarRow key={b.label} label={b.label} count={jobs.filter(b.fn).length} max={scoreMax} color={b.color} />
        ))}
      </div>

      <div className="panel-card">
        <div className="panel-title">Level Breakdown</div>
        {levelBuckets.map((b) => (
          <BarRow key={b.label} label={b.label} count={jobs.filter(b.fn).length} max={levelMax} color={b.color} />
        ))}
      </div>

      <div className="panel-card">
        <div className="panel-title">Experience Required</div>
        {expBuckets.map((b) => (
          <BarRow key={b.label} label={b.label} count={jobs.filter(b.fn).length} max={expMax} color={b.color} />
        ))}
      </div>

      <div className="panel-card">
        <div className="panel-title">Top Companies</div>
        <div style={{ maxHeight: "340px", overflowY: "auto" }}>
          {topCompanies.map(([name, count]) => (
            <BarRow key={name} label={name} count={count} max={compMax} />
          ))}
        </div>
      </div>
    </aside>
  );
}
