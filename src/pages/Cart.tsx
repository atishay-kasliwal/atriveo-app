import { useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import BulkJobAnalysisPanel from "../components/BulkJobAnalysisPanel";
import BulkJobCopyBar from "../components/BulkJobCopyBar";
import PageIntro from "../components/PageIntro";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useCart } from "../hooks/useCart";
import { useJobSelection } from "../hooks/useJobSelection";
import JobCard from "../components/JobCard";

export default function Cart() {
  const { recordClick, getRecord } = useApplyTracker();
  const { items, removeFromCart } = useCart();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.job.title?.toLowerCase().includes(q) ||
      item.job.company?.toLowerCase().includes(q) ||
      item.job.location?.toLowerCase().includes(q)
    );
  }), [items, query]);

  const appliedCount = items.filter((i) => i.job.job_url && getRecord(i.job.job_url)).length;
  const visibleJobs = useMemo(() => filtered.map((item) => item.job), [filtered]);
  const jobSelection = useJobSelection(visibleJobs);

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide">
        <PageIntro
          compact
          kicker="Focus Cart"
          title="Saved jobs with the context preserved"
          description="Keep the roles you want to revisit in one place. The cart stays searchable, remembers application progress, and keeps your saved set out of the noise."
          stats={[
            { label: "Saved", value: items.length, tone: "blue" },
            { label: "Applied", value: appliedCount, tone: "green" },
            { label: "Visible", value: filtered.length, tone: "orange" },
          ]}
        />

        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-label">Saved</div>
            <div className="kpi-value">{items.length}</div>
            <div className="kpi-sub">jobs in focus list</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-label">New Grad</div>
            <div className="kpi-value">{items.filter((i) => i.job.level === "New Grad").length}</div>
            <div className="kpi-sub">saved roles</div>
          </div>
          <div className="kpi-card purple">
            <div className="kpi-label">Applied</div>
            <div className="kpi-value">
              {items.filter((i) => i.job.job_url && getRecord(i.job.job_url)).length}
            </div>
            <div className="kpi-sub">of saved jobs</div>
          </div>
        </div>

        <div className="top-bar" style={{ marginBottom: 12 }}>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Filter saved jobs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {items.length > 0 && (
            <button
              className="sort-btn"
              style={{ marginLeft: "auto", color: "var(--red)", borderColor: "rgba(220,38,38,0.3)" }}
              onClick={() => {
                if (window.confirm(`Remove all ${items.length} jobs from cart?`)) {
                  items.forEach((i) => removeFromCart(i.url));
                }
              }}
            >
              Clear all
            </button>
          )}
        </div>

        <BulkJobCopyBar
          selectedCount={jobSelection.selectedCount}
          visibleCount={visibleJobs.length}
          copyMessage={jobSelection.copyMessage}
          analysisMessage={jobSelection.analysisMessage}
          onCopy={jobSelection.copySelectedJobs}
          onAnalyze={jobSelection.analyzeSelectedJobDescriptions}
          onSelectVisible={jobSelection.selectVisibleJobs}
          onClear={jobSelection.clearSelectedJobs}
        />
        <BulkJobAnalysisPanel analysis={jobSelection.analysis} />

        <div className="job-list">
          {items.length === 0 ? (
            <div className="state-msg">
              <div className="icon">🔖</div>
              <div>No saved jobs here. Cards now use Click, Apply, and Tracker instead.</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="state-msg" style={{ fontSize: 13 }}>No jobs match your search.</div>
          ) : (
            <>
              <div className="card-grid">
                {filtered.map((item, i) => (
                  <JobCard
                    key={item.url || i}
                    job={item.job}
                    applyRecord={item.job.job_url ? getRecord(item.job.job_url) : null}
                    onAddToTracker={recordClick}
                    isSelected={jobSelection.isJobSelected(item.job)}
                    onSelectionToggle={jobSelection.toggleJobSelection}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Your focus list · Persists across sessions
        </div>
      </footer>
    </div>
  );
}
