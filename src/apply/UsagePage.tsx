import { useEffect, useMemo, useState, type ReactNode } from "react";
import { duration, FEATURES, loadUsage, PAGES, type UsageSummary } from "./usage";
import "./usage.css";

/** One colour per page, so the strip, the rows and the feature groups read as the same thing. */
const PAGE_HUE: Record<string, string> = { today: "#6d7bff", matching: "#4f9dff", applied: "#2fb87a", general: "#a86be0", staffing: "#f0a23b", resumes: "#e5584f", bank: "#3fc6c0", outreach: "#e56fb0", stats: "#9bb0ff", ready: "#c9b458", settings: "#8a919c", usage: "#5f6773" };

const RANGES: [string, string][] = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
const ago = (day: string | null, today: string) => { if (!day) return "never"; const d = Math.round((Date.parse(today) - Date.parse(day)) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

/** Where your time goes and which features you use, from counts and seconds kept by the console itself. */
export default function UsagePage({ header }: { header?: ReactNode }) {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [all, setAll] = useState<UsageSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let on = true; setError(""); loadUsage(range).then((d) => on && setData(d)).catch((e) => on && setError(String(e.message || e))); return () => { on = false; }; }, [range]);
  useEffect(() => { let on = true; loadUsage("all").then((d) => on && setAll(d)).catch(() => {}); return () => { on = false; }; }, []);
  const view = useMemo(() => {
    const rows = data?.rows ?? [], everUsed = new Set((all?.rows ?? []).filter((r) => r.kind === "action" && r.count > 0).map((r) => r.key));
    const pages = Object.entries(PAGES).map(([id, label]) => { const r = rows.find((x) => x.kind === "page" && x.key === id); const i = rows.find((x) => x.kind === "action" && x.key === `${id}.interactions`); return { id, label, seconds: r?.seconds ?? 0, visits: r?.count ?? 0, interactions: i?.count ?? 0, last: r?.last ?? null }; }).sort((a, b) => b.seconds - a.seconds);
    const total = pages.reduce((n, p) => n + p.seconds, 0), top = Math.max(1, ...pages.map((p) => p.seconds));
    const feats = FEATURES.map((f) => { const r = rows.find((x) => x.kind === "action" && x.key === f.key); return { ...f, count: r?.count ?? 0, last: r?.last ?? null, never: !everUsed.has(f.key) }; });
    return { pages, total, top, feats, usedPages: pages.filter((p) => p.seconds > 0).length, usedFeats: feats.filter((f) => f.count > 0).length };
  }, [data, all]);
  const empty = data && data.rows.length === 0;
  const byPage = useMemo(() => { const m = new Map<string, typeof view.feats>(); for (const f of view.feats) m.set(f.page, [...(m.get(f.page) ?? []), f]); return [...m.entries()]; }, [view]);
  const hue = (id: string) => PAGE_HUE[id] ?? "#8a919c";
  const matching = byPage.filter(([p]) => p === "matching"), rest = byPage.filter(([p]) => p !== "matching");
  const group = ([page, list]: (typeof byPage)[number]) => (
    <div key={page} className={`us-group us-g-${page}`}><h3><i style={{ background: hue(page) }} aria-hidden="true" />{PAGES[page]}</h3>
      <ul>{list.map((f) => (
        <li key={f.key} className={f.count ? "" : "dim"}><span className="name">{f.label}</span>
          <span className="num">{f.count ? `${f.count}×` : ""}</span>
          <span className={f.count ? "muted" : f.never ? "tag never" : "tag"}>{f.count ? ago(f.last, data?.today ?? "") : f.never ? "never" : "not now"}</span></li>))}</ul>
    </div>);
  return (
    <div className="rv-page us-page">
      {header}
      <main className="us-main">
        <div className="us-top">
          <div className="us-title"><h1>Usage</h1><p>{data?.since ? <>Since <b>{data.since}</b>. Time and counts only, never a job, company or text of yours.</> : "Time and counts only, never a job, company or text of yours."}</p></div>
          <nav className="us-tabs" aria-label="Period">{RANGES.map(([k, l]) => <button key={k} type="button" className={range === k ? "on" : ""} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</nav>
        </div>
        {error && <p className="us-note" role="alert">Could not load usage ({error}). The migration may not be applied yet.</p>}
        {empty && !error && <p className="us-note">Nothing measured in this period yet. Use the console for a bit and come back.</p>}
        <div className="us-stats">
          <div><small>Active time</small><b>{duration(view.total)}</b></div>
          <div><small>Pages used</small><b>{view.usedPages}<i> / {view.pages.length}</i></b></div>
          <div><small>Features used</small><b>{view.usedFeats}<i> / {view.feats.length}</i></b></div>
          <div><small>Most time</small><b>{view.total ? view.pages[0]!.label : "—"}<i>{view.total ? ` ${Math.round((view.pages[0]!.seconds / view.total) * 100)}%` : ""}</i></b></div>
        </div>
        <div className="us-body">
          <section className="us-card us-time" aria-labelledby="us-time">
            <h2 id="us-time">Where your time goes</h2>
            <div className="us-strip" role="img" aria-label="Share of time by page">{view.total ? view.pages.filter((p) => p.seconds > 0).map((p) => <b key={p.id} title={`${p.label} ${duration(p.seconds)}`} style={{ flexGrow: p.seconds, background: hue(p.id) }} />) : <b style={{ flexGrow: 1, background: "var(--us-soft)" }} />}</div>
            <ul className="us-pages">{view.pages.map((p) => (
              <li key={p.id} className={p.seconds || p.interactions ? "" : "dim"}>
                <span className="pg"><i style={{ background: hue(p.id) }} aria-hidden="true" />{p.label}</span>
                <span className="num">{duration(p.seconds)}</span>
                <span className="share" aria-hidden="true"><b style={{ width: `${(p.seconds / view.top) * 100}%`, background: hue(p.id) }} /></span>
                <span className="num sm">{p.interactions || ""}</span>
                <span className="muted sm">{p.seconds || p.interactions ? ago(p.last, data?.today ?? "") : "not used"}</span></li>))}</ul>
            <p className="us-foot">Clicks and keys on the right of each bar. Other pages show time and clicks only.</p>
          </section>
          <section className="us-card us-feat" aria-labelledby="us-feat">
            <h2 id="us-feat">Features</h2>
            <div className="us-feat-grid">{matching.map(group)}<div className="us-rest">{rest.map(group)}</div></div>
          </section>
        </div>
      </main>
    </div>
  );
}
