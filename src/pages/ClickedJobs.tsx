import { useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import ClickedJobsTable from "../components/ClickedJobsTable";
import PageIntro from "../components/PageIntro";
import { useApplyClickLog } from "../hooks/useApplyClickLog";
import { useApplyTracker } from "../hooks/useApplyTracker";

export default function ClickedJobs() {
  const { records, todayRecords, removeApplyClick } = useApplyClickLog();
  const { recordClick, getRecord } = useApplyTracker();
  const [query, setQuery] = useState("");

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
          kicker="Clicked Jobs"
          title="Postings you saved with Apply, Click, or Add"
          description="Apply, Click, and Add each remove only that one posting from the live feed and send it here. Other roles at the same company stay in the feed."
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
              placeholder="Search clicked jobs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <a href="/" className="sort-btn">← Back to Live Feed</a>
        </div>

        <section className="clicked-jobs-panel" aria-label="Clicked jobs">
          <ClickedJobsTable
            records={filtered}
            getRecord={getRecord}
            onAddToTracker={recordClick}
            onRestore={removeApplyClick}
          />
        </section>
      </div>
    </div>
  );
}
