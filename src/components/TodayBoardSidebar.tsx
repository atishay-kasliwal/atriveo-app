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

const TIME_GROUPS: { period: Period; label: string }[] = [
  { period: "hour",      label: "This Hour" },
  { period: "today",     label: "Today" },
  { period: "yesterday", label: "Yesterday" },
  { period: "week",      label: "This Week" },
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
  function jobsForPeriod(p: Period): Job[] {
    return p === "hour" ? hourJobs : p === "today" ? todayJobs : p === "yesterday" ? yesterdayJobs : weekJobs;
  }

  function countForPeriod(p: Period): number {
    return p === "hour" ? periodCounts.hour
      : p === "today" ? periodCounts.today
      : p === "yesterday" ? periodCounts.yesterday
      : (periodCounts.week ?? weekJobs.length);
  }

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
          {TIME_GROUPS.map(({ period: p, label }) => {
            const jobs = jobsForPeriod(p);
            const top500Count = jobs.filter((j) => isTop500(j.company ?? "")).length;
            const othersCount = jobs.length - top500Count;
            const totalCount = countForPeriod(p);
            const isGroupActive = period === p;

            return (
              <li key={p} className="today-board-group">
                {/* Period header — navigates to "all" */}
                <button
                  type="button"
                  className={`today-board-group-label${isGroupActive && scope === "all" ? " is-active" : ""}`}
                  onClick={() => onNavigate(p, "all")}
                >
                  <span>{label}</span>
                  <span className="today-board-nav-count">{totalCount}</span>
                </button>

                {/* Always-visible sub-links */}
                <ul className="today-board-sub-list">
                  <li>
                    <button
                      type="button"
                      className={`today-board-sub-item${isGroupActive && scope === "top500" ? " is-active" : ""}`}
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
                      className={`today-board-sub-item${isGroupActive && scope === "others" ? " is-active" : ""}`}
                      onClick={() => onNavigate(p, "others")}
                    >
                      <span className="today-board-sub-dot today-board-sub-dot--others" />
                      <span>Others</span>
                      <span className="today-board-nav-count">{othersCount}</span>
                    </button>
                  </li>
                </ul>
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
            {runCards.slice(0, 15).map((r, index) => {
              const isSessionActive = selectedSession === r.session_id;
              const sessionJobs = jobsForPeriod(r.targetPeriod ?? "hour").filter(
                (j) => j.session_id === r.session_id,
              );
              const t5 = sessionJobs.filter((j) => isTop500(j.company ?? "")).length;
              const others = sessionJobs.length - t5;
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
                        <span className="today-board-session-breakdown">
                          {t5 > 0 && (
                            <span className="session-t5-count">
                              <span className="session-dot session-dot--t5" />{t5}
                            </span>
                          )}
                          {others > 0 && (
                            <span className="session-others-count">
                              <span className="session-dot session-dot--others" />{others}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className="today-board-session-count">{r.count}</span>
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
