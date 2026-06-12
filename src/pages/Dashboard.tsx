import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BulkJobAnalysisPanel from "../components/BulkJobAnalysisPanel";
import BulkJobCopyBar from "../components/BulkJobCopyBar";
import TailorPanel from "../components/TailorPanel";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { useJobSelection } from "../hooks/useJobSelection";
import { isTop500 } from "../data/top500";
import type { Job, RunEntry } from "../types";
import JobTable from "../components/JobTable";
import JobCard from "../components/JobCard";
import { careerOpsRating, jobBoardLabel } from "../utils/jobPresentation";

type Period = "hour" | "today" | "yesterday";
type SortBy = "score" | "time" | "company" | "ats" | "fit";
type LevelFilter = "all" | "New Grad" | "Entry" | "Mid";
type RunCard = RunEntry & {
  count: number;
  targetPeriod: Period | null;
  displayAt: string;
  clickCount: number;
  progressPct: number;
  segmentsActive: number;
};

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

const DS_TERM_RE  = /data\s*sci/i;
const DS_TITLE_RE = /data\s*sci/i;

const LOCATION_FILTERS = [
  { key: "New York", match: (loc: string) => loc.includes("new york") },
  { key: "Seattle",  match: (loc: string) => loc.includes("seattle") },
  { key: "NC",       match: (loc: string) => loc.includes(", nc") || loc.includes("north carolina") },
];
const LEVEL_FILTERS: LevelFilter[] = ["all", "New Grad", "Entry", "Mid"];

interface DashboardProps {
  initialPeriod?: Period;
}

function isDataScientist(job: Job): boolean {
  return (
    DS_TERM_RE.test(job.search_term || "") ||
    DS_TITLE_RE.test(job.title || "")
  );
}

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

function estDateKey(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
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


export default function Dashboard({ initialPeriod = "hour" }: DashboardProps) {
  const navigate = useNavigate();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { records: applyClickRecords, todayRecords: todayApplyClicks, recordApplyClick } = useApplyClickLog();
  const { isExcluded, excludeCompany } = useExclusions();
  const [hourJobs, setHourJobs] = useState<Job[]>([]);
  const [todayJobs, setTodayJobs] = useState<Job[]>([]);
  const [yesterdayJobs, setYesterdayJobs] = useState<Job[]>([]);
  const [runHistory, setRunHistory] = useState<RunEntry[]>([]);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [sortBy, setSortBy] = useState<SortBy>(initialPeriod === "hour" ? "time" : "score");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [h1bFilter, setH1bFilter] = useState(false);
  const [top500Filter, setTop500Filter] = useState(false);
  const [termFilter, setTermFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [showTodayApplications, setShowTodayApplications] = useState(false);

  const handlePeriodChange = (nextPeriod: Period, syncPath = true) => {
    setPeriod(nextPeriod);
    setSortBy(nextPeriod === "hour" ? "time" : "score");
    setLocationFilter("all");
    if (syncPath) {
      const nextPath = nextPeriod === "today" ? "/today" : "/";
      if (window.location.pathname !== nextPath) navigate(nextPath);
    }
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
  const applyClickUrlSet = useMemo(
    () => new Set(applyClickRecords.map((record) => record.jobUrl)),
    [applyClickRecords]
  );

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
      .slice(0, 5);
    return cards.map((r) => {
      const progress = r.count > 0 ? r.clickCount / r.count : 0;
      return {
        ...r,
        progressPct: Math.min(100, Math.round(progress * 100)),
        segmentsActive: Math.min(24, Math.max(0, Math.round(progress * 24))),
      };
    });
  }, [runHistory, sessionCounts, sessionPeriod, sessionClickCounts]);

  const visibleJobs = useMemo(() => {
    let jobs = [...baseJobs];
    if (h1bFilter) jobs = jobs.filter((j) => (j.ats_score ?? j.score_pct ?? 0) >= 60);
    if (top500Filter) jobs = jobs.filter((j) => isTop500(j.company || ""));
    if (termFilter !== "all") jobs = jobs.filter((j) => j.search_term === termFilter);
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      const q = trimmedQuery.toLowerCase();
      jobs = jobs.filter(
        (j) =>
          j.title?.toLowerCase().includes(q) ||
          j.company?.toLowerCase().includes(q) ||
          j.location?.toLowerCase().includes(q)
      );
    }
    jobs = jobs.filter((j) => !isExcluded(j));
    jobs = jobs.filter((j) => !j.job_url || !applyClickUrlSet.has(j.job_url));
    return jobs;
  }, [baseJobs, h1bFilter, top500Filter, termFilter, query, isExcluded, applyClickUrlSet]);

  const filtered = useMemo(() => {
    let jobs = [...visibleJobs];
    if (levelFilter !== "all") jobs = jobs.filter((j) => j.level === levelFilter);
    if (sortBy === "score") jobs.sort((a, b) => careerOpsRating(b).score - careerOpsRating(a).score);
    else if (sortBy === "company") jobs.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
    else if (sortBy === "ats") jobs.sort((a, b) => (b.ats_score ?? -1) - (a.ats_score ?? -1));
    else if (sortBy === "fit") jobs.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
    else jobs.sort((a, b) => toMs(b.batch_time) - toMs(a.batch_time));
    return jobs;
  }, [visibleJobs, levelFilter, sortBy]);

  const searchTerms = useMemo(
    () => [...new Set(rawJobs.map((j) => j.search_term).filter(Boolean))],
    [rawJobs]
  );

  const isSplitView = false;

  const locationRows = useMemo(() =>
    LOCATION_FILTERS.map(({ key, match }) => {
      const jobs = filtered.filter((j) => match(j.location?.toLowerCase() || ""));
      return {
        key,
        jobs,
        dsJobs: jobs.filter(isDataScientist),
        otherJobs: jobs.filter((j) => !isDataScientist(j)),
      };
    }),
  [filtered]);

  const locationFiltered = useMemo(() => {
    if (locationFilter === "all") return filtered;
    const lf = LOCATION_FILTERS.find(f => f.key === locationFilter);
    return lf ? filtered.filter(j => lf.match(j.location?.toLowerCase() || "")) : filtered;
  }, [filtered, locationFilter]);

  const locationPanels = useMemo(
    () => [
      {
        key: "all",
        label: "All",
        total: filtered.length,
        ds: filtered.filter(isDataScientist).length,
        other: filtered.filter((j) => !isDataScientist(j)).length,
      },
      ...locationRows.map(({ key, jobs, dsJobs, otherJobs }) => ({
        key,
        label: key,
        total: jobs.length,
        ds: dsJobs.length,
        other: otherJobs.length,
      })),
    ],
    [filtered, locationRows]
  );

  const dsJobs    = useMemo(() => isSplitView ? locationFiltered.filter(isDataScientist)    : [], [locationFiltered, isSplitView]);
  const otherJobs = useMemo(() => isSplitView ? locationFiltered.filter(j => !isDataScientist(j)) : [], [locationFiltered, isSplitView]);

  const levelCounts = useMemo(
    () => ({
      all: visibleJobs.length,
      "New Grad": visibleJobs.filter((j) => j.level === "New Grad").length,
      Entry: visibleJobs.filter((j) => j.level === "Entry").length,
      Mid: visibleJobs.filter((j) => j.level === "Mid").length,
    }),
    [visibleJobs]
  );
  const displayedJobs = isSplitView ? locationFiltered : filtered;
  const jobSelection = useJobSelection(displayedJobs);
  const ngCount = displayedJobs.filter((j) => j.level === "New Grad").length;
  const selectedRun = useMemo(
    () => runCards.find((r) => r.session_id === selectedSession) || null,
    [runCards, selectedSession]
  );

  const todayApplicationRows = useMemo(() => {
    const todayKey = estDateKey();
    return Object.entries(stats.appliedJobs)
      .map(([url, record]) => {
        const appliedAt = parseDateLike(record.lastAppliedAt);
        if (!appliedAt || estDateKey(appliedAt) !== todayKey) return null;
        return {
          url,
          title: record.title || "Untitled role",
          company: record.company || "Unknown company",
          appliedAt: record.lastAppliedAt,
          clicks: record.clicks || 1,
          trackerSyncStatus: record.trackerSyncStatus,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => toMs(b.appliedAt) - toMs(a.appliedAt));
  }, [stats.appliedJobs]);

  const applyClickTableRows = useMemo(
    () => applyClickRecords.slice(0, 40),
    [applyClickRecords]
  );

  const activeFilterCount = [
    selectedSession,
    query.trim(),
    levelFilter !== "all",
    h1bFilter,
    top500Filter,
    termFilter !== "all",
    locationFilter !== "all",
  ].filter(Boolean).length;

  const hasActiveFilters = Boolean(
    selectedSession ||
    query ||
    levelFilter !== "all" ||
    h1bFilter ||
    top500Filter ||
    termFilter !== "all" ||
    locationFilter !== "all"
  );

  const clearFilters = () => {
    setSelectedSession(null);
    setQuery("");
    setLevelFilter("all");
    setH1bFilter(false);
    setTop500Filter(false);
    setTermFilter("all");
    setLocationFilter("all");
  };

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide dashboard-shell">
        <aside className="dashboard-info-rail" aria-label="Dashboard context">
          <section className={`today-apps-panel${showTodayApplications ? " is-open" : ""}`} aria-label="Today applications">
            <button
              type="button"
              className="today-apps-button"
              onClick={() => setShowTodayApplications((value) => !value)}
              aria-expanded={showTodayApplications}
            >
              <span className="today-apps-copy">
                <span className="today-apps-kicker">Today</span>
                <strong>Applications</strong>
                <small>{todayApplicationRows.length ? "Review everything you touched today" : "No applications logged yet"}</small>
              </span>
              <span className="today-apps-count">{todayApplicationRows.length}</span>
            </button>

            {showTodayApplications && (
              <div className="today-apps-list">
                {todayApplicationRows.length === 0 ? (
                  <div className="today-apps-empty">Apply to a role, then it will appear here.</div>
                ) : todayApplicationRows.map((item) => (
                  <a className="today-app-row" href={item.url} target="_blank" rel="noopener" key={item.url}>
                    <span className="today-app-row-main">
                      <strong>{item.company}</strong>
                      <small>{item.title}</small>
                    </span>
                    <span className="today-app-row-meta">
                      <span>{formatRunTime(item.appliedAt)}</span>
                      <span>{item.trackerSyncStatus === "synced" || item.trackerSyncStatus === "duplicate" ? "Synced" : `${item.clicks}×`}</span>
                    </span>
                  </a>
                ))}
                <button
                  type="button"
                  className="today-apps-feed-button"
                  onClick={() => {
                    handlePeriodChange("today");
                    setSelectedSession(null);
                    setTermFilter("all");
                    setShowTodayApplications(false);
                  }}
                >
                  Open today feed →
                </button>
              </div>
              )}
          </section>

          {/* Period tabs + sort */}
          <div className="top-bar">
            <div className="top-bar-main">
              <div className="period-tabs" aria-label="Feed period">
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
              <div className="sort-group" aria-label="Sort jobs">
                <button className={`sort-btn${sortBy === "score" ? " active" : ""}`} onClick={() => setSortBy("score")}>★ CareerOps</button>
                <button className={`sort-btn${sortBy === "time" ? " active" : ""}`} onClick={() => setSortBy("time")}>↓ Recent</button>
                <button className={`sort-btn${sortBy === "ats" ? " active" : ""}`} onClick={() => setSortBy("ats")}>ATS</button>
                <button className={`sort-btn${sortBy === "fit" ? " active" : ""}`} onClick={() => setSortBy("fit")}>Fit</button>
              </div>
            </div>
            <div className="feed-summary" aria-live="polite">
              <span className="feed-summary-primary">{displayedJobs.length} job{displayedJobs.length !== 1 ? "s" : ""}</span>
              {ngCount > 0 && <span className="feed-summary-chip">{ngCount} New Grad</span>}
              {selectedRun && <span className="feed-summary-chip">Run {formatRunTime(selectedRun.displayAt)}</span>}
            </div>
          </div>

          {/* Run history strip */}
          {runCards.length > 0 && (
            <section className="run-strip-wrap" aria-label="Session history">
              <div className="run-strip-head">
                <span className="run-strip-label">Session History</span>
                <span className="run-strip-status">
                  {selectedRun ? `Viewing ${formatRunTime(selectedRun.displayAt)}` : `${runCards.length} recent runs`}
                </span>
              </div>
              <div className="run-strip">
              {runCards.map((r) => {
                const isActive = selectedSession === r.session_id;
                return (
                  <button
                    type="button"
                    key={r.session_id}
                    className={`run-card${isActive ? " active" : ""}`}
                    aria-pressed={isActive}
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
                  </button>
                );
              })}
              </div>
            </section>
          )}
        </aside>

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
                {LEVEL_FILTERS.map((l) => (
                  <button
                    key={l}
                    className={`chip${levelFilter === l ? " active" : ""}`}
                    onClick={() => setLevelFilter(l)}
                  >
                    <span>{l === "all" ? "All" : l}</span>
                    <span className="chip-count">{levelCounts[l]}</span>
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
              {hasActiveFilters && (
                <button className="clear-filters-btn" onClick={clearFilters}>
                  Clear {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>

            <BulkJobCopyBar
              selectedCount={jobSelection.selectedCount}
              visibleCount={displayedJobs.length}
              copyMessage={jobSelection.copyMessage}
              analysisMessage={jobSelection.analysisMessage}
              onCopy={jobSelection.copySelectedJobs}
              onAnalyze={jobSelection.analyzeSelectedJobDescriptions}
              onTailor={jobSelection.tailorSelectedJobs}
              tailoring={jobSelection.tailoring}
              onSelectVisible={jobSelection.selectVisibleJobs}
              onClear={jobSelection.clearSelectedJobs}
            />
            <TailorPanel
              run={jobSelection.tailorRun}
              onOpenPath={jobSelection.openTailorPath}
              onDismiss={jobSelection.clearTailorRun}
            />
            <BulkJobAnalysisPanel analysis={jobSelection.analysis} />

            {/* Location filter cards — shown in Today split view */}
            {isSplitView && (
              <div className="location-panel-grid">
                {locationPanels.map((panel) => (
                  <button
                    key={panel.key}
                    className={`location-panel-card${locationFilter === panel.key ? " active" : ""}`}
                    onClick={() => setLocationFilter(panel.key)}
                  >
                    <div className="location-panel-head">
                      <span className="location-panel-name">{panel.label}</span>
                      <span className="location-panel-total">{panel.total}</span>
                    </div>
                    <div className="location-panel-meta">
                      <span>Data Sci {panel.ds}</span>
                      <span>Other {panel.other}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Job list — split (Today) or single */}
            {isSplitView ? (
              <div className="today-split">
                {[
                  { label: "Data Scientist", jobs: dsJobs },
                  { label: "Everything Else", jobs: otherJobs },
                ].map(({ label, jobs }, idx) => (
                  <div key={label}>
                    {idx > 0 && (
                      <div className="split-section-divider" role="separator" aria-label={`Start of ${label} section`}>
                        <span className="split-section-divider-line" />
                        <span className="split-section-divider-label">Next Section: {label}</span>
                        <span className="split-section-divider-line" />
                      </div>
                    )}
                  <div className="split-panel">
                    <div className="split-panel-header">
                      <span className="split-panel-title">{label}</span>
                      <span className="split-panel-count">{jobs.length} jobs{jobs.filter(j => j.level === "New Grad").length ? ` · ${jobs.filter(j => j.level === "New Grad").length} NG` : ""}</span>
                    </div>
                    {loading ? (
                        <div className="state-msg"><div className="spin" style={{ margin: "0 auto" }} /></div>
                      ) : jobs.length === 0 ? (
                        <div className="state-msg" style={{ fontSize: 13 }}>No jobs found</div>
                      ) : (
                        <div className="card-grid">
                          {jobs.map((job, i) => (
                            <JobCard
                              key={job.job_url || i}
                              job={job}
                              index={i + 1}
                              applyRecord={job.job_url ? getRecord(job.job_url) : null}
                              onAddToTracker={recordClick}
                              onApplyClick={recordApplyClick}
                              onExcludeCompany={excludeCompany}
                              isSelected={jobSelection.isJobSelected(job)}
                              onSelectionToggle={jobSelection.toggleJobSelection}
                            />
                          ))}
                        </div>
                      )}
                  </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {loading ? (
                  <div className="state-msg"><div className="icon">⏳</div>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div className="state-msg"><div className="icon">🔍</div>No jobs found</div>
                ) : (
                  <JobTable
                    jobs={filtered}
                    getRecord={getRecord}
                    onAddToTracker={recordClick}
                    onApplyClick={recordApplyClick}
                    onExcludeCompany={excludeCompany}
                    isJobSelected={jobSelection.isJobSelected}
                    onSelectionToggle={jobSelection.toggleJobSelection}
                  />
                )}
                {applyClickTableRows.length > 0 && (
                  <section className="apply-click-log" aria-label="Apply button click log">
                    <div className="apply-click-log-head">
                      <div>
                        <span className="apply-click-log-kicker">Apply Log</span>
                        <h2>Opened from Apply</h2>
                        <p>Review opened jobs and add the strong ones to Atriveo tracker.</p>
                      </div>
                      <strong>{todayApplyClicks.length} today</strong>
                    </div>
                    <div className="apply-click-table-wrap">
                      <table className="apply-click-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Time</th>
                            <th>Company</th>
                            <th>Role</th>
                            <th>Board</th>
                            <th>Clicks</th>
                            <th>Tracker</th>
                            <th>Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {applyClickTableRows.map((record, index) => {
                            const trackerRecord = getRecord(record.jobUrl);
                            const trackerStatus = trackerRecord?.trackerSyncStatus ?? null;
                            const isSynced = trackerStatus === "synced" || trackerStatus === "duplicate";
                            const isSending = trackerStatus === "pending";
                            const isRetryable = trackerStatus === "error" || trackerStatus === "not_configured" || trackerStatus === "skipped";
                            const trackerCopy = isSending
                              ? "Sending…"
                              : isSynced
                                ? "Synced"
                                : isRetryable
                                  ? "Retry"
                                  : trackerRecord
                                    ? "Sync"
                                    : "Tracker +";
                            const trackerTone = isSending
                              ? " pending"
                              : isSynced
                                ? " synced"
                                : isRetryable
                                  ? " retry"
                                  : "";
                            return (
                              <tr key={record.jobUrl}>
                                <td className="apply-click-index">{index + 1}</td>
                                <td>{formatRunTime(record.clickedAt)}</td>
                                <td>{record.company}</td>
                                <td>{record.title}</td>
                                <td>{jobBoardLabel(record.site, record.jobUrl)}</td>
                                <td>{record.clicks}</td>
                                <td>
                                  <button
                                    type="button"
                                    className={`apply-click-tracker-btn${trackerTone}`}
                                    disabled={isSending || isSynced}
                                    title={trackerRecord?.trackerSyncMessage || "Add this job to Atriveo tracker"}
                                    onClick={() => recordClick(record.jobUrl, record.title, record.company, { location: record.location })}
                                  >
                                    {trackerCopy}
                                  </button>
                                </td>
                                <td>
                                  <a href={record.jobUrl} target="_blank" rel="noopener">Open ↗</a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
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
