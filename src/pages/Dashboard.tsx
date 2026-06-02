import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { isTop500 } from "../data/top500";
import type { Job, RunEntry } from "../types";
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
const DAILY_APPLY_TARGET = 50;
const BURST_SIZE = 5;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function estWeekStartKey(date = new Date()): string {
  const todayKey = estDateKey(date);
  const noonUtc = new Date(`${todayKey}T12:00:00Z`);
  const day = noonUtc.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return shiftDateKey(todayKey, mondayOffset);
}

function estHour(iso?: string | null): number {
  const date = iso ? parseDateLike(iso) : new Date();
  if (!date) return 0;
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date).find((p) => p.type === "hour")?.value;
  const hour = Number(part ?? 0);
  return hour === 24 ? 0 : hour;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
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
  const { stats, recordClick, getRecord, syncState, syncNow } = useApplyTracker();
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
  const appliedUrlSet = useMemo(() => new Set(Object.keys(stats.appliedJobs)), [stats.appliedJobs]);
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
  const ngCount = displayedJobs.filter((j) => j.level === "New Grad").length;
  const openDisplayedJobs = useMemo(
    () => displayedJobs.filter((j) => !j.job_url || !appliedUrlSet.has(j.job_url)),
    [displayedJobs, appliedUrlSet]
  );
  const highScoreOpenCount = openDisplayedJobs.filter((j) => careerOpsRating(j).score >= 75).length;
  const topCareerOpsOpen = openDisplayedJobs.reduce((best, job) => Math.max(best, careerOpsRating(job).score), 0);

  const selectedRun = useMemo(
    () => runCards.find((r) => r.session_id === selectedSession) || null,
    [runCards, selectedSession]
  );

  const applyMomentum = useMemo(() => {
    const todayKey = estDateKey();
    const hourlyCounts = Array.from({ length: 24 }, () => 0);
    Object.values(stats.appliedJobs).forEach((record) => {
      const appliedAt = parseDateLike(record.lastAppliedAt);
      if (!appliedAt || estDateKey(appliedAt) !== todayKey) return;
      hourlyCounts[estHour(record.lastAppliedAt)] += record.clicks || 1;
    });
    const nowHour = estHour();
    const hourWindow = Array.from({ length: 12 }, (_, index) => (nowHour - 11 + index + 24) % 24);
    const maxHourCount = Math.max(1, ...hourWindow.map((hour) => hourlyCounts[hour]));
    const todayCount = stats.todayCount ?? 0;
    const progressPct = Math.min(100, Math.round((todayCount / DAILY_APPLY_TARGET) * 100));
    const remaining = Math.max(0, DAILY_APPLY_TARGET - todayCount);
    const motivation =
      todayCount >= DAILY_APPLY_TARGET
        ? "Daily target hit. Keep stacking bonus wins."
        : todayCount === 0
          ? "Start with one focused application sprint."
          : remaining <= BURST_SIZE
            ? "One small sprint closes today's target."
            : `${remaining} applications left to hit today's target.`;

    return {
      todayCount,
      progressPct,
      remaining,
      motivation,
      bars: hourWindow.map((hour) => ({
        hour,
        label: hourLabel(hour),
        count: hourlyCounts[hour],
        heightPct: Math.max(8, Math.round((hourlyCounts[hour] / maxHourCount) * 100)),
      })),
    };
  }, [stats.appliedJobs, stats.todayCount]);

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

  const trackerWeek = useMemo(() => {
    const startKey = estWeekStartKey();
    const todayKey = estDateKey();
    const days = WEEKDAY_LABELS.map((label, index) => ({
      label,
      key: shiftDateKey(startKey, index),
      count: 0,
      synced: 0,
      pending: 0,
    }));
    const dayByKey = new Map(days.map((day) => [day.key, day]));

    Object.values(stats.appliedJobs).forEach((record) => {
      const appliedAt = parseDateLike(record.lastAppliedAt);
      if (!appliedAt) return;
      const key = estDateKey(appliedAt);
      const day = dayByKey.get(key);
      if (!day) return;
      day.count += 1;
      if (record.trackerSyncStatus === "synced" || record.trackerSyncStatus === "duplicate") day.synced += 1;
      else day.pending += 1;
    });

    const max = Math.max(1, ...days.map((day) => day.count));
    const total = days.reduce((sum, day) => sum + day.count, 0);
    const best = days.reduce((winner, day) => (day.count > winner.count ? day : winner), days[0]);
    const bestLabel = best.count ? `${best.label} led with ${best.count}` : "No additions yet";
    return { days, max, total, bestLabel, todayKey };
  }, [stats.appliedJobs]);

  const applyClickTableRows = useMemo(
    () => applyClickRecords.slice(0, 40),
    [applyClickRecords]
  );

  const nextBurstCount = Math.min(BURST_SIZE, highScoreOpenCount || openDisplayedJobs.length);
  const activeFilterCount = [
    selectedSession,
    query.trim(),
    levelFilter !== "all",
    h1bFilter,
    top500Filter,
    termFilter !== "all",
    locationFilter !== "all",
  ].filter(Boolean).length;

  const syncStatusLabel =
    syncState.status === "syncing" ? "Syncing"
      : syncState.status === "synced" ? "Synced"
        : syncState.status === "error" ? "Retry"
          : syncState.status === "queued" ? "Queued"
            : "Ready";
  const syncToneClass = `sync-dock--${syncState.status}`;
  const lastSyncLabel = syncState.lastSyncedAt ? `Last synced ${formatRunTime(syncState.lastSyncedAt)}` : "No tracker sync yet";
  const questCards = [
    {
      emoji: "⚡",
      label: "Next burst",
      value: `${nextBurstCount || 1} cards`,
      helper: highScoreOpenCount ? `${highScoreOpenCount} strong matches waiting` : "clear the current view",
    },
    {
      emoji: "🧭",
      label: "Opened log",
      value: `${todayApplyClicks.length}`,
      helper: todayApplyClicks.length ? "review and track winners" : "click jobs to build context",
    },
    {
      emoji: "🧾",
      label: "Sync check",
      value: syncStatusLabel,
      helper: syncState.status === "error" ? "local progress is safe" : "tracker stays caught up",
    },
  ];

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

          <section className="tracker-week-panel" aria-label="Tracker additions by weekday">
            <div className="tracker-week-head">
              <div>
                <div className="tracker-week-kicker">Tracker Graph</div>
                <div className="tracker-week-title">Added this week</div>
              </div>
              <strong>{trackerWeek.total}</strong>
            </div>
            <div className="tracker-week-bars">
              {trackerWeek.days.map((day) => {
                const height = day.count ? Math.max(18, Math.round((day.count / trackerWeek.max) * 100)) : 6;
                return (
                  <div
                    className={`tracker-week-day${day.key === trackerWeek.todayKey ? " is-today" : ""}`}
                    key={day.key}
                    title={`${day.label}: ${day.count} added · ${day.synced} synced`}
                  >
                    <div className="tracker-week-bar-shell">
                      <span style={{ height: `${height}%` }}>
                        <em>{day.count || ""}</em>
                      </span>
                    </div>
                    <small>{day.label}</small>
                  </div>
                );
              })}
            </div>
            <div className="tracker-week-foot">
              <span>Mon–Sun</span>
              <strong>{trackerWeek.bestLabel}</strong>
            </div>
          </section>

          <PageIntro
            compact
            kicker="Live Feed"
            title="Fresh jobs, ranked for application sprints"
            description="Keep the best roles in front, apply in focused bursts, and use momentum signals to avoid letting strong matches sit untouched."
            stats={[
              { label: "This hour", value: hourJobs.length, tone: "blue" },
              { label: "Today", value: todayJobs.length, tone: "green" },
              { label: "Yesterday", value: yesterdayJobs.length, tone: "orange" },
            ]}
          />

          <section className="momentum-panel" aria-label="Apply momentum">
            <div className="momentum-primary">
              <div className="momentum-copy">
                <div className="momentum-kicker">Apply Momentum</div>
                <div className="momentum-title">{applyMomentum.motivation}</div>
              </div>
              <div className="momentum-target">
                <strong>{applyMomentum.todayCount}</strong>
                <span>/ {DAILY_APPLY_TARGET} today</span>
              </div>
            </div>

            <div className="momentum-progress" aria-hidden="true">
              <span style={{ width: `${applyMomentum.progressPct}%` }} />
            </div>

            <div className="momentum-grid">
              <div className="momentum-stat">
                <span>Next burst</span>
                <strong>{nextBurstCount}</strong>
                <small>{highScoreOpenCount ? `${highScoreOpenCount} high-score open` : `${openDisplayedJobs.length} open in view`}</small>
              </div>
              <div className="momentum-stat">
                <span>Opened log</span>
                <strong>{todayApplyClicks.length}</strong>
                <small>{todayApplyClicks.length ? "review strong ones" : "nothing opened yet"}</small>
              </div>
              <div className="momentum-stat">
                <span>Best CareerOps</span>
                <strong>{topCareerOpsOpen || "—"}</strong>
                <small>{selectedRun ? "in selected run" : "in current view"}</small>
              </div>
              <div className="momentum-chart">
                <div className="momentum-chart-head">
                  <span>Today by hour</span>
                  <strong>{applyMomentum.remaining ? `${applyMomentum.remaining} left` : "target hit"}</strong>
                </div>
                <div className="momentum-bars" aria-hidden="true">
                  {applyMomentum.bars.map((bar) => (
                    <span key={bar.hour} className="momentum-bar-wrap">
                      <span className="momentum-bar" style={{ height: `${bar.heightPct}%` }} />
                      <span className="momentum-bar-count">{bar.count || ""}</span>
                    </span>
                  ))}
                </div>
                <div className="momentum-axis">
                  <span>{applyMomentum.bars[0]?.label}</span>
                  <span>{applyMomentum.bars[applyMomentum.bars.length - 1]?.label}</span>
                </div>
              </div>
            </div>
          </section>

          <section className={`sync-dock ${syncToneClass}`} aria-label="End of day tracker sync">
            <div className="sync-dock-top">
              <div>
                <div className="sync-dock-kicker">End-Day Sync</div>
                <div className="sync-dock-title">Close the loop before you log off.</div>
              </div>
              <div className="sync-dock-orb" aria-hidden="true">
                {syncState.status === "synced" ? "✓" : syncState.status === "error" ? "!" : "↻"}
              </div>
            </div>
            <p className="sync-dock-message">{syncState.message}</p>
            <div className="sync-dock-actions">
              <button
                type="button"
                className="sync-dock-button"
                disabled={syncState.status === "syncing" || stats.todayCount === 0}
                onClick={() => { void syncNow("today"); }}
              >
                {syncState.status === "syncing" && syncState.scope === "today" ? "Syncing…" : "Run end-day sync"}
              </button>
              <span className="sync-dock-chip">{stats.todayCount} today</span>
            </div>
            <div className="sync-dock-foot">
              <span>{lastSyncLabel}</span>
              <span>{syncStatusLabel}</span>
            </div>
          </section>

          <section className="quest-panel" aria-label="Daily application quest">
            <div className="quest-panel-head">
              <div>
                <div className="quest-kicker">Daily Quest</div>
                <div className="quest-title">Apply in tiny boss fights.</div>
              </div>
              <span className="quest-spark">✦</span>
            </div>
            <div className="quest-card-grid">
              {questCards.map((card) => (
                <div className="quest-card" key={card.label}>
                  <span className="quest-emoji" aria-hidden="true">{card.emoji}</span>
                  <span className="quest-label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.helper}</small>
                </div>
              ))}
            </div>
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
                  <div className="card-grid">
                    {filtered.map((job, i) => (
                      <JobCard
                        key={job.job_url || i}
                        job={job}
                        index={i + 1}
                        applyRecord={job.job_url ? getRecord(job.job_url) : null}
                        onAddToTracker={recordClick}
                        onApplyClick={recordApplyClick}
                        onExcludeCompany={excludeCompany}
                      />
                    ))}
                  </div>
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
