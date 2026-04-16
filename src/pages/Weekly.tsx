import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { isTop500 } from "../data/top500";
import type { Job } from "../types";
import JobRow from "../components/JobRow";

type WeekJob = Job & { scraped_date?: string };

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

function dayLabel(dateStr: string): string {
  const today = todayLocal();
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  const yesterday = d.toLocaleDateString("en-CA");
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  const dt = new Date(dateStr + "T12:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function Weekly() {
  const { user, logout } = useAuth();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { isExcluded, excludeCompany } = useExclusions();
  const [weekJobs, setWeekJobs] = useState<WeekJob[]>([]);
  const [activeDay, setActiveDay] = useState("All");
  const [levelFilter, setLevelFilter] = useState("all");
  const [top500Filter, setTop500Filter] = useState(false);
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

  const days = useMemo(() => {
    const dates = [...new Set(weekJobs.map((j) => j.scraped_date).filter(Boolean) as string[])]
      .sort()
      .reverse();
    return ["All", ...dates];
  }, [weekJobs]);

  const dayCounts = useMemo(() => {
    const map: Record<string, number> = { All: weekJobs.length };
    weekJobs.forEach((j) => {
      if (j.scraped_date) map[j.scraped_date] = (map[j.scraped_date] || 0) + 1;
    });
    return map;
  }, [weekJobs]);

  const filtered = useMemo(() => {
    let jobs: WeekJob[] =
      activeDay === "All" ? weekJobs : weekJobs.filter((j) => j.scraped_date === activeDay);
    if (levelFilter !== "all") jobs = jobs.filter((j) => j.level === levelFilter);
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter((j) =>
        [j.title, j.company, j.location].some((v) => (v || "").toLowerCase().includes(q))
      );
    }
    jobs = jobs.filter((j) => !isExcluded(j));
    if (top500Filter) jobs = jobs.filter((j) => isTop500(j.company || ""));
    jobs = [...jobs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    // Push applied jobs to the bottom so unapplied stay front-and-centre
    const appliedSet = new Set(Object.keys(stats.appliedJobs));
    return [
      ...jobs.filter((j) => !j.job_url || !appliedSet.has(j.job_url)),
      ...jobs.filter((j) => j.job_url  &&  appliedSet.has(j.job_url)),
    ];
  }, [weekJobs, activeDay, levelFilter, top500Filter, query, stats.appliedJobs, isExcluded]);

  const uniqueCompanies = useMemo(
    () => new Set(weekJobs.map((j) => j.company).filter(Boolean)).size,
    [weekJobs]
  );
  const topScore = useMemo(
    () => weekJobs.reduce((m, j) => Math.max(m, j.score ?? 0), 0),
    [weekJobs]
  );
  const ngCount = filtered.filter((j) => j.level === "New Grad").length;
  const todayCount = weekJobs.filter((j) => j.scraped_date === todayLocal()).length;

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Weekly View</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab active">Weekly</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper">
        {/* KPIs */}
        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-value">{weekJobs.length}</div>
            <div className="kpi-label">This Week</div>
            <div className="kpi-sub">unique postings</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-value">{uniqueCompanies}</div>
            <div className="kpi-label">Companies</div>
            <div className="kpi-sub">unique employers</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{topScore}</div>
            <div className="kpi-label">Top Score</div>
            <div className="kpi-sub">best match this week</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-value">{weekJobs.filter((j) => j.level === "New Grad").length}</div>
            <div className="kpi-label">New Grad</div>
            <div className="kpi-sub">entry-level roles</div>
          </div>
          <div className="kpi-card purple">
            <div className="kpi-value">{todayCount}</div>
            <div className="kpi-label">Today's New</div>
            <div className="kpi-sub">fresh postings</div>
          </div>
        </div>

        {/* Day chips */}
        <div className="week-day-strip">
          {days.map((d) => (
            <button
              key={d}
              className={`week-day-chip${activeDay === d ? " active" : ""}`}
              onClick={() => setActiveDay(d)}
            >
              {d === "All" ? "All Days" : dayLabel(d)}
              <span className="week-day-count">{dayCounts[d] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Filters */}
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
          <div className="level-chips">
            {["all", "New Grad", "Entry", "Mid"].map((l) => (
              <button
                key={l}
                className={`chip${levelFilter === l ? " active" : ""}`}
                onClick={() => setLevelFilter(l)}
              >
                {l === "all" ? "All" : l}
              </button>
            ))}
            <button
              className={`chip-toggle chip-toggle-purple${top500Filter ? " active" : ""}`}
              onClick={() => setTop500Filter((v) => !v)}
            >
              Top 500
            </button>
          </div>
        </div>

        <div className="result-meta">
          {filtered.length} job{filtered.length !== 1 ? "s" : ""}
          {ngCount ? ` · ${ngCount} New Grad` : ""}
          {activeDay !== "All" ? ` · ${dayLabel(activeDay)}` : " · last 7 days"}
        </div>

        {/* Job list */}
        <div className="job-list">
          {loading ? (
            <div className="state-msg">
              <div className="icon">⏳</div>Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="state-msg">
              <div className="icon">🔍</div>No jobs found
            </div>
          ) : (
            <>
              <div className="job-list-header">
                <span />
                <span />
                <span>Role</span>
                <span style={{ textAlign: "right" }}>Score</span>
                <span style={{ textAlign: "right" }}>Match</span>
                <span style={{ textAlign: "right" }}>Tag</span>
                <span style={{ textAlign: "right" }}>Level</span>
                <span style={{ textAlign: "right" }}>Apply</span>
              </div>
              {filtered.map((job, i) => (
                <JobRow
                  key={job.job_url || i}
                  job={job}
                  index={i}
                  applyRecord={job.job_url ? getRecord(job.job_url) : null}
                  onApplyClick={recordClick}
                  onExcludeCompany={excludeCompany}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Last 7 days · Deduplicated
        </div>
      </footer>
    </div>
  );
}
