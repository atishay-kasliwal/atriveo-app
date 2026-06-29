import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { Job } from "../types";
import type { Period, Scope } from "../pages/Dashboard.types";
import AtriveoLogo from "./AtriveoLogo";

interface RunCard {
  session_id: string;
  displayAt: string;
  count: number;
  clickCount: number;
  progressPct: number;
  targetPeriod: Period | null;
}

interface Props {
  period: Period;
  scope: Scope;
  onNavigate: (period: Period, scope: Scope) => void;
  periodCounts: { hour: number; today: number; yesterday: number; week?: number };
  periodClickedCounts: { hour: number; today: number; yesterday: number; total: number };
  clickedTotal: number;
  runCards: RunCard[];
  selectedSession: string | null;
  onSessionSelect: (sessionId: string | null, targetPeriod?: Period | null) => void;
  formatRunTime: (iso?: string | null) => string;
  hourJobs: Job[];
  todayJobs: Job[];
  yesterdayJobs: Job[];
  weekJobs: Job[];
  isTop500: (company: string) => boolean;
}

interface TimeGroup {
  period: Period;
  label: string;
  basePath: string;
}

const TIME_GROUPS: TimeGroup[] = [
  { period: "hour",      label: "This Hour",  basePath: "/" },
  { period: "today",     label: "Today",      basePath: "/today" },
  { period: "yesterday", label: "Yesterday",  basePath: "/yesterday" },
  { period: "week",      label: "This Week",  basePath: "/this-week" },
];

export default function TodayBoardSidebar({
  period,
  scope,
  onNavigate,
  periodCounts,
  clickedTotal,
  runCards,
  selectedSession,
  onSessionSelect,
  formatRunTime,
  hourJobs,
  todayJobs,
  yesterdayJobs,
  weekJobs,
  isTop500,
}: Props) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Set<Period>>(new Set([period]));

  useEffect(() => {
    setOpenGroups((prev) => new Set([...prev, period]));
  }, [period]);

  function toggleGroup(p: Period) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function jobsForPeriod(p: Period): Job[] {
    return p === "hour" ? hourJobs : p === "today" ? todayJobs : p === "yesterday" ? yesterdayJobs : weekJobs;
  }

  function countForPeriod(p: Period): number {
    return p === "hour" ? periodCounts.hour
      : p === "today" ? periodCounts.today
      : p === "yesterday" ? periodCounts.yesterday
      : (periodCounts.week ?? weekJobs.length);
  }

  function isGroupActive(p: Period) {
    return period === p;
  }

  function isSubActive(p: Period, s: Scope) {
    return period === p && scope === s;
  }

  function subPath(basePath: string, s: Scope) {
    return s === "all" ? basePath : `${basePath === "/" ? "" : basePath}/${s === "top500" ? "top-500" : "others"}`;
  }

  const currentPath = location.pathname;

  return (
    <aside className="today-board-sidebar" aria-label="Views and pipeline">
      <div className="today-board-brand">
        <span className="today-board-brand-mark">
          <AtriveoLogo size={16} fill="var(--primary-foreground)" />
        </span>
        <span className="today-board-brand-title">Atriveo DB</span>
      </div>

      <section className="today-board-nav-section">
        <ul className="today-board-nav-list">
          {TIME_GROUPS.map(({ period: p, label, basePath }) => {
            const jobs = jobsForPeriod(p);
            const top500Count = jobs.filter((j) => isTop500(j.company ?? "")).length;
            const othersCount = jobs.length - top500Count;
            const totalCount = countForPeriod(p);
            const isOpen = openGroups.has(p);
            const isActive = isGroupActive(p);
            const allPath = subPath(basePath, "all");

            return (
              <li key={p} className="today-board-group">
                <div className={`today-board-group-header${isActive ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="today-board-group-label"
                    onClick={() => {
                      onNavigate(p, "all");
                      toggleGroup(p);
                    }}
                    aria-current={currentPath === allPath ? "page" : undefined}
                  >
                    <span>{label}</span>
                    <span className="today-board-nav-count">{totalCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`today-board-group-chevron${isOpen ? " is-open" : ""}`}
                    onClick={() => toggleGroup(p)}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {isOpen && (
                  <ul className="today-board-sub-list">
                    <li>
                      <button
                        type="button"
                        className={`today-board-sub-item${isSubActive(p, "top500") ? " is-active" : ""}`}
                        onClick={() => onNavigate(p, "top500")}
                      >
                        <span className="today-board-sub-dot today-board-sub-dot--top500" />
                        <span>Top 500</span>
                        <span className="today-board-nav-count">{top500Count}</span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className={`today-board-sub-item${isSubActive(p, "others") ? " is-active" : ""}`}
                        onClick={() => onNavigate(p, "others")}
                      >
                        <span className="today-board-sub-dot today-board-sub-dot--others" />
                        <span>Others</span>
                        <span className="today-board-nav-count">{othersCount}</span>
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            );
          })}

          <li>
            <a href="/activity" className="today-board-nav-item today-board-nav-link">
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
              const isSessionActive = selectedSession === r.session_id;
              return (
                <li key={r.session_id}>
                  <button
                    type="button"
                    className={`today-board-nav-item today-board-session-item${isSessionActive ? " is-active" : ""}`}
                    onClick={() => onSessionSelect(isSessionActive ? null : r.session_id, r.targetPeriod)}
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
