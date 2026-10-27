import { useEffect, useMemo, useState, type ReactNode } from "react";
import { duration, FEATURES, loadUsage, PAGES, type UsageSummary } from "./usage";
import "./usage.css";

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
  return (
    <div className="rv-page us-page">
      {header}
      <main className="us-main">
        <div className="us-title"><div><h1>Usage</h1><p>{data?.since ? <>Measured since <b>{data.since}</b>. Only time and counts are kept, never a job, company or any text of yours.</> : "Time and counts only, never a job, company or any text of yours."}</p></div></div>
        <nav className="us-tabs" aria-label="Period">{RANGES.map(([k, l]) => <button key={k} type="button" className={range === k ? "on" : ""} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</nav>
        {error && <p className="us-note" role="alert">Could not load usage ({error}). The migration may not be applied yet.</p>}
        {empty && !error && <p className="us-note">Nothing measured in this period yet. Use the console for a bit and come back.</p>}
        <div className="us-stats">
          <div><small>Active time</small><b>{duration(view.total)}</b><span>visible and in use</span></div>
          <div><small>Pages used</small><b>{view.usedPages}<i> of {view.pages.length}</i></b><span>in this period</span></div>
          <div><small>Features used</small><b>{view.usedFeats}<i> of {view.feats.length}</i></b><span>named features</span></div>
          <div><small>Most time</small><b>{view.total ? view.pages[0]!.label : "—"}</b><span>{view.total ? `${Math.round((view.pages[0]!.seconds / view.total) * 100)}% of your time` : "nothing yet"}</span></div>
        </div>
        <section className="us-card" aria-labelledby="us-time">
          <h2 id="us-time">Where your time goes</h2>
          <table className="us-table"><thead><tr><th scope="col">Page</th><th scope="col">Time</th><th scope="col" className="us-barcol"><span className="us-sr">Share</span></th><th scope="col">Clicks and keys</th><th scope="col">Last used</th></tr></thead>
            <tbody>{view.pages.map((p) => (
              <tr key={p.id} className={p.seconds || p.interactions ? "" : "dim"}><td>{p.label}</td><td className="num">{duration(p.seconds)}</td>
                <td className="us-barcol"><span className="us-bar" aria-hidden="true"><b style={{ width: `${(p.seconds / view.top) * 100}%` }} /></span></td>
                <td className="num">{p.interactions}</td><td className="muted">{p.seconds || p.interactions ? ago(p.last, data?.today ?? "") : "not used"}</td></tr>))}</tbody></table>
        </section>
        <section className="us-card" aria-labelledby="us-feat">
          <h2 id="us-feat">Features</h2>
          <p className="us-sub">Named features on Matching, General, Applied and Settings. Other pages show time and clicks above.</p>
          {byPage.map(([page, list]) => (
            <div key={page} className="us-group"><h3>{PAGES[page]}</h3>
              <ul>{list.map((f) => (
                <li key={f.key} className={f.count ? "" : "dim"}><span className="name">{f.label}</span>
                  <span className="num">{f.count ? `${f.count}×` : ""}</span>
                  <span className={f.count ? "muted" : f.never ? "tag never" : "tag"}>{f.count ? ago(f.last, data?.today ?? "") : f.never ? "never used" : "not in this period"}</span></li>))}</ul>
            </div>))}
        </section>
      </main>
    </div>
  );
}
