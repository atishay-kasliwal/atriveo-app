import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import CompanyLogo from "../components/CompanyLogo";
import { getTailorServerBase } from "../utils/tailorServer";
import { checkCompanion, companionIsConnected, CompanionNotReady, openWithApplicationCompanion } from "./applicationCompanion";
import { fetchJson, getJson } from "./engine";
import { TRACK_LABEL } from "./tracks";
import { PLATFORM_LABEL } from "./platform";
import "./general.css";

interface Row { key: string; jobUrl: string; applyUrl: string; company: string; title: string; location: string | null; source: string | null; track: string | null; postedAt: string | null; foundAt: string | null; resume: { track: string; label: string } | null }
interface List { ok: true; total: number; allTotal: number; generalReady?: Record<string, string>; counts: { byTrack: Record<string, number>; bySource: Record<string, number>; byRange: Record<string, number> }; rows: Row[] }
const RANGES: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"], ["", "All time"]];
const TRACKS: [string, string][] = [["", "All"], ["software-engineer", "SWE"], ["ai-engineer", "AI"], ["data-analytics", "Data Analyst"], ["data-science", "DS"], ["forward-deployed", "FDE"], ["other", "Other"]];
const PAGE = 50;
const ago = (iso: string | null) => { if (!iso) return "—"; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d" : d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`; };
async function decide(jobUrl: string, decision: "skip" | "applied") {
  const route = decision === "skip" ? "job-decision" : "job-applied";
  const { res, json } = await fetchJson<{ ok?: boolean; error?: string }>(`${getTailorServerBase()}/applications/${route}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision === "skip" ? { jobUrl, decision: "skip" } : { jobUrl }) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
}

/** Jobs whose posting text could not be read, so no tailored resume exists: a table to sort, filter, skip through and apply from with your general resume for the role. */
export default function GeneralPage({ header }: { header?: ReactNode }) {
  const [range, setRange] = useState("today");
  const [track, setTrack] = useState("");
  const [sort, setSort] = useState<"new" | "company" | "title">("new");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Pick<List, "total" | "allTotal" | "counts" | "generalReady"> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string | null>(null); // the row asking "Did you apply?"
  const body = useRef<HTMLTableSectionElement>(null);
  const load = useCallback(async (skip: number, replace: boolean) => {
    setBusy(true); setError("");
    try {
      const r = await getJson<List>(`/applications/no-text?${new URLSearchParams({ range, track, sort, q: q.trim(), skip: String(skip), limit: String(PAGE) })}`);
      setMeta({ total: r.total, allTotal: r.allTotal, counts: r.counts, generalReady: r.generalReady });
      setRows((cur) => (replace ? r.rows : [...cur, ...r.rows.filter((n) => !cur.some((c) => c.key === n.key))]));
      if (replace) setPicked(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [range, track, sort, q]);
  useEffect(() => { const t = setTimeout(() => void load(0, true), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { void checkCompanion(); }, []); // connect to the extension now, so Apply can use it at once
  const drop = (keys: string[]) => { setRows((r) => r.filter((x) => !keys.includes(x.key))); setPicked((p) => { const n = new Set(p); keys.forEach((k) => n.delete(k)); return n; }); setMeta((m) => (m ? { ...m, total: Math.max(0, m.total - keys.length), allTotal: Math.max(0, m.allTotal - keys.length) } : m)); };
  const apply = async (r: Row) => {
    if (!r.resume) { setNotice(`No general resume is built for ${r.track ? TRACK_LABEL[r.track] || r.track : "this role"} yet.`); return; }
    setNotice("Opening the application with your general resume…");
    const fallback = companionIsConnected() ? null : window.open("about:blank", "_blank");
    try { await openWithApplicationCompanion({ id: r.jobUrl, applyUrl: r.applyUrl, general: true }); fallback?.close(); setNotice(`Opened ${r.company} with your ${r.resume.label} general resume. You review and submit.`); }
    catch (e) {
      if (!(e instanceof CompanionNotReady)) { fallback?.close(); setNotice(e instanceof Error ? e.message : String(e)); return; }
      if (fallback) fallback.location.href = r.applyUrl; else window.open(r.applyUrl, "_blank", "noopener,noreferrer");
      setNotice("The Atriveo extension is not connected, so the job opened without your resume. Refresh this page and try again.");
    }
    setOpened(r.key);
  };
  const skip = async (keys: string[]) => {
    const targets = rows.filter((r) => keys.includes(r.key));
    setNotice(`Skipping ${targets.length}…`);
    try { for (const t of targets) await decide(t.jobUrl, "skip"); drop(keys); setNotice(`Skipped ${targets.length}.`); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  };
  const applied = async (r: Row) => { try { await decide(r.jobUrl, "applied"); setOpened(null); drop([r.key]); setNotice(`Marked ${r.company} applied.`); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } };
  const move = (from: HTMLElement, dir: 1 | -1) => { const list = [...(body.current?.querySelectorAll<HTMLElement>("tr[data-row]") ?? [])]; list[list.indexOf(from) + dir]?.focus(); };
  const sortHead = (key: "new" | "company" | "title", label: string) => <th scope="col" aria-sort={sort === key ? "ascending" : undefined}><button type="button" className={sort === key ? "on" : ""} onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button></th>;
  const all = rows.length > 0 && rows.every((r) => picked.has(r.key));
  return (
    <div className="rv-page gn-page">
      {header}
      <main className="gn-main">
        <div className="gn-title">
          <div><h1>General resume</h1><p>{meta ? <><b>{meta.allTotal}</b> jobs whose posting text could not be read, so no tailored resume was built. Apply with your general resume for the role.</> : "Jobs without a tailored resume"}</p></div>
          <input className="gn-search" type="search" placeholder="Search company, role or place" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        {meta && (() => { const by = meta.counts.byTrack, ready = Object.keys(meta.generalReady ?? {}).reduce((n, t) => n + (by[t] ?? 0), 0), total = Object.values(by).reduce((a, b) => a + b, 0); return (
          <div className="gn-stats">
            <div><small>Waiting</small><b>{meta.allTotal}</b><span>jobs with no readable posting</span></div>
            <div><small>Ready to apply</small><b>{ready}</b><span>have a general resume for their role</span></div>
            <div><small>Need a resume</small><b>{total - ready}</b><span>role has no general resume yet</span></div>
            <div><small>Selected</small><b>{picked.size}</b><span>{picked.size ? "skip them in one go below" : "tick rows to skip in bulk"}</span></div>
          </div>); })()}
        <nav className="gn-tabs gn-range" aria-label="Found">
          {RANGES.map(([key, label]) => <button key={key} type="button" className={range === key ? "on" : ""} aria-pressed={range === key} onClick={() => setRange(key)}>{label}{meta ? <small>{meta.counts.byRange?.[key || "all"] ?? 0}</small> : null}</button>)}
        </nav>
        <nav className="gn-tabs" aria-label="Role">
          {TRACKS.map(([key, label]) => <button key={key} type="button" className={track === key ? "on" : ""} aria-pressed={track === key} onClick={() => setTrack(key)}>{label}{meta ? <small>{key ? meta.counts.byTrack[key] ?? 0 : Object.values(meta.counts.byTrack).reduce((a, b) => a + b, 0)}</small> : null}</button>)}
        </nav>
        {(picked.size > 0 || notice) && (
          <div className="gn-bar" role="status">
            {picked.size > 0 ? <><b>{picked.size} selected</b><button type="button" className="apps-btn" onClick={() => void skip([...picked])}>Skip {picked.size}</button><button type="button" className="apps-link" onClick={() => setPicked(new Set())}>Clear</button></> : <span>{notice}</span>}
          </div>
        )}
        {error && <p className="gn-error" role="alert">{error} <button type="button" className="apps-link" onClick={() => void load(0, true)}>Retry</button></p>}
        <div className="gn-scroll">
          <table className="gn-table">
            <thead><tr>
              <th scope="col" className="gn-check"><input type="checkbox" aria-label="Select all shown" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.key)))} /></th>
              {sortHead("company", "Company")}{sortHead("title", "Role")}<th scope="col">Track</th>{sortHead("new", "Found")}<th scope="col">Resume</th><th scope="col" className="gn-act"><span className="jm-sr-only">Actions</span></th>
            </tr></thead>
            <tbody ref={body}>
              {rows.map((r) => (
                <tr key={r.key} data-row tabIndex={0} className={picked.has(r.key) ? "sel" : ""}
                  onKeyDown={(e) => { if ((e.target as HTMLElement).closest("button,input,a")) return; if (e.key === "Enter") { e.preventDefault(); void apply(r); } else if (e.key === "s") { e.preventDefault(); void skip([r.key]); } else if (e.key === "ArrowDown") { e.preventDefault(); move(e.currentTarget, 1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(e.currentTarget, -1); } }}>
                  <td className="gn-check"><input type="checkbox" aria-label={`Select ${r.company}`} checked={picked.has(r.key)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} /></td>
                  <td className="gn-company"><CompanyLogo company={r.company} size="sm" /><span className="gn-two"><b title={r.company}>{r.company || "Unknown"}</b><small>{r.source ? PLATFORM_LABEL[r.source as keyof typeof PLATFORM_LABEL] || r.source : "—"}</small></span></td>
                  <td className="gn-role"><span className="gn-two"><a href={r.jobUrl} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a><small title={r.location ?? ""}>{r.location || "—"}</small></span></td>
                  <td>{r.track ? <span className="gn-chip" data-track={r.track}><i />{TRACK_LABEL[r.track] || r.track}</span> : <span className="gn-muted">—</span>}</td>
                  <td className="gn-found">{ago(r.postedAt || r.foundAt)}</td>
                  <td>{r.resume ? <span className="gn-resume"><i />{r.resume.label}</span> : <span className="gn-muted" title="Build this track's general resume first">None yet</span>}</td>
                  <td className="gn-act">
                    {opened === r.key ? <span className="gn-ask"><small>Applied?</small><button type="button" className="gn-yes" onClick={() => void applied(r)}>Yes</button><button type="button" className="gn-no" onClick={() => setOpened(null)}>No</button></span>
                      : <><button type="button" className="gn-apply" onClick={() => void apply(r)} disabled={!r.resume}>Apply ↗</button><button type="button" className="gn-skip" onClick={() => void skip([r.key])} aria-label={`Skip ${r.company}`} title="Skip (S)">✕</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!error && !busy && rows.length === 0 && <p className="gn-empty">{q || track ? "Nothing matches this filter." : range ? "Nothing found in this period. Try a longer one." : "Nothing waiting. Every job has its text or has been handled."}</p>}
          {meta && rows.length < meta.total && <button type="button" className="apps-btn gn-more" onClick={() => void load(rows.length, false)} disabled={busy}>{busy ? "Loading…" : `Show more (${meta.total - rows.length})`}</button>}
        </div>
        <p className="gn-foot">Enter applies the focused row, S skips it, arrow keys move. Applying opens the job with your general resume for its role and your details.</p>
      </main>
    </div>
  );
}
