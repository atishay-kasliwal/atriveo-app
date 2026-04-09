import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApplyTracker } from "../hooks/useApplyTracker";
import type { Job, RunEntry } from "../types";
import JobRow from "../components/JobRow";

type Period = "hour" | "today" | "yesterday";
type SortBy = "score" | "time";

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

function fmtClickTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const [hourJobs, setHourJobs] = useState<Job[]>([]);
  const [todayJobs, setTodayJobs] = useState<Job[]>([]);
  const [yesterdayJobs, setYesterdayJobs] = useState<Job[]>([]);
  const [runHistory, setRunHistory] = useState<RunEntry[]>([]);
  const [period, setPeriod] = useState<Period>("hour");
  const [sortBy, setSortBy] = useState<SortBy>("time");
  const [levelFilter, setLevelFilter] = useState("all");
  const [h1bFilter, setH1bFilter] = useState(false);
  const [termFilter, setTermFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

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

  const rawJobs = period === "hour" ? hourJobs : period === "today" ? todayJobs : yesterdayJobs;
  const baseJobs = selectedSession ? rawJobs.filter((j) => j.session_id === selectedSession) : rawJobs;

  const runCards = useMemo(() => {
    return runHistory
      .map((r) => ({
        ...r,
        count: sessionCounts[r.session_id] ?? r.total_jobs ?? 0,
        targetPeriod: sessionPeriod[r.session_id] ?? null,
        displayAt: r.run_at || r.session_id,
      }))
      .filter((r) => r.count > 0 && r.targetPeriod && r.targetPeriod !== "yesterday")
      .slice(0, 20);
  }, [runHistory, sessionCounts, sessionPeriod]);

  const filtered = useMemo(() => {
    let jobs = [...baseJobs];
    if (levelFilter !== "all") jobs = jobs.filter((j) => j.level === levelFilter);
    if (h1bFilter) jobs = jobs.filter((j) => j.score_pct >= 60);
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
    if (sortBy === "score") jobs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    else jobs.sort((a, b) => toMs(b.batch_time) - toMs(a.batch_time));
    return jobs;
  }, [baseJobs, levelFilter, h1bFilter, termFilter, query, sortBy]);

  const searchTerms = useMemo(
    () => [...new Set(rawJobs.map((j) => j.search_term).filter(Boolean))],
    [rawJobs]
  );

  const ngCount = filtered.filter((j) => j.level === "New Grad").length;
  const bestJob = [...todayJobs].sort((a, b) => (b.score_pct ?? 0) - (a.score_pct ?? 0))[0];
  const clickedJobCount = Object.keys(stats.appliedJobs).length;
  const lastJobText = stats.lastJobTitle
    ? `${stats.lastJobTitle}${stats.lastCompany ? ` · ${stats.lastCompany}` : ""}`
    : "—";

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
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper">
        {/* KPIs */}
        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-value">{hourJobs.length}</div>
            <div className="kpi-label">This Hour</div>
            <div className="kpi-sub">{hourJobs.filter((j) => j.level === "New Grad").length} New Grad</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-value">{todayJobs.length}</div>
            <div className="kpi-label">Today Total</div>
            <div className="kpi-sub">across {runHistory.length} runs</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{todayJobs.filter((j) => j.level === "New Grad").length}</div>
            <div className="kpi-label">New Grad</div>
            <div className="kpi-sub">across all today</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-value">{bestJob ? `${bestJob.score_pct}%` : "—"}</div>
            <div className="kpi-label">Best Match</div>
            <div className="kpi-sub">{bestJob?.title?.slice(0, 22) ?? ""}</div>
          </div>
        </div>

        {/* Period tabs + sort */}
        <div className="top-bar">
          <div className="period-tabs">
            {(["hour", "today", "yesterday"] as Period[]).map((p) => (
              <button
                key={p}
                className={`period-tab${period === p ? " active" : ""}`}
                onClick={() => { setPeriod(p); setTermFilter("all"); setSelectedSession(null); }}
              >
                {p === "hour" ? "This Hour" : p.charAt(0).toUpperCase() + p.slice(1)}
                <span className="count">
                  {p === "hour" ? hourJobs.length : p === "today" ? todayJobs.length : yesterdayJobs.length}
                </span>
              </button>
            ))}
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
                      if (r.targetPeriod) setPeriod(r.targetPeriod);
                      setTermFilter("all");
                    }
                  }}
                >
                  <span className="run-card-time">{formatRunTime(r.displayAt)}</span>
                  <span className="run-card-count">{r.count} jobs</span>
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
                    <span style={{ textAlign: "right" }}>Match</span>
                    <span style={{ textAlign: "right" }}>Tag</span>
                    <span style={{ textAlign: "right" }}>Level</span>
                    <span style={{ textAlign: "right" }}>Apply</span>
                  </div>
                  {/* Apply stats bar */}
                  {clickedJobCount > 0 && (
                    <div className="apply-stats-row">
                      <div className="apply-stats-cell">
                        Clicked jobs: <span className="apply-stats-value">{clickedJobCount}</span>
                        <span className="apply-stats-sep">•</span>
                        Total clicks: <span className="apply-stats-value">{stats.count}</span>
                        <span className="apply-stats-sep">•</span>
                        Last: <span className="apply-stats-value">{fmtClickTime(stats.lastClickAt)}</span>
                        <span className="apply-stats-sep">•</span>
                        <span className="apply-stats-last" title={lastJobText}>{lastJobText}</span>
                      </div>
                    </div>
                  )}
                  {filtered.map((job, i) => (
                    <JobRow
                      key={job.job_url || i}
                      job={job}
                      index={i}
                      applyRecord={job.job_url ? getRecord(job.job_url) : null}
                      onApplyClick={recordClick}
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
