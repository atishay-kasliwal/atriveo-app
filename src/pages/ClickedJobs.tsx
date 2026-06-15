import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import ClickedJobsTable from "../components/ClickedJobsTable";
import PageIntro from "../components/PageIntro";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { listTailoredResumes, type TailoredResumeOnDisk } from "../utils/tailorRun";

export default function ClickedJobs() {
  const { records, todayRecords, removeApplyClick } = useApplyClickLog();
  const { recordClick, getRecord, updatePipelineStage } = useApplyTracker();
  const [query, setQuery] = useState("");
  const [compiledByUrl, setCompiledByUrl] = useState<Record<string, TailoredResumeOnDisk>>({});

  useEffect(() => {
    void listTailoredResumes().then((list) => {
      const map: Record<string, TailoredResumeOnDisk> = {};
      for (const r of list) {
        if (!r.jobUrl) continue;
        const prev = map[r.jobUrl];
        if (!prev || new Date(r.tailoredAt || 0) > new Date(prev.tailoredAt || 0)) {
          map[r.jobUrl] = r;
        }
      }
      setCompiledByUrl(map);
    });
  }, []);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return records;
    return records.filter(
      (record) =>
        record.title.toLowerCase().includes(trimmed) ||
        record.company.toLowerCase().includes(trimmed) ||
        (record.location || "").toLowerCase().includes(trimmed),
    );
  }, [records, query]);

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide clicked-jobs-page">
        <PageIntro
          compact
          kicker="Activity"
          title="Pipeline timeline"
          description="Track each job from compile through apply, interview, and offer. Mark stages as you progress."
          stats={[
            { label: "Total", value: records.length, tone: "blue" },
            { label: "Today", value: todayRecords.length, tone: "green" },
            { label: "Visible", value: filtered.length, tone: "orange" },
          ]}
        />

        <div className="top-bar clicked-jobs-toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Search activity…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <a href="/" className="sort-btn">← Feed</a>
        </div>

        <section className="clicked-jobs-panel" aria-label="Activity">
          <ClickedJobsTable
            records={filtered}
            getRecord={getRecord}
            getCompiled={ (url) => compiledByUrl[url] ?? null }
            onAddToTracker={recordClick}
            onUpdatePipeline={updatePipelineStage}
            onRestore={removeApplyClick}
          />
        </section>
      </div>
    </div>
  );
}
