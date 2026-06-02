import { useState, useEffect, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import BulkJobAnalysisPanel from "../components/BulkJobAnalysisPanel";
import BulkJobCopyBar from "../components/BulkJobCopyBar";
import PageIntro from "../components/PageIntro";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { useJobSelection } from "../hooks/useJobSelection";
import type { Job } from "../types";
import JobCard from "../components/JobCard";

type WeekJob = Job & { scraped_date?: string };

export default function Unclicked100() {
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
  const jobSelection = useJobSelection(filtered);

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide">
        <PageIntro
          compact
          kicker="High Priority"
          title="100+ scored jobs you haven’t touched yet"
          description="A focused list of the highest-scoring weekly roles that still need attention. Search, review, and clear the strongest matches first."
          stats={[
            { label: "100+ jobs", value: hundredPlus.length, tone: "blue" },
            { label: "Unclicked", value: unclicked.length, tone: "green" },
            { label: "Top score", value: topScore || "—", tone: "orange" },
          ]}
        />

        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-value">{hundredPlus.length}</div>
            <div className="kpi-label">Weekly 100+</div>
            <div className="kpi-sub">score ≥ 100 this week</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-value">{unclicked.length}</div>
            <div className="kpi-label">Unclicked</div>
            <div className="kpi-sub">not yet tracked</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-value">{hundredPlus.length - unclicked.length}</div>
            <div className="kpi-label">Tracked</div>
            <div className="kpi-sub">already in tracker</div>
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
          <div className="state-msg"><div className="icon">🎉</div>No unclicked 100+ jobs</div>
        ) : (
          <div className="card-grid">
            {filtered.map((job, i) => (
              <JobCard
                key={job.job_url || i}
                job={job}
                applyRecord={job.job_url ? getRecord(job.job_url) : null}
                onAddToTracker={recordClick}
                isSelected={jobSelection.isJobSelected(job)}
                onSelectionToggle={jobSelection.toggleJobSelection}
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
