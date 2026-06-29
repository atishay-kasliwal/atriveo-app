import { useState, useEffect, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import BulkJobAnalysisPanel from "../components/BulkJobAnalysisPanel";
import BulkJobCopyBar from "../components/BulkJobCopyBar";
import PageIntro from "../components/PageIntro";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useExclusions } from "../hooks/useExclusions";
import { useJobSelection } from "../hooks/useJobSelection";
import { useTop500 } from "../context/Top500Context";
import { useTailorStatus } from "../hooks/useTailorStatus";
import type { Job } from "../types";
import JobTable from "../components/JobTable";
import type { SortBy, SortDir } from "./Dashboard.types";
import { defaultSortDir, sortJobs } from "../utils/jobSort";

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
  const { stats, recordClick, getRecord } = useApplyTracker();
  const { recordSavedJob } = useApplyClickLog();
  const { isExcluded, excludeCompany } = useExclusions();
  const { isTop500 } = useTop500();
  const tailorStatus = useTailorStatus();
  const [weekJobs, setWeekJobs] = useState<WeekJob[]>([]);
  const [activeDay, setActiveDay] = useState("All");
  const [levelFilter, setLevelFilter] = useState("all");
  const [top500Filter, setTop500Filter] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  const appliedSet = useMemo(() => new Set(Object.keys(stats.appliedJobs)), [stats.appliedJobs]);

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
    const sorted = sortJobs(jobs, sortBy, sortDir);
    return [
      ...sorted.filter((j) => !j.job_url || !appliedSet.has(j.job_url)),
      ...sorted.filter((j) => j.job_url && appliedSet.has(j.job_url)),
    ];
  }, [weekJobs, activeDay, levelFilter, top500Filter, query, sortBy, sortDir, appliedSet, isExcluded, isTop500]);

  const uniqueCompanies = useMemo(
    () => new Set(weekJobs.map((j) => j.company).filter(Boolean)).size,
    [weekJobs]
  );
  const topScore = useMemo(
    () => weekJobs.reduce((m, j) => Math.max(m, j.score ?? 0), 0),
    [weekJobs]
  );
  const todayCount = weekJobs.filter((j) => j.scraped_date === todayLocal()).length;
  const jobSelection = useJobSelection(filtered);

  function handleSort(col: SortBy) {
    if (col === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(defaultSortDir(col));
    }
  }

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide">
        <PageIntro
          compact
          kicker="Weekly View"
          title="A seven-day job archive that stays readable"
          description="Browse the week at a glance with day chips, scoring filters, and applied jobs pushed to the bottom."
          stats={[
            { label: "This week", value: weekJobs.length, tone: "blue" },
            { label: "Companies", value: uniqueCompanies, tone: "green" },
            { label: "Today", value: todayCount, tone: "purple" },
          ]}
        />

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
          {activeDay !== "All" ? ` · ${dayLabel(activeDay)}` : " · last 7 days"}
        </div>

        <BulkJobCopyBar
          selectedCount={jobSelection.selectedCount}
          visibleCount={filtered.length}
          copyMessage={jobSelection.copyMessage}
          analysisMessage={jobSelection.analysisMessage}
          onCopy={jobSelection.copySelectedJobs}
          onAnalyze={jobSelection.analyzeSelectedJobDescriptions}
          onSelectVisible={jobSelection.selectVisibleJobs}
          onClear={jobSelection.clearSelectedJobs}
        />
        <BulkJobAnalysisPanel analysis={jobSelection.analysis} />

        {loading ? (
          <div className="state-msg"><div className="icon">⏳</div>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="state-msg"><div className="icon">🔍</div>No jobs found</div>
        ) : (
          <JobTable
            jobs={filtered}
            variant="board"
            groupByCompany={false}
            getRecord={getRecord}
            onAddToTracker={recordClick}
            onSaveJob={(job, source) => recordSavedJob(job, source)}
            onExcludeCompany={excludeCompany}
            isJobSelected={jobSelection.isJobSelected}
            onSelectionToggle={jobSelection.toggleJobSelection}
            onGroupSelectAll={jobSelection.toggleGroupSelection}
            isGroupFullySelected={jobSelection.isGroupFullySelected}
            getTailorRecord={tailorStatus.getRecordForJob}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortColumn={handleSort}
          />
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Last 7 days · Deduplicated
        </div>
      </footer>
    </div>
  );
}
