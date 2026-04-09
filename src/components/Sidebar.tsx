import { useMemo } from "react";
import type { Job } from "../types";

interface Props {
  jobs: Job[];
}

export default function Sidebar({ jobs }: Props) {
  const scoreBuckets = [
    { label: "80–100%", fn: (j: Job) => (j.score_pct ?? 0) >= 80 },
    { label: "60–79%",  fn: (j: Job) => (j.score_pct ?? 0) >= 60 && (j.score_pct ?? 0) < 80 },
    { label: "40–59%",  fn: (j: Job) => (j.score_pct ?? 0) >= 40 && (j.score_pct ?? 0) < 60 },
    { label: "< 40%",   fn: (j: Job) => (j.score_pct ?? 0) < 40 },
  ];

  const levelBuckets = [
    { label: "New Grad", fn: (j: Job) => j.level === "New Grad" },
    { label: "Entry",    fn: (j: Job) => j.level === "Entry" },
    { label: "Mid",      fn: (j: Job) => j.level === "Mid" },
  ];

  const topCompanies = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach((j) => { if (j.company) counts[j.company] = (counts[j.company] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50);
  }, [jobs]);

  const maxScore = Math.max(...scoreBuckets.map((b) => jobs.filter(b.fn).length), 1);
  const maxLevel = Math.max(...levelBuckets.map((b) => jobs.filter(b.fn).length), 1);
  const maxComp  = Math.max(...topCompanies.map(([, c]) => c), 1);

  return (
    <aside className="left-panel">
      <div className="panel-card">
        <div className="panel-title">Match Score</div>
        {scoreBuckets.map((b) => {
          const count = jobs.filter(b.fn).length;
          return (
            <div key={b.label} className="chart-row">
              <span className="chart-label">{b.label}</span>
              <div className="chart-bar-wrap">
                <div className="chart-bar" style={{ width: `${(count / maxScore) * 100}%` }} />
              </div>
              <span className="chart-count">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="panel-card">
        <div className="panel-title">Level Breakdown</div>
        {levelBuckets.map((b) => {
          const count = jobs.filter(b.fn).length;
          return (
            <div key={b.label} className="chart-row">
              <span className="chart-label">{b.label}</span>
              <div className="chart-bar-wrap">
                <div className="chart-bar" style={{ width: `${(count / maxLevel) * 100}%` }} />
              </div>
              <span className="chart-count">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="panel-card">
        <div className="panel-title">Top Companies</div>
        <div style={{ maxHeight: "340px", overflowY: "auto" }}>
          {topCompanies.map(([name, count]) => (
            <div key={name} className="chart-row">
              <span className="chart-label">{name}</span>
              <div className="chart-bar-wrap">
                <div className="chart-bar" style={{ width: `${(count / maxComp) * 100}%` }} />
              </div>
              <span className="chart-count">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
