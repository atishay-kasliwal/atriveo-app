import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getJson } from "./engine";
import { PLATFORM_LABEL, type Platform } from "./platform";
import { TRACK_LABEL } from "./tracks";
import "./insights.css";

interface Insights {
  ok: true; generatedAt: string;
  today: { applied: number; goal: number; tier: number; fraction: number };
  totals: { today: number; last7: number; prev7: number; last30: number; all: number; avg7: number };
  best: { day: string | null; applied: number }; streak: number;
  days: { day: string; applied: number }[];
  sources: { key: string; count: number }[]; tracks: { key: string; count: number }[];
  funnel: { applied: number; replied: number; interview: number; assessment: number; offer: number; rejected: number; none: number; replyRate: number | null; medianReplyDays: number | null };
  pipeline: { done: number; queued: number; running: number; failed: number } | null;
  waiting: { general: number | null };
  assessments: { open: number; unknown: number; next: { company: string; deadlineAt: string; state: string; when: string } | null };
}
/** The ring colours: the accent under the goal, then green, red and gold, the same as the Mac widget. */
const TIER = ["#6d7bff", "#2fb87a", "#ee5d52", "#f7b838"];
const tierOf = (n: number, goal: number) => { const m = n / Math.max(1, goal); return m >= 4 ? 3 : m >= 2 ? 2 : m >= 1 ? 1 : 0; };
const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const label = (kind: "source" | "track", key: string) => (kind === "source" ? PLATFORM_LABEL[key as Platform] ?? (key === "other" ? "Other" : key[0]!.toUpperCase() + key.slice(1)) : TRACK_LABEL[key] ?? "Other");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Where your search stands, on one centered screen: this week's pace, thirty days of it, how replies are going, where you apply, what is waiting. */
export default function InsightsPage({ header }: { header?: ReactNode }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const load = useCallback(async () => { try { setData(await getJson<Insights>("/applications/insights")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000); return () => window.clearInterval(t); }, [load]);
  const view = useMemo(() => {
    if (!data) return null;
    const top = Math.max(data.today.goal, ...data.days.map((d) => d.applied), 1);
    const delta = data.totals.last7 - data.totals.prev7;
    const f = data.funnel;
    return { top, delta, steps: [["Applied", f.applied], ["Heard back", f.replied], ["Interview", f.interview], ["Assessment", f.assessment], ["Offer", f.offer]] as [string, number][], maxSrc: Math.max(1, ...data.sources.map((s) => s.count)), maxTrack: Math.max(1, ...data.tracks.map((s) => s.count)) };
  }, [data]);
  const shown = hover != null && data ? data.days[hover] : data?.best.day ? data.days.find((d) => d.day === data.best.day) : null;
  const tone = data ? TIER[data.today.tier] : TIER[0];
  return (
    <div className="rv-page in-page">
      {header}
      <main className="in-main">
        {error && !data && <p className="in-note" role="alert">Could not load your insights ({error}). <button type="button" onClick={() => void load()}>Try again</button></p>}
        {!data && !error && <p className="in-note" aria-busy="true">Loading your insights…</p>}
        {data && view && (<>
          <div className="in-hero">
            <small className="in-eyebrow">Your search, at a glance</small>
            <h1><b>{data.totals.last7}</b><span>applied in the last 7 days</span></h1>
            <div className="in-chips">
              <span className={`in-chip ${view.delta >= 0 ? "up" : "down"}`}>{view.delta >= 0 ? "▲" : "▼"} {Math.abs(view.delta)} vs the week before</span>
              <span className="in-chip" style={{ ["--c" as string]: tone }}><i /> Today {data.today.applied} of {data.today.goal}</span>
              <span className="in-chip"><i style={{ background: "#f0a23b" }} /> {data.streak}-day streak</span>
              <span className="in-chip">{data.totals.avg7} a day</span>
              <span className="in-chip">{data.totals.all} in all</span>
            </div>
          </div>

          <section className="in-card in-chart" aria-label="Applications per day, last 30 days">
            <div className="in-chart-head"><h2>Last 30 days</h2><p>{shown ? <><b>{shown.applied}</b> on {fmtLong(shown.day)}{hover == null ? " · your best day" : ""}</> : "No applications yet"}</p></div>
            <div className="in-bars" onMouseLeave={() => setHover(null)}>
              <i className="in-goal" style={{ bottom: `${(data.today.goal / view.top) * 100}%` }}><em>goal {data.today.goal}</em></i>
              {data.days.map((d, i) => (
                <button key={d.day} type="button" className={`in-bar${hover === i ? " on" : ""}${d.day === data.best.day ? " best" : ""}`} aria-label={`${fmtLong(d.day)}: ${d.applied} applied`}
                  style={{ height: `${Math.max(2, (d.applied / view.top) * 100)}%`, background: TIER[tierOf(d.applied, data.today.goal)], animationDelay: `${i * 18}ms`, opacity: d.applied ? 1 : 0.25 }}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />))}
            </div>
            <div className="in-axis" aria-hidden="true"><span>{fmtDay(data.days[0]!.day)}</span><span>{fmtDay(data.days[14]!.day)}</span><span>{fmtDay(data.days[29]!.day)}</span></div>
          </section>

          <div className="in-grid">
            <section className="in-card" aria-label="Replies">
              <h2>Replies</h2>
              <ul className="in-funnel">{view.steps.map(([name, n], i) => (
                <li key={name}><span>{name}</span><span className="rail"><b style={{ width: `${Math.max(n ? 3 : 0, pct(n, data.funnel.applied))}%`, animationDelay: `${i * 80}ms` }} /></span><span className="n">{n}</span></li>))}</ul>
              <p className="in-foot">{data.funnel.replyRate != null ? <><b>{data.funnel.replyRate}%</b> of applications over a week old have an answer</> : "Reply rate shows once ten applications are a week old"}{data.funnel.medianReplyDays != null && <> · median wait <b>{data.funnel.medianReplyDays} d</b></>}<span className="dim"> · {data.funnel.rejected} rejected · {data.funnel.none} still waiting</span></p>
            </section>
            <section className="in-card" aria-label="Where you apply">
              <h2>Where you apply <small>30 days</small></h2>
              <div className="in-two">
                <ul className="in-list">{data.sources.length ? data.sources.map((s) => <li key={s.key}><span>{label("source", s.key)}</span><span className="rail"><b style={{ width: `${(s.count / view.maxSrc) * 100}%` }} /></span><span className="n">{s.count}</span></li>) : <li className="dim">No applications yet</li>}</ul>
                <ul className="in-list">{data.tracks.map((s) => <li key={s.key}><span>{label("track", s.key)}</span><span className="rail"><b style={{ width: `${(s.count / view.maxTrack) * 100}%`, background: "#a86be0" }} /></span><span className="n">{s.count}</span></li>)}</ul>
              </div>
            </section>
            <section className="in-card" aria-label="What is waiting">
              <h2>What is waiting</h2>
              <ul className="in-wait">
                <li><span>Resumes</span><b>{data.pipeline ? data.pipeline.queued + data.pipeline.running : "—"}</b><small>{data.pipeline ? `building or queued · ${data.pipeline.done} built in 24 h${data.pipeline.failed ? ` · ${data.pipeline.failed} failed` : ""}` : "not available"}</small></li>
                <li><Link to="/general"><span>General jobs</span><b>{data.waiting.general ?? "—"}</b><small>apply with your general resume</small></Link></li>
                <li><Link to="/assessments"><span>Assessments</span><b>{data.assessments.open}</b><small>{data.assessments.next ? `next: ${data.assessments.next.company || "one"}, ${data.assessments.next.when}` : data.assessments.unknown ? `${data.assessments.unknown} need a deadline` : "none open"}</small></Link></li>
              </ul>
            </section>
          </div>
        </>)}
      </main>
    </div>
  );
}
