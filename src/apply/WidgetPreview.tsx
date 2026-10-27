export interface WidgetPrefs { responses: boolean; interviews: boolean; review: boolean; streak: boolean; trend: boolean; accent: "blue" | "green" | "amber" | "rose" }
export const DEFAULT_WIDGET: WidgetPrefs = { responses: true, interviews: true, review: true, streak: true, trend: true, accent: "blue" };
export const ACCENT_COLOR: Record<WidgetPrefs["accent"], string> = { blue: "#2455e8", green: "#299e6e", amber: "#e6941a", rose: "#d93d5c" };
export interface DayCount { day: string; applied: number }
export interface WidgetData { dayKey: string; appliedToday: number; interviewEmailsToday: number; responseEmailsToday: number; reviewCount: number; days: DayCount[] }

/** Days in a row that met the goal; today counts once it has, until then the streak runs through yesterday (the same rule as the Mac widget). */
export function streakOf(data: Pick<WidgetData, "dayKey" | "appliedToday" | "days">, goal: number): number {
  const days = [...data.days].sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length) return 0;
  let i = days.length - 1, n = 0;
  if (days[i]!.day === data.dayKey) { if (data.appliedToday >= goal) n++; i--; }
  while (i >= 0 && days[i]!.applied >= goal) { n++; i--; }
  return n;
}

export const SAMPLE: WidgetData = {
  dayKey: "2026-10-27", appliedToday: 7, interviewEmailsToday: 1, responseEmailsToday: 2, reviewCount: 3,
  days: [6, 9, 11, 10, 4, 8, 12, 11, 10, 12, 10, 11, 12, 7].map((applied, i) => ({ day: `2026-10-${String(14 + i).padStart(2, "0")}`, applied })),
};

/** The Mac widget's card, drawn in the browser: a progress ring, the streak, fourteen days of bars and the chosen counts. */
export default function WidgetPreview({ data, goal, prefs, size = "medium" }: { data: WidgetData; goal: number; prefs: WidgetPrefs; size?: "small" | "medium" }) {
  const accent = ACCENT_COLOR[prefs.accent];
  const fraction = Math.min(1, data.appliedToday / Math.max(1, goal));
  const streak = streakOf(data, goal);
  const done = data.appliedToday >= goal;
  const D = size === "small" ? 92 : 124, R = D / 2 - D * 0.0575, C = 2 * Math.PI * R;
  const values = data.days.map((d) => (d.day === data.dayKey ? data.appliedToday : d.applied));
  const top = Math.max(goal, ...values, 1);
  const counts = [[prefs.responses, data.responseEmailsToday, "replies"], [prefs.interviews, data.interviewEmailsToday, "interviews"], [prefs.review, data.reviewCount, "to review"]].filter((c) => c[0]) as [boolean, number, string][];
  const ring = (
    <div className="wp-ring" style={{ width: D, height: D }} role="img" aria-label={`${data.appliedToday} of ${goal} applications today`}>
      <svg viewBox={`0 0 ${D} ${D}`} width={D} height={D} aria-hidden="true">
        <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke="currentColor" strokeOpacity=".09" strokeWidth={D * 0.115} />
        <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={accent} strokeWidth={D * 0.115} strokeLinecap="round" strokeDasharray={`${C * Math.max(fraction, data.appliedToday ? 0.015 : 0)} ${C}`} transform={`rotate(-90 ${D / 2} ${D / 2})`} style={{ filter: `drop-shadow(0 0 ${D * 0.05}px ${accent}59)` }} />
      </svg>
      <div className="wp-ring-text"><b style={{ fontSize: D * 0.36 }}>{data.appliedToday}</b>{done ? <i style={{ color: accent }}>✓</i> : <span style={{ fontSize: D * 0.125 }}>of {goal}</span>}</div>
    </div>
  );
  const logo = <span className="wp-logo"><i style={{ background: "#2455e8" }} />Atriveo</span>;
  if (size === "small") {
    return (
      <div className="wp wp-small">
        {logo}
        <div className="wp-center">{ring}</div>
        <p className="wp-foot" style={prefs.streak && streak > 0 ? { color: accent } : undefined}>{prefs.streak && streak > 0 ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : done ? "Goal reached" : `${goal - data.appliedToday} to go`}</p>
      </div>
    );
  }
  return (
    <div className="wp wp-medium">
      <div className="wp-left">{ring}<p style={done ? { color: accent } : undefined}>{done ? "Goal reached" : `${goal - data.appliedToday} to go`}</p></div>
      <div className="wp-right">
        <div className="wp-head">{logo}<span>{new Date().toLocaleDateString([], { weekday: "short", day: "numeric" })}</span></div>
        {prefs.streak && <p className="wp-streak"><span style={{ color: streak > 0 ? accent : undefined, opacity: streak > 0 ? 1 : 0.4 }}>🔥</span> {streak > 0 ? `${streak}-day streak` : "Start a streak today"}</p>}
        {prefs.trend && data.days.length > 0 && (
          <div><div className="wp-bars" role="img" aria-label={`Applications over the last ${data.days.length} days: ${values.join(", ")}`}>
            {data.days.map((d, i) => <i key={d.day} style={{ height: Math.max(3, (values[i]! / top) * 34), background: values[i]! >= goal ? accent : `${accent}47`, outline: d.day === data.dayKey ? `1.2px solid ${accent}` : undefined }} />)}
          </div><small>Last {data.days.length} days</small></div>
        )}
        {counts.length > 0 && <div className="wp-counts">{counts.map(([, n, label]) => <span key={label}><b>{n}</b>{label}</span>)}</div>}
      </div>
    </div>
  );
}
