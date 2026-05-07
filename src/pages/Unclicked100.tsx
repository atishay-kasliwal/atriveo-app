import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import type { Job } from "../types";
import JobCard from "../components/JobCard";

type WeekJob = Job & { scraped_date?: string };

export default function Unclicked100() {
  const { user, logout } = useAuth();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { isExcluded } = useExclusions();
  const [weekJobs, setWeekJobs] = useState<WeekJob[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs?type=week")
      .then((r) => r.json())
      .then((data) => {
        setWeekJobs(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const appliedSet = useMemo(() => new Set(Object.keys(stats.appliedJobs)), [stats.appliedJobs]);

  const hundredPlus = useMemo(
    () => weekJobs.filter((j) => (j.score ?? 0) >= 100),
    [weekJobs]
  );

  const unclicked = useMemo(
    () => hundredPlus.filter((j) => !j.job_url || !appliedSet.has(j.job_url)),
    [hundredPlus, appliedSet]
  );

  const filtered = useMemo(() => {
    let jobs = unclicked.filter((j) => !isExcluded(j));
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter((j) =>
        [j.title, j.company, j.location].some((v) => (v || "").toLowerCase().includes(q))
      );
    }
    return [...jobs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [unclicked, query, isExcluded]);

  const topScore = useMemo(
    () => hundredPlus.reduce((m, j) => Math.max(m, j.score ?? 0), 0),
    [hundredPlus]
  );

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">100+ Unclicked</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/unclicked-100" className="nav-tab active">100+ Unclicked</a>
              <a href="/skills" className="nav-tab">Skills</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper">
        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-value">{hundredPlus.length}</div>
            <div className="kpi-label">Weekly 100+</div>
            <div className="kpi-sub">score ≥ 100 this week</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-value">{unclicked.length}</div>
            <div className="kpi-label">Unclicked</div>
            <div className="kpi-sub">not yet applied</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-value">{hundredPlus.length - unclicked.length}</div>
            <div className="kpi-label">Clicked</div>
            <div className="kpi-sub">already applied</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{topScore}</div>
            <div className="kpi-label">Top Score</div>
            <div className="kpi-sub">best match this week</div>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Search jobs, companies, locations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="result-meta">
          {filtered.length} job{filtered.length !== 1 ? "s" : ""} · weekly · score ≥ 100 · unclicked
        </div>

        {loading ? (
          <div className="state-msg"><div className="icon">⏳</div>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="state-msg"><div className="icon">🎉</div>No unclicked 100+ jobs</div>
        ) : (
          <div className="card-grid">
            {filtered.map((job, i) => (
              <JobCard
                key={job.job_url || i}
                job={job}
                applyRecord={job.job_url ? getRecord(job.job_url) : null}
                onApplyClick={recordClick}
              />
            ))}
          </div>
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Weekly · Score ≥ 100 · Not yet applied
        </div>
      </footer>
    </div>
  );
}
