import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import ClickedJobsTable from "../components/ClickedJobsTable";
import PageIntro from "../components/PageIntro";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { listTailoredResumes, type TailoredResumeOnDisk } from "../utils/tailorRun";

export default function ClickedJobs() {
  const { records: localRecords, todayRecords, removeApplyClick } = useApplyClickLog();
  const { stats, recordClick, getRecord, updatePipelineStage } = useApplyTracker();
  const [query, setQuery] = useState("");
  const [compiledByUrl, setCompiledByUrl] = useState<Record<string, TailoredResumeOnDisk>>({});

  // Merge the server-side tracker (appliedJobs — where the dock's "Add to
  // tracker" writes) into the local click-log so dock-added jobs (including
  // manual:// builds) show up here, not just feed clicks made in this browser.
  const records = useMemo(() => {
    const byUrl = new Map(localRecords.map((r) => [r.jobUrl, r]));
    for (const [url, rec] of Object.entries(stats.appliedJobs)) {
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, {
        jobKey:    url,
        jobUrl:    url,
        title:     rec.title || "—",
        company:   rec.company || "—",
        location:  rec.location ?? null,
        site:      null,
        clickedAt: rec.lastAppliedAt || new Date().toISOString(),
        clicks:    rec.clicks ?? 1,
        level:     null,
        score:     null,
        source:    "apply",
      });
    }
    // Newest first by clickedAt
    return [...byUrl.values()].sort(
      (a, b) => new Date(b.clickedAt).getTime() - new Date(a.clickedAt).getTime(),
    );
  }, [localRecords, stats.appliedJobs]);

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
