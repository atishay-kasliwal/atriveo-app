import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BulkJobAnalysisPanel from "../components/BulkJobAnalysisPanel";
import BulkJobCopyBar from "../components/BulkJobCopyBar";
import FeedTableToolbar from "../components/FeedTableToolbar";
import TailorPanel from "../components/TailorPanel";
import TodayBoardSidebar, { type ViewKey } from "../components/TodayBoardSidebar";
import TodayBoardFooter from "../components/TodayBoardFooter";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { useJobSelection } from "../hooks/useJobSelection";
import { useMongoCompileQueue } from "../hooks/useMongoCompileQueue";
import { useTailorStatus } from "../hooks/useTailorStatus";
import { isTop500 } from "../data/top500";
import type { Job, RunEntry } from "../types";
import type { TailorRecord } from "../types/tailorQueue";
import type { SavedJobSource } from "../hooks/useApplyClickLog";
import JobTable from "../components/JobTable";
import JobCard from "../components/JobCard";
import { careerOpsRating } from "../utils/jobPresentation";
import type { Period, SortBy, SortDir } from "./Dashboard.types";
import { defaultSortDir, sortJobs } from "../utils/jobSort";
import { buildSessionResumeSlots } from "../utils/sessionResume";
import { jobDismissKey } from "../utils/jobCopy";
import { openTailorPath } from "../utils/tailorRun";
import { outcomeFromServerStatus, resolveTailorOutcome } from "../utils/tailorOutcome";
import { tailorPhaseProgress } from "../utils/tailorProgress";
import { estDateKey, estHourLabel } from "../utils/estDate";
import { fetchPipelineKpis, type PipelineKpis } from "../utils/compileQueueApi";
import CompilerStatusStrip from "../components/CompilerStatusStrip";
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

// Filter the feed by tailor outcome. The many TailorOutcomeKind values are
// grouped into a few user-friendly buckets that match what the table shows.
type TailorFilter = "all" | "done" | "error" | "skip" | "no-jd" | "untailored";
const TAILOR_FILTERS: { key: TailorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "done", label: "Done" },
  { key: "error", label: "Error" },
  { key: "skip", label: "Skip" },
  { key: "no-jd", label: "No JD" },
  { key: "untailored", label: "Not tailored" },
];

// Map a resolved outcome (+ whether a record exists) to a filter bucket.
function tailorFilterBucket(record: TailorRecord | null): TailorFilter {
  if (!record || record.status === "none") return "untailored";
  const outcome = resolveTailorOutcome(record);
  switch (outcome) {
    case "done":
      return "done";
    case "skip":
      return "skip";
    case "no-jd":
      return "no-jd";
    case "running":
    case "queued":
      return "untailored"; // in-flight: not a finished result yet
    // every genuine failure bucket → "error"
    case "compile":
    case "ai":
    case "offline":
    case "timeout":
    case "missing":
    case "no-resume":
    case "error":
    default:
      return "error";
  }
}

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

/** Pipeline publishes hourly; warn when static JSON is older than this. */
const FEED_STALE_MS = 90 * 60 * 1000;

function formatFeedAge(iso?: string | null): string {
  const date = parseDateLike(iso);
  if (!date) return "unknown";
  const diffMs = Date.now() - date.getTime();
  const diffM = Math.floor(diffMs / 60_000);
  if (diffM < 1) return "just now";
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return formatRunTime(iso);
}

async function fetchJobFeed(type: string): Promise<Job[]> {
  try {
    // Bust browser + edge caches so the hourly-polled feed actually reflects the
    // latest deploy. Without no-store + a cache-buster, a cached /api/jobs
    // response makes the frontend look frozen even after new data is published.
    const res = await fetch(`/api/jobs?type=${type}&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as Job[] : [];
  } catch {
    return [];
  }
}

function formatRunTime(iso?: string | null): string {
  const date = parseDateLike(iso);
  if (!date) return "—";
  const tz = "America/New_York";
  const nowEt = new Date().toLocaleString("en-US", { timeZone: tz });
  const dateEt = date.toLocaleString("en-US", { timeZone: tz });
  const sameDay = nowEt.slice(0, 10) === dateEt.slice(0, 10);
  if (sameDay) {
    return date.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return date.toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}


export default function Dashboard({ initialPeriod = "hour" }: DashboardProps) {
  const navigate = useNavigate();
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { clickedKeySet, recordSavedJob, records: clickRecords } = useApplyClickLog();
  const tailorStatus = useTailorStatus();
  const {
    markStatus: markTailorStatus,
    getRecordForJob: getTailorRecordForJob,
  } = tailorStatus;
  const { isExcluded, excludeCompany } = useExclusions();
  const [hourJobs, setHourJobs] = useState<Job[]>([]);
  const [todayJobs, setTodayJobs] = useState<Job[]>([]);
  const [yesterdayJobs, setYesterdayJobs] = useState<Job[]>([]);
  const [runHistory, setRunHistory] = useState<RunEntry[]>([]);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const initialSort = initialPeriod === "hour" ? "time" : "score";
  const [sortBy, setSortBy] = useState<SortBy>(initialSort);
  const [sortDir, setSortDir] = useState<SortDir>(() => defaultSortDir(initialSort));
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [tailorFilter, setTailorFilter] = useState<TailorFilter>("all");
  const [h1bFilter, setH1bFilter] = useState(false);
  const [top500Filter, setTop500Filter] = useState(false);
  const [termFilter, setTermFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [showTodayApplications, setShowTodayApplications] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [feedRefreshNotice, setFeedRefreshNotice] = useState("");
  const [feedLastUpdated, setFeedLastUpdated] = useState<string | null>(null);
  const [feedFetchError, setFeedFetchError] = useState("");
  const [pipelineRefreshing, setPipelineRefreshing] = useState(false);
  const [pipelineRefreshMsg, setPipelineRefreshMsg] = useState("");
  const [pipelineKpis, setPipelineKpis] = useState<PipelineKpis | null>(null);
  const hourSessionRef = useRef<string | null>(null);

  const applyView = useCallback((view: ViewKey) => {
    setActiveView(view);
    setLevelFilter(view === "new-grad" ? "New Grad" : "all");
    setH1bFilter(view === "h1b");
    setTop500Filter(view === "top500");
  }, []);

  const handlePeriodChange = (nextPeriod: Period, syncPath = true) => {
    setPeriod(nextPeriod);
    const nextSort = nextPeriod === "hour" ? "time" : "score";
    setSortBy(nextSort);
    setSortDir(defaultSortDir(nextSort));
    setLocationFilter("all");
    if (syncPath) {
      const nextPath = nextPeriod === "today" ? "/today" : "/";
      if (window.location.pathname !== nextPath) navigate(nextPath);
    }
  };

  const refreshJobFeeds = useCallback(async (opts: { initial?: boolean } = {}) => {
    const [hourList, todayList, yesterdayList, runsRes, metaRes] = await Promise.all([
      fetchJobFeed("hour"),
      fetchJobFeed("today"),
      fetchJobFeed("yesterday"),
      fetch("/api/jobs?type=runs").then(async (r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/metadata.json", { cache: "no-store" }).catch(() => null),
    ]);

    if (!hourList.length && !todayList.length && !yesterdayList.length) {
      setFeedFetchError("Could not load job feeds — try signing in again or refresh the page.");
    } else {
      setFeedFetchError("");
    }

    let metaUpdated: string | null = null;
    if (metaRes?.ok) {
      try {
        const meta = await metaRes.json() as { last_updated?: string };
        metaUpdated = meta.last_updated ?? null;
        setFeedLastUpdated(metaUpdated);
      } catch {
        /* ignore */
      }
    }

    const nextSession = hourList[0]?.session_id ?? null;
    if (!opts.initial && nextSession && hourSessionRef.current && nextSession !== hourSessionRef.current) {
      const label = formatRunTime(hourList[0]?.batch_time || nextSession);
      setFeedRefreshNotice(`New hourly batch loaded (${label} ET) — ${hourList.length} jobs`);
      window.setTimeout(() => setFeedRefreshNotice(""), 12_000);
    }
    hourSessionRef.current = nextSession;
    setHourJobs(hourList);
    setTodayJobs(todayList);
    setYesterdayJobs(yesterdayList);
    setRunHistory(Array.isArray(runsRes) ? runsRes as RunEntry[] : []);
    return hourList;
  }, []);

  useEffect(() => {
    const refreshKpis = () => {
      void fetchPipelineKpis().then(setPipelineKpis).catch(() => setPipelineKpis(null));
    };
    refreshKpis();
    const id = window.setInterval(refreshKpis, 45_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await refreshJobFeeds({ initial: true });
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshJobFeeds]);

  useEffect(() => {
    const pollMs = 3 * 60 * 1000;
    const id = window.setInterval(() => { void refreshJobFeeds(); }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshJobFeeds();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshJobFeeds]);

  const isJobInFeed = useCallback(
    (job: Job) => !isExcluded(job) && !clickedKeySet.has(jobDismissKey(job)),
    [isExcluded, clickedKeySet],
  );

  const sessionJobMap = useMemo(() => {
    const bySession = new Map<string, Map<string, Job>>();
    for (const job of [...hourJobs, ...todayJobs, ...yesterdayJobs]) {
      if (!job.session_id) continue;
      const key = jobDismissKey(job);
      let bucket = bySession.get(job.session_id);
      if (!bucket) {
        bucket = new Map();
        bySession.set(job.session_id, bucket);
      }
      bucket.set(key, job);
    }
    return bySession;
  }, [hourJobs, todayJobs, yesterdayJobs]);

  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [sessionId, jobs] of sessionJobMap) {
      counts[sessionId] = [...jobs.values()].filter(isJobInFeed).length;
    }
    return counts;
  }, [sessionJobMap, isJobInFeed]);

  const sessionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const [sessionId, jobs] of sessionJobMap) {
      totals[sessionId] = jobs.size;
    }
    return totals;
  }, [sessionJobMap]);

  const periodCounts = useMemo(
    () => ({
      hour: hourJobs.filter(isJobInFeed).length,
      today: todayJobs.filter(isJobInFeed).length,
      yesterday: yesterdayJobs.filter(isJobInFeed).length,
    }),
    [hourJobs, todayJobs, yesterdayJobs, isJobInFeed],
  );

  const periodClickedCounts = useMemo(() => {
    const clickedIn = (jobs: Job[]) => {
      const keys = new Set(jobs.map((j) => jobDismissKey(j)));
      return clickRecords.filter((r) => keys.has(r.jobKey)).length;
    };
    return {
      hour: clickedIn(hourJobs),
      today: clickedIn(todayJobs),
      yesterday: clickedIn(yesterdayJobs),
      total: clickRecords.length,
    };
  }, [clickRecords, hourJobs, todayJobs, yesterdayJobs]);

  const sessionPeriod = useMemo(() => {
    const map: Record<string, Period> = {};
    hourJobs.forEach((j) => { if (j.session_id) map[j.session_id] = "hour"; });
    todayJobs.forEach((j) => { if (j.session_id && !map[j.session_id]) map[j.session_id] = "today"; });
    yesterdayJobs.forEach((j) => { if (j.session_id && !map[j.session_id]) map[j.session_id] = "yesterday"; });
    return map;
  }, [hourJobs, todayJobs, yesterdayJobs]);

  const jobKeySessionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [sessionId, jobs] of sessionJobMap) {
      for (const key of jobs.keys()) map[key] = sessionId;
    }
    return map;
  }, [sessionJobMap]);

  const jobSessionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [sessionId, jobs] of sessionJobMap) {
      for (const job of jobs.values()) {
        if (job.job_url) map[job.job_url] = sessionId;
      }
    }
    return map;
  }, [sessionJobMap]);

  const sessionClickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const record of clickRecords) {
      const sessionId = jobKeySessionMap[record.jobKey] || jobSessionMap[record.jobUrl];
      if (!sessionId) continue;
      counts[sessionId] = (counts[sessionId] || 0) + 1;
    }
    return counts;
  }, [jobKeySessionMap, jobSessionMap, clickRecords]);

  const rawJobs = period === "hour" ? hourJobs : period === "today" ? todayJobs : yesterdayJobs;
  const baseJobs = selectedSession ? rawJobs.filter((j) => j.session_id === selectedSession) : rawJobs;

  const runCards = useMemo(() => {
    const historyById = new Map(runHistory.map((r) => [r.session_id, r]));

    const cards: RunCard[] = Object.entries(sessionCounts)
      .flatMap(([sessionId, count]) => {
        const clickCount = sessionClickCounts[sessionId] ?? 0;
        if (count <= 0 && clickCount <= 0) return [];
        // Include sessions from ALL periods (hour/today/yesterday) so the sidebar
        // can show the 10 most recent regardless of which period tab is selected.
        // Each card keeps its own targetPeriod for correct click-through nav.
        const targetPeriod = sessionPeriod[sessionId];
        if (!targetPeriod) return [];

        const history = historyById.get(sessionId);
        const totalJobs = sessionTotals[sessionId] ?? history?.total_jobs ?? count + clickCount;
        return [{
          session_id: sessionId,
          run_at: history?.run_at || sessionId,
          total_jobs: history?.total_jobs ?? totalJobs,
          count,
          targetPeriod,
          displayAt: history?.run_at || sessionId,
          clickCount,
          progressPct: 0,
          segmentsActive: 0,
        }];
      })
      .sort((a, b) => toMs(b.displayAt) - toMs(a.displayAt));

    return cards.map((r) => {
      const total = Math.max(r.total_jobs, r.count + r.clickCount);
      const progress = total > 0 ? r.clickCount / total : 0;
      return {
        ...r,
        progressPct: Math.min(100, Math.round(progress * 100)),
        segmentsActive: Math.min(24, Math.max(0, Math.round(progress * 24))),
      };
    });
  }, [runHistory, sessionCounts, sessionPeriod, sessionClickCounts, sessionTotals]);

  const feedJobsBeforeDismiss = useMemo(() => {
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
    if (activeView === "high-match") {
      jobs = jobs.filter((j) => careerOpsRating(j).score >= 75);
    }
    return jobs;
  }, [baseJobs, h1bFilter, top500Filter, termFilter, query, isExcluded, activeView]);

  const visibleJobs = useMemo(() => {
    return feedJobsBeforeDismiss.filter((j) => !clickedKeySet.has(jobDismissKey(j)));
  }, [feedJobsBeforeDismiss, clickedKeySet]);

  const clickedHiddenCount = useMemo(
    () => feedJobsBeforeDismiss.length - visibleJobs.length,
    [feedJobsBeforeDismiss, visibleJobs],
  );

  const feedIsStale = useMemo(() => {
    const ts = toMs(feedLastUpdated);
    return ts > 0 && Date.now() - ts > FEED_STALE_MS;
  }, [feedLastUpdated]);

  const handlePipelineRefresh = useCallback(async () => {
    setPipelineRefreshing(true);
    setPipelineRefreshMsg("");
    try {
      const resume = localStorage.getItem("atriveo_resume") || "";
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      setPipelineRefreshMsg(data.ok ? (data.message ?? "Pipeline triggered") : (data.error ?? "Failed"));
      if (data.ok) {
        window.setTimeout(() => { void refreshJobFeeds(); }, 65_000);
      }
    } catch {
      setPipelineRefreshMsg("Network error");
    } finally {
      setPipelineRefreshing(false);
    }
  }, [refreshJobFeeds]);

  const handleSortColumn = useCallback((column: SortBy) => {
    if (sortBy === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir(defaultSortDir(column));
  }, [sortBy]);

  const handleToolbarSortChange = useCallback((column: SortBy) => {
    setSortBy(column);
    setSortDir(defaultSortDir(column));
  }, []);

  const filtered = useMemo(() => {
    let jobs = [...visibleJobs];
    if (levelFilter !== "all") jobs = jobs.filter((j) => j.level === levelFilter);
    if (tailorFilter !== "all") {
      jobs = jobs.filter(
        (j) => tailorFilterBucket(tailorStatus.getRecordForJob(j)) === tailorFilter,
      );
    }
    return sortJobs(jobs, sortBy, sortDir, tailorStatus.getRecordForJob);
  }, [visibleJobs, levelFilter, tailorFilter, sortBy, sortDir, tailorStatus.getRecordForJob, tailorStatus.records]);

  // Counts per tailor-status bucket for the filter chips.
  const tailorCounts = useMemo(() => {
    const counts: Record<TailorFilter, number> = {
      all: visibleJobs.length, done: 0, error: 0, skip: 0, "no-jd": 0, untailored: 0,
    };
    for (const job of visibleJobs) {
      const bucket = tailorFilterBucket(tailorStatus.getRecordForJob(job));
      counts[bucket] += 1;
    }
    return counts;
  }, [visibleJobs, tailorStatus.getRecordForJob, tailorStatus.records]);

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
  const sessionResumeByUrl = useMemo(
    () => buildSessionResumeSlots(displayedJobs),
    [displayedJobs],
  );
  const tailorQueue = useMongoCompileQueue(displayedJobs, {
    tailorStatus,
    dismissedKeys: clickedKeySet,
  });
  const jobSelection = useJobSelection(displayedJobs, {
    onCompileSelected: (selected) => {
      for (const job of selected) {
        tailorQueue.enqueueJob(job, "manual", true);
      }
    },
  });

  const handleSaveJobWithQueueCleanup = useCallback((job: Job, source: SavedJobSource) => {
    if (!job.job_url || source !== "click") return;
    recordSavedJob(job, source);
    tailorQueue.removeFromQueue(jobDismissKey(job));
    recordClick(job.job_url, job.title || "Untitled role", job.company || "Unknown company", {
      location: job.location || null,
    });
  }, [recordSavedJob, recordClick, tailorQueue]);

  const handleOpenTailorPath = useCallback(async (path: string) => {
    try {
      await openTailorPath(path);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const failedTodayCount = useMemo(() => {
    const today = estDateKey(new Date());
    return Object.values(tailorStatus.records).filter((r) => {
      if (!r.tailoredAt || estDateKey(new Date(r.tailoredAt)) !== today) return false;
      const o = resolveTailorOutcome(r);
      return o !== "done" && o !== "borderline" && o !== "running" && o !== "queued";
    }).length;
  }, [tailorStatus.records]);

  const handleDismissJob = useCallback((job: Job) => {
    handleSaveJobWithQueueCleanup(job, "click");
  }, [handleSaveJobWithQueueCleanup]);

  useEffect(() => {
    const run = jobSelection.tailorRun;
    if (!run) return;

    if (run.active) {
      for (const job of run.jobs) {
        if (job.phase === "done") continue;
        const match = displayedJobs.find((j) => j.company === job.company && j.title === job.role);
        if (!match) continue;
        const key = jobDismissKey(match);
        const progressPct = tailorPhaseProgress(job.phase);
        const existing = getTailorRecordForJob(match);
        if (existing?.status === "running" && existing.progressPct === progressPct) continue;
        markTailorStatus(key, "running", {
          jobUrl: match.job_url || "",
          company: job.company,
          title: job.role,
          progressPct,
        });
      }
      return;
    }

    for (const job of run.jobs) {
      if (job.phase !== "done") continue;
      const match = displayedJobs.find((j) => j.company === job.company && j.title === job.role);
      if (!match) continue;
      const key = jobDismissKey(match);
      const existing = getTailorRecordForJob(match);
      if (job.status === "ok" && job.pdf) {
        if (existing?.status === "done" && existing.pdfPath === job.pdfPath) continue;
        markTailorStatus(key, "done", {
          jobUrl: match.job_url || "",
          company: job.company,
          title: job.role,
          ats: job.ats,
          pdfPath: job.pdfPath,
          dir: job.dir,
          folder: job.folder,
          progressPct: 100,
          tailoredAt: existing?.tailoredAt || new Date().toISOString(),
          logs: job.logs,
          outcome: job.borderline ? "borderline" : "done",
          serverStatus: "ok",
          explain: job.explain,
          borderline: job.borderline,
        });
      } else if (job.status === "unsupported-jd") {
        if (existing?.serverStatus === "unsupported-jd") continue;
        markTailorStatus(key, "failed", {
          error: job.error || "Unsupported job description",
          dir: job.dir,
          folder: job.folder,
          logs: job.logs,
          outcome: "unsupported",
          serverStatus: "unsupported-jd",
        });
      } else if (job.status === "no-go") {
        if (existing?.serverStatus === "no-go") continue;
        markTailorStatus(key, "no-go", {
          error: job.error || "no-go",
          dir: job.dir,
          folder: job.folder,
          logs: job.logs,
          outcome: "skip",
          serverStatus: "no-go",
        });
      } else if (job.error || job.status) {
        const outcome = outcomeFromServerStatus(job.status, job.error);
        const serverStatus = job.status;
        if (existing?.serverStatus === serverStatus && existing?.error === job.error) continue;
        markTailorStatus(key, outcome === "skip" ? "no-go" : "failed", {
          error: job.error,
          logs: job.logs,
          outcome,
          serverStatus,
        });
      }
    }
  }, [jobSelection.tailorRun, displayedJobs, markTailorStatus, getTailorRecordForJob]);

  const ngCount = displayedJobs.filter((j) => j.level === "New Grad").length;
  const selectedRun = useMemo(
    () => runCards.find((r) => r.session_id === selectedSession) || null,
    [runCards, selectedSession],
  );
  const todayPostingsCount = pipelineKpis?.today.postings ?? todayJobs.length;
  const todayResumesCount = pipelineKpis?.today.resumes ?? 0;
  const hourPostingsCount = pipelineKpis?.hour.postings ?? hourJobs.length;
  const hourResumesCount = pipelineKpis?.hour.resumes ?? 0;
  const hourLabel = pipelineKpis?.hour.hourLabel ?? estHourLabel();

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

  const activeFilterCount = [
    selectedSession,
    query.trim(),
    levelFilter !== "all",
    tailorFilter !== "all",
    h1bFilter,
    top500Filter,
    termFilter !== "all",
    locationFilter !== "all",
  ].filter(Boolean).length;

  const hasActiveFilters = Boolean(
    selectedSession ||
    query ||
    levelFilter !== "all" ||
    tailorFilter !== "all" ||
    h1bFilter ||
    top500Filter ||
    termFilter !== "all" ||
    locationFilter !== "all"
  );

  const clearFilters = () => {
    setSelectedSession(null);
    setQuery("");
    setLevelFilter("all");
    setTailorFilter("all");
    setH1bFilter(false);
    setTop500Filter(false);
    setTermFilter("all");
    setLocationFilter("all");
    setActiveView("all");
  };

  // Unified warm Matchflow board is used for ALL periods (This Hour / Today /
  // Yesterday) so the Live Feed and Today page share one consistent design.
  const isTodayBoard = true;

  const catalogJobs = useMemo(
    () => baseJobs.filter(isJobInFeed),
    [baseJobs, isJobInFeed],
  );

  const viewCounts = useMemo(
    () => ({
      all: catalogJobs.length,
      "high-match": catalogJobs.filter((j) => careerOpsRating(j).score >= 75).length,
      "new-grad": catalogJobs.filter((j) => j.level === "New Grad").length,
      h1b: catalogJobs.filter((j) => (j.ats_score ?? j.score_pct ?? 0) >= 60).length,
      top500: catalogJobs.filter((j) => isTop500(j.company || "")).length,
    }),
    [catalogJobs],
  );

  const highMatchCount = useMemo(
    () => displayedJobs.filter((j) => careerOpsRating(j).score >= 75).length,
    [displayedJobs],
  );

  const avgMatchScore = useMemo(() => {
    if (!displayedJobs.length) return 0;
    const sum = displayedJobs.reduce((acc, j) => acc + careerOpsRating(j).score, 0);
    return Math.round(sum / displayedJobs.length);
  }, [displayedJobs]);

  useEffect(() => {
    if (!isTodayBoard) return;
    document.body.classList.add("is-today-board");
    return () => document.body.classList.remove("is-today-board");
  }, [isTodayBoard]);

  const handleShare = () => {
    const url = `${window.location.origin}/today`;
    navigator.clipboard.writeText(url).then(() => {
      setShareMessage("Copied!");
      setTimeout(() => setShareMessage(""), 1500);
    });
  };

  const handleSessionSelect = (sessionId: string | null, targetPeriod?: Period | null) => {
    if (!sessionId) {
      setSelectedSession(null);
      return;
    }
    setSelectedSession(sessionId);
    if (targetPeriod) handlePeriodChange(targetPeriod);
    setTermFilter("all");
  };

  const filterBar = (
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
      <div className="level-chips tailor-status-chips" aria-label="Filter by tailor status">
        <span className="tailor-status-chips-label">Tailored:</span>
        {TAILOR_FILTERS.map((f) => (
          (f.key === "all" || tailorCounts[f.key] > 0) ? (
            <button
              key={f.key}
              className={`chip chip-tailor chip-tailor--${f.key}${tailorFilter === f.key ? " active" : ""}`}
              onClick={() => setTailorFilter(f.key)}
            >
              <span>{f.label}</span>
              <span className="chip-count">{tailorCounts[f.key]}</span>
            </button>
          ) : null
        ))}
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
  );

  const jobListContent = (
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
          onSaveJob={handleSaveJobWithQueueCleanup}
          onExcludeCompany={excludeCompany}
          isJobSelected={jobSelection.isJobSelected}
          onSelectionToggle={jobSelection.toggleJobSelection}
          onGroupSelectAll={jobSelection.toggleGroupSelection}
          isGroupFullySelected={jobSelection.isGroupFullySelected}
          groupByCompany={false}
          getTailorRecord={tailorStatus.getRecordForJob}
          onQueueUrgent={(job, resumeSlot) => tailorQueue.enqueueJob(job, "manual", true, resumeSlot)}
          onOpenTailorPath={handleOpenTailorPath}
          onDismissJob={isTodayBoard ? handleDismissJob : undefined}
          variant={isTodayBoard ? "board" : "default"}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortColumn={isTodayBoard ? handleSortColumn : undefined}
          sessionResumeByUrl={sessionResumeByUrl}
          resumeIdCompact={Boolean(selectedSession)}
        />
      )}
    </>
  );

  return (
    <div className={isTodayBoard ? "today-board-root" : undefined}>
      <AppHeader hideLogo={isTodayBoard} />

      {isTodayBoard ? (
        <div className="today-board-viewport">
          <TodayBoardSidebar
            activeView={activeView}
            onViewChange={applyView}
            viewCounts={viewCounts}
            period={period}
            onPeriodChange={(p) => {
              handlePeriodChange(p);
              setTermFilter("all");
              setSelectedSession(null);
            }}
            periodCounts={periodCounts}
            periodClickedCounts={periodClickedCounts}
            clickedTotal={clickRecords.length}
            runCards={runCards}
            selectedSession={selectedSession}
            onSessionSelect={handleSessionSelect}
            formatRunTime={formatRunTime}
          />

          <div className="today-board-main">
            <div className="board-metrics">
              <div className="board-metric">
                <span className="board-metric-label">Active Matches</span>
                <span className="board-metric-value">{displayedJobs.length}</span>
                <span className="board-metric-sub">
                  {clickedHiddenCount > 0
                    ? `${clickedHiddenCount} clicked away · ${rawJobs.length} in feed`
                    : "in current view"}
                </span>
              </div>
              <div className="board-metric board-metric--accent">
                <span className="board-metric-label">Avg. Match Score</span>
                <span className="board-metric-value">{avgMatchScore || "—"}</span>
                <span className="board-metric-sub">CareerOps average</span>
              </div>
              <div className="board-metric">
                <span className="board-metric-label">Strong Fits</span>
                <span className="board-metric-value">{highMatchCount}</span>
                <span className="board-metric-sub">of {displayedJobs.length || 0}</span>
              </div>
              <div className="board-metric">
                <span className="board-metric-label">Applied Today</span>
                <span className="board-metric-value">{todayApplicationRows.length}</span>
                <span className="board-metric-sub">tracker activity</span>
              </div>
              <div className="board-metric">
                <span className="board-metric-label">Today</span>
                <div className="board-metric-dual" aria-label={`${todayPostingsCount} postings, ${todayResumesCount} resumes compiled for today's scrapes`}>
                  <span className="board-metric-value">{todayPostingsCount}</span>
                  <span className="board-metric-dual-sep">/</span>
                  <span className="board-metric-value">{todayResumesCount}</span>
                </div>
                <span className="board-metric-sub">postings · resumes made</span>
              </div>
              <div className="board-metric">
                <span className="board-metric-label">This hour · {hourLabel} ET</span>
                <div className="board-metric-dual" aria-label={`${hourPostingsCount} postings, ${hourResumesCount} resumes compiled for this hour's batch`}>
                  <span className="board-metric-value">{hourPostingsCount}</span>
                  <span className="board-metric-dual-sep">/</span>
                  <span className="board-metric-value">{hourResumesCount}</span>
                </div>
                <span className="board-metric-sub">postings · resumes made</span>
              </div>
            </div>

            <div className="today-board-table-shell">
              <FeedTableToolbar
                jobCount={displayedJobs.length}
                sortBy={sortBy}
                onSortChange={handleToolbarSortChange}
                query={query}
                onQueryChange={setQuery}
                onFilterToggle={() => setFiltersOpen((v) => !v)}
                filtersOpen={filtersOpen}
                onShare={handleShare}
                shareMessage={shareMessage}
              />

              {filtersOpen && filterBar}

              {feedFetchError ? (
                <div className="feed-stale-notice feed-stale-notice--error" role="alert">{feedFetchError}</div>
              ) : null}

              {feedIsStale && period === "hour" ? (
                <div className="feed-stale-notice" role="status">
                  Job data is from {formatRunTime(feedLastUpdated)} ET ({formatFeedAge(feedLastUpdated)}).
                  The scraper may not have published a newer hour yet.
                  <button
                    type="button"
                    className="feed-stale-notice-btn"
                    disabled={pipelineRefreshing}
                    onClick={() => void handlePipelineRefresh()}
                  >
                    {pipelineRefreshing ? "Triggering…" : "Refresh pipeline"}
                  </button>
                  {pipelineRefreshMsg ? <span className="feed-stale-notice-msg">{pipelineRefreshMsg}</span> : null}
                </div>
              ) : null}

              {feedRefreshNotice ? (
                <div className="feed-refresh-notice" role="status">{feedRefreshNotice}</div>
              ) : null}

              <CompilerStatusStrip
                queue={tailorQueue.queue}
                processing={tailorQueue.processing}
                runningItem={tailorQueue.runningItem}
                doneToday={todayResumesCount}
                failedToday={failedTodayCount}
                tailorStatus={tailorStatus}
                workerMode={tailorQueue.mongoAvailable !== false}
                streamLive={tailorQueue.streamLive}
                syncMessage={tailorQueue.syncMessage}
              />

              <BulkJobCopyBar
                variant="board"
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

              <div className="today-board-table-body">
                {jobListContent}
              </div>

              <TodayBoardFooter
                matchCount={displayedJobs.length}
                selectedCount={jobSelection.selectedCount}
              />
            </div>
          </div>
        </div>
      ) : (
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
                      {p === "hour" ? periodCounts.hour : p === "today" ? periodCounts.today : periodCounts.yesterday}
                    </span>
                  </button>
                ))}
                <a href="/weekly" className="period-tab">
                  7 Days
                </a>
              </div>
              <div className="sort-group" aria-label="Sort jobs">
                <button className={`sort-btn${sortBy === "score" ? " active" : ""}`} onClick={() => handleSortColumn("score")}>★ CareerOps</button>
                <button className={`sort-btn${sortBy === "time" ? " active" : ""}`} onClick={() => handleSortColumn("time")}>↓ Recent</button>
                <button className={`sort-btn${sortBy === "ats" ? " active" : ""}`} onClick={() => handleSortColumn("ats")}>ATS</button>
                <button className={`sort-btn${sortBy === "fit" ? " active" : ""}`} onClick={() => handleSortColumn("fit")}>Fit</button>
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
                  {selectedRun ? `Viewing ${formatRunTime(selectedRun.displayAt)}` : `${Math.min(10, runCards.length)} recent runs`}
                </span>
              </div>
              <div className="run-strip">
              {runCards.slice(0, 10).map((r) => {
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
            {feedRefreshNotice ? (
              <div className="feed-refresh-notice" role="status">{feedRefreshNotice}</div>
            ) : null}
            <CompilerStatusStrip
              queue={tailorQueue.queue}
              processing={tailorQueue.processing}
              runningItem={tailorQueue.runningItem}
              doneToday={todayResumesCount}
              failedToday={failedTodayCount}
              tailorStatus={tailorStatus}
              workerMode={tailorQueue.mongoAvailable !== false}
              streamLive={tailorQueue.streamLive}
              syncMessage={tailorQueue.syncMessage}
            />
            {filterBar}

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
                              onSaveJob={handleSaveJobWithQueueCleanup}
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
              jobListContent
            )}
          </div>
        </div>
      </div>
      )}

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Runs hourly 12 AM – 11 PM
        </div>
      </footer>
    </div>
  );
}
