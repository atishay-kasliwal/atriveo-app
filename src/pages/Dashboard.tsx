import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { isTop500 } from "../data/top500";
import type { Job, RunEntry } from "../types";
import JobRow from "../components/JobRow";

type Period = "hour" | "today" | "yesterday";
type SortBy = "score" | "time" | "company";
type RunCard = RunEntry & {
  count: number;
  targetPeriod: Period | null;
  displayAt: string;
  clickCount: number;
  progressPct: number;
  segmentsActive: number;
};

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

function parseDateLike(iso?: string | null): Date | null {
  if (!iso) return null;
  const value = iso.trim();
  if (!value) return null;
  const normalized = TZ_SUFFIX_RE.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMs(iso?: string | null): number {
  return parseDateLike(iso)?.getTime() ?? 0;
}

function formatRunTime(iso?: string | null): string {
  const date = parseDateLike(iso);
  if (!date) return "—";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}


export default function Dashboard() {
  const { user, logout } = useAuth();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { isExcluded, excludeCompany } = useExclusions();
  const [hourJobs, setHourJobs] = useState<Job[]>([]);
  const [todayJobs, setTodayJobs] = useState<Job[]>([]);
  const [yesterdayJobs, setYesterdayJobs] = useState<Job[]>([]);
  const [runHistory, setRunHistory] = useState<RunEntry[]>([]);
  const [period, setPeriod] = useState<Period>("hour");
  const [sortBy, setSortBy] = useState<SortBy>("time");
  const [levelFilter, setLevelFilter] = useState("all");
  const [h1bFilter, setH1bFilter] = useState(false);
  const [top500Filter, setTop500Filter] = useState(false);
  const [termFilter, setTermFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const handlePeriodChange = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    setSortBy(nextPeriod === "hour" ? "time" : "score");
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [hour, today, yesterday, runs] = await Promise.all([
        fetch("/api/jobs?type=hour").then((r) => r.json()).catch(() => []),
        fetch("/api/jobs?type=today").then((r) => r.json()).catch(() => []),
        fetch("/api/jobs?type=yesterday").then((r) => r.json()).catch(() => []),
        fetch("/api/jobs?type=runs").then((r) => r.json()).catch(() => []),
      ]);
      setHourJobs(hour);
      setTodayJobs(today);
      setYesterdayJobs(yesterday);
      setRunHistory(runs);
      setLoading(false);
    }
    load();
  }, []);

  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    [...todayJobs, ...yesterdayJobs].forEach((j) => {
      if (j.session_id) counts[j.session_id] = (counts[j.session_id] || 0) + 1;
    });
    hourJobs.forEach((j) => {
      if (!j.session_id || counts[j.session_id] !== undefined) return;
      counts[j.session_id] = (counts[j.session_id] || 0) + 1;
    });
    return counts;
  }, [hourJobs, todayJobs, yesterdayJobs]);

  const sessionPeriod = useMemo(() => {
    const map: Record<string, Period> = {};
    hourJobs.forEach((j) => { if (j.session_id) map[j.session_id] = "hour"; });
    todayJobs.forEach((j) => { if (j.session_id && !map[j.session_id]) map[j.session_id] = "today"; });
    yesterdayJobs.forEach((j) => { if (j.session_id && !map[j.session_id]) map[j.session_id] = "yesterday"; });
    return map;
  }, [hourJobs, todayJobs, yesterdayJobs]);

  const jobSessionMap = useMemo(() => {
    const map: Record<string, string> = {};
    [...hourJobs, ...todayJobs, ...yesterdayJobs].forEach((job) => {
      if (job.job_url && job.session_id) map[job.job_url] = job.session_id;
    });
    return map;
  }, [hourJobs, todayJobs, yesterdayJobs]);

  const sessionClickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.entries(stats.appliedJobs).forEach(([jobUrl, record]) => {
      const sessionId = jobSessionMap[jobUrl];
      if (!sessionId) return;
      counts[sessionId] = (counts[sessionId] || 0) + (record.clicks || 0);
    });
    return counts;
  }, [jobSessionMap, stats.appliedJobs]);

  const rawJobs = period === "hour" ? hourJobs : period === "today" ? todayJobs : yesterdayJobs;
  const baseJobs = selectedSession ? rawJobs.filter((j) => j.session_id === selectedSession) : rawJobs;

  const runCards = useMemo(() => {
    const cards: RunCard[] = runHistory
      .map((r) => ({
        ...r,
        count: sessionCounts[r.session_id] ?? r.total_jobs ?? 0,
        targetPeriod: sessionPeriod[r.session_id] ?? null,
        displayAt: r.run_at || r.session_id,
        clickCount: sessionClickCounts[r.session_id] ?? 0,
        progressPct: 0,
        segmentsActive: 0,
      }))
      .filter((r) => r.count > 0 && r.targetPeriod)
      .slice(0, 20);
    return cards.map((r) => {
      const progress = r.count > 0 ? r.clickCount / r.count : 0;
      return {
        ...r,
        progressPct: Math.min(100, Math.round(progress * 100)),
        segmentsActive: Math.min(24, Math.max(0, Math.round(progress * 24))),
      };
    });
  }, [runHistory, sessionCounts, sessionPeriod, sessionClickCounts]);

  const filtered = useMemo(() => {
    let jobs = [...baseJobs];
    if (levelFilter !== "all") jobs = jobs.filter((j) => j.level === levelFilter);
    if (h1bFilter) jobs = jobs.filter((j) => j.score_pct >= 60);
    if (top500Filter) jobs = jobs.filter((j) => isTop500(j.company || ""));
    if (termFilter !== "all") jobs = jobs.filter((j) => j.search_term === termFilter);
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter(
        (j) =>
          j.title?.toLowerCase().includes(q) ||
          j.company?.toLowerCase().includes(q) ||
          j.location?.toLowerCase().includes(q)
      );
    }
    jobs = jobs.filter((j) => !isExcluded(j));
    if (sortBy === "score") jobs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    else if (sortBy === "company") jobs.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
    else jobs.sort((a, b) => toMs(b.batch_time) - toMs(a.batch_time));
    // Push applied jobs to the bottom so unapplied stay front-and-centre
    const appliedSet = new Set(Object.keys(stats.appliedJobs));
    return [
      ...jobs.filter((j) => !j.job_url || !appliedSet.has(j.job_url)),
      ...jobs.filter((j) => j.job_url  &&  appliedSet.has(j.job_url)),
    ];
  }, [baseJobs, levelFilter, h1bFilter, top500Filter, termFilter, query, sortBy, stats.appliedJobs, isExcluded]);

  const searchTerms = useMemo(
    () => [...new Set(rawJobs.map((j) => j.search_term).filter(Boolean))],
    [rawJobs]
  );

  const ngCount = filtered.filter((j) => j.level === "New Grad").length;
  const bestJob = [...todayJobs].sort((a, b) => (b.score_pct ?? 0) - (a.score_pct ?? 0))[0];
  const top500TodayTotal = useMemo(
    () => todayJobs.filter((j) => isTop500(j.company || "")).length,
    [todayJobs]
  );
  const top500AppliedToday = useMemo(() => {
    const todayEst = new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
    return Object.values(stats.appliedJobs).filter(
      (r) => isTop500(r.company || "") && r.lastAppliedAt.slice(0, 10) === todayEst
    ).length;
  }, [stats.appliedJobs]);
  const latestClickRecord = useMemo(
    () =>
      Object.values(stats.appliedJobs).reduce<{
        clicks: number;
        lastAppliedAt: string;
        title: string | null;
        company: string | null;
        trackerStatus: "applied" | "rejected" | null;
      } | null>((latest, record) => {
        if (!latest) return record;
        return record.lastAppliedAt > latest.lastAppliedAt ? record : latest;
      }, null),
    [stats.appliedJobs]
  );

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Job Feed</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab active">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
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
            <div className="kpi-label">This Hour</div>
            <div className="kpi-value">{hourJobs.length}</div>
            <div className="kpi-sub">{hourJobs.filter((j) => j.level === "New Grad").length} new grad</div>
          </div>
          <div className="kpi-card emerald">
            <div className="kpi-label">Today Total</div>
            <div className="kpi-value">{todayJobs.length}</div>
            <div className="kpi-sub">{runHistory.length} runs</div>
          </div>
          <div className="kpi-card teal">
            <div className="kpi-label">New Grad</div>
            <div className="kpi-value">{todayJobs.filter((j) => j.level === "New Grad").length}</div>
            <div className="kpi-sub">today</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-label">Best Match</div>
            <div className="kpi-value">{bestJob ? `${bestJob.score_pct}%` : "—"}</div>
            <div className="kpi-sub">{bestJob?.company?.slice(0, 20) ?? "—"}</div>
          </div>
          <div className="kpi-card purple">
            <div className="kpi-label">Applied Today</div>
            <div className="kpi-value">{stats.todayCount ?? 0}<span className="kpi-value-secondary">/{stats.count}</span></div>
            <div className="kpi-sub">{latestClickRecord?.company ? latestClickRecord.company.slice(0, 20) : "none yet"}</div>
          </div>
          <div className="kpi-card rose">
            <div className="kpi-label">Top 500 Applied</div>
            <div className="kpi-value">{top500AppliedToday}<span className="kpi-value-secondary">/{top500TodayTotal}</span></div>
            <div className="kpi-sub">{top500TodayTotal} top-co today</div>
          </div>
        </div>

        {/* Period tabs + sort */}
        <div className="top-bar">
          <div className="period-tabs">
            {(["hour", "today", "yesterday"] as Period[]).map((p) => (
              <button
                key={p}
                className={`period-tab${period === p ? " active" : ""}`}
                onClick={() => {
                  handlePeriodChange(p);
                  setTermFilter("all");
                  setSelectedSession(null);
                }}
              >
                {p === "hour" ? "This Hour" : p.charAt(0).toUpperCase() + p.slice(1)}
                <span className="count">
                  {p === "hour" ? hourJobs.length : p === "today" ? todayJobs.length : yesterdayJobs.length}
                </span>
              </button>
            ))}
            <a href="/weekly" className="period-tab">
              7 Days
            </a>
          </div>
          <div className="sort-group">
            <button className={`sort-btn${sortBy === "score" ? " active" : ""}`} onClick={() => setSortBy("score")}>★ Score</button>
            <button className={`sort-btn${sortBy === "time" ? " active" : ""}`} onClick={() => setSortBy("time")}>↓ Recent</button>
          </div>
        </div>

        {/* Run history strip */}
        <div className="run-strip-wrap">
          <div className="run-strip">
            {runCards.map((r) => {
              const isActive = selectedSession === r.session_id;
              return (
                <div
                  key={r.session_id}
                  className={`run-card${isActive ? " active" : ""}`}
                  onClick={() => {
                    if (isActive) {
                      setSelectedSession(null);
                    } else {
                      setSelectedSession(r.session_id);
                      if (r.targetPeriod) handlePeriodChange(r.targetPeriod);
                      setTermFilter("all");
                    }
                  }}
                >
                  <div className="run-card-content">
                    <div className="run-card-head">
                      <span className="run-card-time">{formatRunTime(r.displayAt)}</span>
                      <span className="run-card-pill">{r.progressPct}%</span>
                    </div>
                    <div className="run-card-countline">
                      <span className="run-card-clicks">{r.clickCount} clicks</span>
                      <span className="run-card-count">{r.count} jobs</span>
                    </div>
                    <div className="run-card-bars" aria-hidden="true">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <span
                          key={i}
                          className={`run-card-bar${i < r.segmentsActive ? " active" : ""}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-layout">
          <div className="right-panel">
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
                  className={`chip-toggle${h1bFilter ? " active" : ""}`}
                  onClick={() => setH1bFilter((v) => !v)}
                >
                  H1B ✓
                </button>
                <button
                  className={`chip-toggle chip-toggle-purple${top500Filter ? " active" : ""}`}
                  onClick={() => setTop500Filter((v) => !v)}
                >
                  Top 500
                </button>
              </div>
              <select
                className="term-select"
                value={termFilter}
                onChange={(e) => setTermFilter(e.target.value)}
              >
                <option value="all">All search terms</option>
                {searchTerms.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="result-meta">
              {filtered.length} job{filtered.length !== 1 ? "s" : ""}
              {ngCount ? ` · ${ngCount} New Grad` : ""}
            </div>

            {/* Job list */}
            <div className="job-list">
              {loading ? (
                <div className="state-msg"><div className="icon">⏳</div>Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="state-msg"><div className="icon">🔍</div>No jobs found</div>
              ) : (
                <>
                  <div className="job-list-header">
                    <span /><span />
                    <span>Role</span>
                    <span style={{ textAlign: "right" }}>Score</span>
                    <span
                      className={`col-sort${sortBy === "company" ? " active" : ""}`}
                      onClick={() => setSortBy("company")}
                      title="Sort by company"
                    >Company {sortBy === "company" ? "↑" : ""}</span>
                    <span style={{ textAlign: "right" }}>Match</span>
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
        </div>
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Runs hourly 12 AM – 11 PM
        </div>
      </footer>
    </div>
  );
}
