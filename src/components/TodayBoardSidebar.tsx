import type { Period } from "../pages/Dashboard.types";
import AtriveoLogo from "./AtriveoLogo";

type ViewKey = "all" | "high-match" | "new-grad" | "h1b" | "top500";

interface RunCard {
  session_id: string;
  displayAt: string;
  count: number;
  clickCount: number;
  progressPct: number;
  targetPeriod: Period | null;
}

interface Props {
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
  viewCounts: Record<ViewKey, number>;
  period: Period;
  onPeriodChange: (period: Period) => void;
  periodCounts: { hour: number; today: number; yesterday: number };
  periodClickedCounts: { hour: number; today: number; yesterday: number; total: number };
  clickedTotal: number;
  runCards: RunCard[];
  selectedSession: string | null;
  onSessionSelect: (sessionId: string | null, targetPeriod?: Period | null) => void;
  formatRunTime: (iso?: string | null) => string;
}

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "all", label: "All Jobs" },
  { key: "high-match", label: "High Match" },
  { key: "new-grad", label: "New Grad" },
  { key: "h1b", label: "H1B Ready" },
  { key: "top500", label: "Top 500" },
];

export default function TodayBoardSidebar({
  activeView,
  onViewChange,
  viewCounts,
  period,
  onPeriodChange,
  periodCounts,
  periodClickedCounts,
  clickedTotal,
  runCards,
  selectedSession,
  onSessionSelect,
  formatRunTime,
}: Props) {
  return (
    <aside className="today-board-sidebar" aria-label="Views and pipeline">
      <div className="today-board-brand">
        <span className="today-board-brand-mark"><AtriveoLogo size={16} fill="var(--primary-foreground)" /></span>
        <span className="today-board-brand-title">Atriveo DB</span>
      </div>

      <section className="today-board-nav-section">
        <h2 className="today-board-nav-label">Views</h2>
        <ul className="today-board-nav-list">
          {VIEWS.map(({ key, label }) => (
            <li key={key}>
              <button
                type="button"
                className={`today-board-nav-item${activeView === key ? " is-active" : ""}`}
                onClick={() => onViewChange(key)}
              >
                <span>{label}</span>
                <span className="today-board-nav-count">{viewCounts[key]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="today-board-nav-section">
        <h2 className="today-board-nav-label">Pipeline</h2>
        <ul className="today-board-nav-list">
          {(["hour", "today", "yesterday"] as Period[]).map((p) => {
            const count = p === "hour" ? periodCounts.hour : p === "today" ? periodCounts.today : periodCounts.yesterday;
            const clicked = p === "hour" ? periodClickedCounts.hour : p === "today" ? periodClickedCounts.today : periodClickedCounts.yesterday;
            return (
            <li key={p}>
              <button
                type="button"
                className={`today-board-nav-item${period === p ? " is-active" : ""}`}
                onClick={() => onPeriodChange(p)}
              >
                <span>{p === "hour" ? "This Hour" : p.charAt(0).toUpperCase() + p.slice(1)}</span>
                <span className="today-board-nav-counts">
                  <span className="today-board-nav-count">{count}</span>
                  {clicked > 0 ? (
                    <span className="today-board-nav-clicked" title={`${clicked} saved from this period`}>
                      {clicked} clicked
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
            );
          })}
          <li>
            <a href="/weekly" className="today-board-nav-item today-board-nav-link">
              <span>7 Days</span>
            </a>
          </li>
          <li>
            <a href="/clickedjobs" className="today-board-nav-item today-board-nav-link">
              <span>Clicked</span>
              <span className="today-board-nav-count">{clickedTotal}</span>
            </a>
          </li>
        </ul>
      </section>

      {runCards.length > 0 && (
        <section className="today-board-nav-section today-board-sessions">
          <h2 className="today-board-nav-label">Sessions</h2>
          <ul className="today-board-nav-list">
            {runCards.slice(0, 10).map((r, index) => {
              const isActive = selectedSession === r.session_id;
              return (
                <li key={r.session_id}>
                  <button
                    type="button"
                    className={`today-board-nav-item today-board-session-item${isActive ? " is-active" : ""}`}
                    onClick={() => onSessionSelect(isActive ? null : r.session_id, r.targetPeriod)}
                  >
                    <span className="today-board-session-leading">
                      <span className="today-board-session-index">{index + 1}</span>
                      <span className="today-board-session-body">
                        <span className="today-board-session-time">{formatRunTime(r.displayAt)}</span>
                        <span className="today-board-session-meta">
                          {r.clickCount > 0 ? `${r.clickCount} clicked` : "no clicks yet"}
                          {r.progressPct > 0 ? ` · ${r.progressPct}%` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="today-board-nav-counts">
                      <span className="today-board-nav-count">{r.count}</span>
                      {r.clickCount > 0 ? (
                        <span className="today-board-nav-clicked">{r.clickCount} clicked</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

export type { ViewKey };
