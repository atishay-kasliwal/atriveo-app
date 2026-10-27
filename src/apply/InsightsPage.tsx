import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getJson } from "./engine";
import { lapCaption, lapColor, lapOf, lapProgress } from "./lapColors";
import { duration, FEATURES, loadUsage, PAGES, PAGE_HUE, type UsageSummary } from "./usage";
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
  milestones: { lap: number; need: number; days30: number; daysAll: number }[]; milestoneMore: number;
  assessments: { open: number; unknown: number; next: { company: string; deadlineAt: string; state: string; when: string } | null };
}
const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const label = (kind: "source" | "track", key: string) => (kind === "source" ? PLATFORM_LABEL[key as Platform] ?? (key === "other" ? "Other" : key[0]!.toUpperCase() + key.slice(1)) : TRACK_LABEL[key] ?? "Other");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** A number that counts up to its value once, so the page opens with the week arriving. Still when motion is reduced. */
function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setN(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

/** Time by page as a ring: each page is an arc in its own colour, the total sits in the middle. */
function Donut({ pages, total }: { pages: { id: string; label: string; seconds: number }[]; total: number }) {
  const R = 54, C = 2 * Math.PI * R, shown = pages.reduce((n, p) => n + p.seconds, 0) || 1;
  let acc = 0;
  return (
    <div className="in-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Share of time by page"><circle cx="70" cy="70" r={R} className="track" />
        {pages.map((p, i) => { const len = (p.seconds / shown) * C, dash = Math.max(1, len - (pages.length > 1 ? 4 : 0)); const el = <circle key={p.id} cx="70" cy="70" r={R} className="seg" stroke={PAGE_HUE[p.id] ?? "#8a919c"} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" style={{ animationDelay: `${i * 90}ms` }}><title>{`${p.label} ${duration(p.seconds)}`}</title></circle>; acc += len; return el; })}
      </svg>
      <div className="in-donut-text"><b>{duration(total)}</b><span>active</span></div>
    </div>
  );
}

/** The seven days of time and feature use shown beside the numbers, from the same counts as the Usage page. */
function useUsageGlance() {
  const [glance, setGlance] = useState<{ week: UsageSummary; all: UsageSummary } | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => { if (document.visibilityState === "visible") void Promise.all([loadUsage("7d"), loadUsage("all")]).then(([week, all]) => on && setGlance({ week, all })).catch(() => {}); };
    load(); const t = window.setInterval(load, 120_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);
  return useMemo(() => {
    if (!glance) return null;
    const pageRows = glance.week.rows.filter((r) => r.kind === "page" && r.key !== "usage" && r.seconds > 0).sort((a, b) => b.seconds - a.seconds);
    const total = pageRows.reduce((n, r) => n + r.seconds, 0);
    const used = new Set(glance.week.rows.filter((r) => r.kind === "action" && r.count > 0).map((r) => r.key));
    const everUsed = new Set(glance.all.rows.filter((r) => r.kind === "action" && r.count > 0).map((r) => r.key));
    const counts = new Map(glance.week.rows.filter((r) => r.kind === "action").map((r) => [r.key, r.count]));
    const topFeatures = FEATURES.map((f) => ({ label: f.label, count: counts.get(f.key) ?? 0 })).filter((f) => f.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    return { topFeatures, pages: pageRows.slice(0, 6).map((r) => ({ id: r.key, label: PAGES[r.key] ?? r.key, seconds: r.seconds })), total, top: pageRows[0]?.seconds ?? 1, usedCount: FEATURES.filter((f) => used.has(f.key)).length, never: FEATURES.filter((f) => !everUsed.has(f.key)).map((f) => f.label), since: glance.all.since };
  }, [glance]);
}

/** Where your search stands, on one screen: this week's pace, thirty days of it, replies, where you apply, what is waiting, and where your time goes. */
export default function InsightsPage({ header }: { header?: ReactNode }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const usage = useUsageGlance();
  const weekCount = useCountUp(data?.totals.last7 ?? 0);
  const load = useCallback(async () => { try { setData(await getJson<Insights>("/applications/insights")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000); return () => window.clearInterval(t); }, [load]);
  const view = useMemo(() => {
    if (!data) return null;
    const top = Math.max(data.today.goal, ...data.days.map((d) => d.applied), 1);
    const delta = data.totals.last7 - data.totals.prev7;
    const f = data.funnel;
    return { top, delta, steps: [["Applied", f.applied], ["Heard back", f.replied], ["Interview", f.interview], ["Assessment", f.assessment], ["Offer", f.offer]] as [string, number][], maxSrc: Math.max(1, ...data.sources.map((s) => s.count)), maxTrack: Math.max(1, ...data.tracks.map((s) => s.count)) };
  }, [data]);
  const bestIdx = data ? data.days.findIndex((d) => d.day === data.best.day) : -1;
  const tipIdx = hover ?? bestIdx, tipDay = data && tipIdx >= 0 && data.days[tipIdx]!.applied > 0 ? data.days[tipIdx]! : null;
  const shown = hover != null && data ? data.days[hover] : data?.best.day ? data.days.find((d) => d.day === data.best.day) : null;
  const todayLap = data ? lapOf(data.today.applied, data.today.goal) : 0;
  const tone = lapColor(todayLap);
  const strip = usage && usage.total > 0 ? usage.pages.map((p) => <b key={p.id} title={`${p.label} ${duration(p.seconds)}`} style={{ flexGrow: p.seconds, background: PAGE_HUE[p.id] ?? "#8a919c" }} />) : null;
  return (
    <div className="rv-page in-page">
      {header}
      <main className="in-main">
        {error && !data && <p className="in-note" role="alert">Could not load your insights ({error}). <button type="button" onClick={() => void load()}>Try again</button></p>}
        {!data && !error && <p className="in-note" aria-busy="true">Loading your insights…</p>}
        {data && view && (
          <div className="in-layout">
            <div className="in-hero" style={{ ["--tone" as string]: tone }}>
              <small className="in-eyebrow">Your search, at a glance</small>
              <h1><b>{weekCount}</b><span>applied in the last 7 days</span></h1>
              <div className="in-chips">
                <span className={`in-chip ${view.delta >= 0 ? "up" : "down"}`}>{view.delta >= 0 ? "▲" : "▼"} {Math.abs(view.delta)} vs the week before</span>
                <span className="in-chip" style={{ ["--c" as string]: tone }}><i /> Today {data.today.applied} of {data.today.goal}</span>
                <span className="in-chip"><i style={{ background: "#f0a23b" }} /> {data.streak}-day streak</span>
                <span className="in-chip">{data.totals.avg7} a day</span>
                <span className="in-chip">{data.totals.all} in all</span>
              </div>
              {strip && usage && <Link className="in-glance" to="/usage" aria-label="Where your time went this week, open Usage"><span className="in-glance-strip">{strip}</span><span>{usage.pages.slice(0, 3).map((p) => `${p.label} ${duration(p.seconds)}`).join(" · ")} · Usage →</span></Link>}
            </div>

            <section className="in-card in-chart" aria-label="Applications per day, last 30 days">
              <div className="in-chart-head"><h2>Last 30 days</h2><p>{shown ? <><b>{shown.applied}</b> on {fmtLong(shown.day)}{hover == null ? " · your best day" : ""}</> : "No applications yet"}</p></div>
              <div className="in-bars" onMouseLeave={() => setHover(null)}>
                <i className="in-goal" style={{ bottom: `${(data.today.goal / view.top) * 100}%` }}><em>goal {data.today.goal}</em></i>
                {data.days.map((d, i) => (
                  <button key={d.day} type="button" className={`in-bar${hover === i ? " on" : ""}${d.day === data.best.day ? " best" : ""}`} aria-label={`${fmtLong(d.day)}: ${d.applied} applied`}
                    style={{ height: `${Math.max(2, (d.applied / view.top) * 100)}%`, ["--c" as string]: lapColor(lapOf(d.applied, data.today.goal)), animationDelay: `${i * 18}ms`, opacity: d.applied ? 1 : 0.25 }}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />))}
                {tipDay && <span className={`in-tip${tipIdx >= 24 ? " flip" : ""}${hover == null ? " is-best" : ""}${tipDay.applied / view.top > 0.8 ? " side" : ""}`} style={{ left: `${((tipIdx + 0.5) / data.days.length) * 100}%`, ...(tipDay.applied / view.top > 0.8 ? { top: 4 } : { bottom: `calc(${Math.max(2, (tipDay.applied / view.top) * 100)}% + 8px)` }) }}>{hover == null ? `best · ${tipDay.applied}` : `${tipDay.applied} · ${fmtLong(tipDay.day)}`}</span>}
              </div>
              <div className="in-axis" aria-hidden="true"><span>{fmtDay(data.days[0]!.day)}</span><span>{fmtDay(data.days[14]!.day)}</span><span>{fmtDay(data.days[29]!.day)}</span></div>
            </section>

            <section className="in-card in-replies" aria-label="Replies">
              <h2>Replies</h2>
              <ul className="in-funnel">{view.steps.map(([name, n], i) => (
                <li key={name}><span>{name}</span><span className="rail"><b style={{ width: `${Math.max(n ? 3 : 0, pct(n, data.funnel.applied))}%`, animationDelay: `${i * 80}ms` }} /></span><span className="n">{n}</span></li>))}</ul>
              <p className="in-foot">{data.funnel.replyRate != null ? <><b>{data.funnel.replyRate}%</b> of applications over a week old have an answer</> : "Reply rate shows once ten applications are a week old"}{data.funnel.medianReplyDays != null && <> · median wait <b>{data.funnel.medianReplyDays} d</b></>}<span className="dim"> · {data.funnel.rejected} rejected · {data.funnel.none} still waiting</span></p>
            </section>
            <section className="in-card in-where" aria-label="Where you apply">
              <h2>Where you apply <small>30 days</small></h2>
              <div className="in-two">
                <ul className="in-list">{data.sources.length ? data.sources.map((s) => <li key={s.key}><span>{label("source", s.key)}</span><span className="rail"><b style={{ width: `${(s.count / view.maxSrc) * 100}%` }} /></span><span className="n">{s.count}</span></li>) : <li className="dim">No applications yet</li>}</ul>
                <ul className="in-list">{data.tracks.map((s) => <li key={s.key}><span>{label("track", s.key)}</span><span className="rail"><b style={{ width: `${(s.count / view.maxTrack) * 100}%`, background: "#a86be0" }} /></span><span className="n">{s.count}</span></li>)}</ul>
              </div>
            </section>
            <section className="in-card in-waiting" aria-label="What is waiting">
              <div className="in-dial in-wide-only" style={{ ["--c" as string]: tone }}>
                <svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="58" className="track" />{todayLap > 0 && <circle cx="70" cy="70" r="58" className="fill under" style={{ stroke: lapColor(todayLap - 1) }} strokeDasharray={2 * Math.PI * 58} strokeDashoffset={0} transform="rotate(-90 70 70)" />}<circle cx="70" cy="70" r="58" className="fill" strokeDasharray={2 * Math.PI * 58} strokeDashoffset={2 * Math.PI * 58 * (1 - lapProgress(data.today.applied, data.today.goal))} transform="rotate(-90 70 70)" /></svg>
                <div className="in-dial-text"><b>{data.today.applied}</b><span>of {data.today.goal} today</span></div>
                <p>{lapCaption(data.today.applied, data.today.goal)}</p>
              </div>
              <h2>What is waiting</h2>
              <ul className="in-wait">
                <li><span>Resumes</span><b>{data.pipeline ? data.pipeline.queued + data.pipeline.running : "—"}</b><small>{data.pipeline ? `building or queued · ${data.pipeline.done} built in 24 h${data.pipeline.failed ? ` · ${data.pipeline.failed} failed` : ""}` : "not available"}</small></li>
                <li><Link to="/general"><span>General jobs</span><b>{data.waiting.general ?? "—"}</b><small>apply with your general resume</small></Link></li>
                <li><Link to="/assessments"><span>Assessments</span><b>{data.assessments.open}</b><small>{data.assessments.next ? `next: ${data.assessments.next.company || "one"}, ${data.assessments.next.when}` : data.assessments.unknown ? `${data.assessments.unknown} need a deadline` : "none open"}</small></Link></li>
              </ul>
              {data.milestones.length > 0 && (
                <div className="in-miles"><h3>Times you hit it</h3>
                  <ul>{data.milestones.map((m) => <li key={m.lap}><span className="pg"><i style={{ background: lapColor(m.lap) }} aria-hidden="true" />{m.need}</span><b>{m.days30}×</b><small>{m.daysAll} in all</small></li>)}</ul>
                  <p className="in-foot dim">Days in the last 30 that reached each lap of your goal{data.milestoneMore > 0 ? ` · ${data.milestoneMore} higher laps reached` : ""}</p>
                </div>)}
            </section>
            <aside className="in-card in-usage" aria-label="Your time this week">
              <h2>Your time <small>7 days</small></h2>
              {usage && usage.total > 0 ? (<>
                <Donut pages={usage.pages} total={usage.total} />
                <ul className="in-legend">{usage.pages.map((p) => (
                  <li key={p.id}><span className="pg"><i style={{ background: PAGE_HUE[p.id] ?? "#8a919c" }} aria-hidden="true" />{p.label}</span><span className="t">{duration(p.seconds)}</span></li>))}</ul>
                {usage.topFeatures.length > 0 && <div className="in-block"><h3>Most used</h3><ul className="in-feats">{usage.topFeatures.map((f) => <li key={f.label}><span>{f.label}</span><b>{f.count}×</b></li>)}</ul></div>}
                <p className="in-foot"><b>{duration(usage.total)}</b> active · <b>{usage.usedCount}</b> of <b>{FEATURES.length}</b> features used</p>
                {usage.never.length > 0 && <p className="in-foot dim">Not tried yet: {usage.never.slice(0, 3).join(", ")}</p>}
              </>) : <p className="in-foot dim">{usage ? "Nothing measured this week yet." : "Time appears once the tracker has data."}</p>}
              <Link className="in-more" to="/usage">See all usage →</Link>
            </aside>
          </div>)}
      </main>
    </div>
  );
}
