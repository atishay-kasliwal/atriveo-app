import { notifyApplicationsChanged } from "./applicationUpdates";
import JobCard, { ago, useLayout } from './JobCard';
import { useExclusions } from "../hooks/useExclusions";
import type { ResumeMatch } from "./reviewQueue";
import { TRACK_LABEL } from "./tracks";
import {useNavigate} from 'react-router-dom';
import { useEffect, useRef, useState } from "react";
import { getJson, when } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";
import { applyWithExtension, canApplyAnywhere } from "./openFill";
import "./staffing.css";

type Source = { _id: string; name: string; url: string; tier: number; enabled: boolean; status: string; detail: string; last_checked_at?: string; matching_jobs?: number; connector_state?: string; limited?: boolean; parse_errors?: number; errors?: number };
type Run = { _id: string; status: string; started_at: string; finished_at?: string; jobs_seen: number; new_jobs: number; published_jobs?: number; error?: string };
type Job = { track?: string | null; resume_match?: ResumeMatch | null; _id: string; company: string; title: string; location: string; job_url: string; summary: string; source_id: string; first_seen_at: string; observed_at?: string; description?: string; reasons: string[]; warning?: string; resume?: string; resume_status?: string | null; builder_id?: string; state: string; eligible: boolean };
type Workspace = { jobs: Job[]; total: number; counts: Record<string, number>; track_counts?: Record<string, number> };
type Status = { sources: Source[]; runs: Run[]; schedule: { label: string; next_at: string }; total_jobs: number };
const LABELS: Record<string, string> = { access_pending: "Needs provider access", not_checked: "Not checked yet", running: "Checking", ready: "Jobs readable", needs_connector: "Needs connector", blocked: "Access blocked", failed: "Check failed" };
const VIEWS: Array<[string, string]> = [["recommended", "Recommended"], ["saved", "Saved"], ["applied", "Applied"], ["browse", "Browse all"]];
/** Today's track bar: one track at a time (keys 1–7), or Mixed, which takes the tracks in turn. */
const TRACK_FILTERS = ["all", ...Object.keys(TRACK_LABEL), "mixed"];

function rememberedWorkspace(){try{const saved=JSON.parse(sessionStorage.getItem("atriveo-staffing-view")||"{}");return {view:VIEWS.some(([k])=>k===saved.view)?saved.view:"recommended",offset:Number.isInteger(saved.offset)&&saved.offset>=0?saved.offset:0,query:typeof saved.query==="string"?saved.query:"",filter:typeof saved.filter==="string"?saved.filter:"all",track:TRACK_FILTERS.includes(saved.track)?saved.track:"all"};}catch{return {view:"recommended",offset:0,query:"",filter:"all",track:"all"};}}
export default function StaffingPage({ header }: { header?: React.ReactNode }) {
  const navigate=useNavigate();
  const { exclusions, excludeCompany, removeExclusion } = useExclusions();
  const skipQuery = exclusions.companies.map(c => `&skip=${encodeURIComponent(c)}`).join("");
  const { mobile, columns, rows } = useLayout();
  const perPage = columns * rows;
  const remembered=useRef(rememberedWorkspace());
  const refreshSequence = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState(remembered.current.view);
  const [offset, setOffset] = useState(remembered.current.offset);
  const [query, setQuery] = useState(remembered.current.query);
  const [track, setTrack] = useState(remembered.current.track);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [detail, setDetail] = useState<Job | null>(null);
  const [queueing, setQueueing] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipDraft, setSkipDraft] = useState("");
  const [manual, setManual] = useState({ url: "", company: "", title: "", location: "", description: "" });
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(remembered.current.filter);
  const [note, setNote] = useState("");
  const [focused, setFocus] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmPass, setConfirmPass] = useState(false);
  useEffect(()=>{try{sessionStorage.setItem("atriveo-staffing-view",JSON.stringify({view,offset,query,filter,track}));}catch{}},[view,offset,query,filter,track]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 7000); return () => clearTimeout(t); }, [note]);
  // A page is whatever fits the window, so its start stays on a page boundary when the window changes.
  useEffect(() => { setOffset((o: number) => Math.floor(o / perPage) * perPage); }, [perPage]);
  /** Change a filter: back to the first page, first card, nothing selected (as on Today). */
  const pick = (next: { view?: string; track?: string; query?: string; filter?: string }) => {
    if (next.view !== undefined) { setView(next.view); setFilter("all"); }
    if (next.track !== undefined) setTrack(next.track);
    if (next.query !== undefined) setQuery(next.query);
    if (next.filter !== undefined) setFilter(next.filter);
    setOffset(0); setFocus(0); setSelectedIds([]); setConfirmPass(false);
  };
  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const [s, j] = await Promise.all([getJson<Status>("/staffing/status"), getJson<Workspace>(`/staffing/workspace?view=${view}&offset=${offset}&limit=${perPage}&track=${track}&q=${encodeURIComponent(query)}&source=${filter === "all" ? "" : encodeURIComponent(filter)}${skipQuery}`)]);
      if (sequence !== refreshSequence.current) return;
      setStatus(s); setJobs(j.jobs); setWorkspace(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  // Resumes build in the background; poll faster while any card on screen is waiting for one.
  const building = Boolean(workspace?.jobs.some(j => j.resume_status === "queued" || j.resume_status === "running"));
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), building ? 5000 : 15000); return () => clearInterval(timer); }, [view, offset, query, filter, track, perPage, building, skipQuery]);
  const dialogOpen = Boolean(detail) || adding || sourcesOpen;
  const closeDialogs = () => { setDetail(null); setAdding(false); setSourcesOpen(false); };
  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [dialogOpen]);
  async function action(path: string, body: object) {
    setBusy(true); setNote("");
    try {
      const r = await fetch(`${getTailorServerBase()}/staffing/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "Couldn't update the crawler");
      if (path === "run") setNote("Crawl started. Results and source status update here as it runs.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function request(path: string, body: object) {
    const r = await fetch(`${getTailorServerBase()}/staffing/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json(); if (!r.ok || !data.ok) throw new Error(data.error || "Could not update this job"); return data;
  }
  async function decide(list: Job[], state: string) {
    if (!list.length) return;
    setBusy(true); setError("");
    try {
      for (const j of list) await request("decision", { id: j._id, state });
      if (state === "applied") notifyApplicationsChanged();
      if (state === "saved" || state === "passed") setNote(`${list.length === 1 ? list[0]!.company : `${list.length} jobs`}: ${state === "saved" ? "saved for later (Saved)" : "passed"}.`);
      setDetail(null); setSelectedIds(ids => ids.filter(id => !list.some(j => j._id === id))); setConfirmPass(false); await refresh();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  }
  async function prepare(j: Job, then = "") {
    setQueueing(q => [...q, j._id]); setError("");
    try { const r = await request("prepare", { id: j._id }); setNote(r.resume ? "Resume ready. Open & Fill to start your application." : `${j.title} is queued for a resume. The card updates when it is ready.${then}`); await refresh(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setQueueing(q => q.filter(id => id !== j._id)); }
  }
  /** Create resumes for the selected jobs that don't have one (each goes to the resume queue). */
  async function prepareAll(list: Job[]) {
    setBusy(true); setError("");
    try { for (const j of list) await request("prepare", { id: j._id }); setNote(`${list.length} job${list.length === 1 ? "" : "s"} queued for a resume. The cards update as each one is ready.`); setSelectedIds([]); await refresh(); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  }
  function reviewWithAi(j: Job) {
    if (!j.resume) return void prepare(j, " Review with AI works once it is built.");
    navigate(`/resume_builder?${j.builder_id?`pasted=${encodeURIComponent(j.builder_id)}`:`job=${encodeURIComponent(j.job_url)}`}&ai=review`);
  }
  async function open(j: Job) {
    setError("");
    if (!canApplyAnywhere()) { setNote("Open the job in Chrome with Atriveo Fill installed to fill the application."); window.open(j.job_url, "_blank", "noopener,noreferrer"); return; }
    const r = await applyWithExtension(j.job_url, j.job_url); if (!r.ok) setError(r.error || "Could not open this application");
  }
  async function inspect(j: Job) { try { const r = await request("detail", { id: j._id }); setDetail({ ...j, description: r.job.description }); } catch (e) { setError(String(e)); } }
  const skipCompany = (company: string) => { excludeCompany(company); setNote(`Skipping ${company}: its jobs stay off Staffing and Today until you remove it from Skipped companies.`); };
  const waitingFor = (j: Job) => !j.resume && (queueing.includes(j._id) || j.resume_status === "queued" || j.resume_status === "running");
  const total = workspace?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.floor(offset / perPage);
  const selected = jobs.filter(j => selectedIds.includes(j._id));
  // Jobs leave the list as you act on them: keep the outline on a card and the page inside the list.
  useEffect(() => { if (focused >= jobs.length && jobs.length) setFocus(jobs.length - 1); }, [jobs.length, focused]);
  useEffect(() => { if (workspace && offset > 0 && offset >= total) setOffset(Math.max(0, (pages - 1) * perPage)); }, [workspace, offset, total, pages, perPage]);
  const needResume = selected.filter(j => !j.resume && !waitingFor(j) && j.state !== "applied");

  // Keys, as on Today: 1–7 pick a track, ←/→ (↑/↓ by row) move between cards and pages, O/A/L/S/D act on the outlined card.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || dialogOpen || busy) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TRACK_FILTERS.length) { pick({ track: TRACK_FILTERS[n - 1]! }); e.preventDefault(); return; }
    const move = (delta: number) => {
      const at = offset + focused + delta;
      if (at < 0 || at >= total) return;
      const start = Math.floor(at / perPage) * perPage;
      if (start !== offset) setOffset(start);
      setFocus(at - start);
    };
    const j = jobs[focused];
    switch (e.key) {
      case "ArrowRight": move(1); break;
      case "ArrowLeft": move(-1); break;
      case "ArrowDown": move(columns); break;
      case "ArrowUp": move(-columns); break;
      case "o": case "O": if (j && j.state !== "applied" && !waitingFor(j)) void (j.resume ? open(j) : prepare(j)); else return; break;
      case "a": case "A": if (j && j.state !== "applied") void decide([j], "applied"); else return; break;
      case "l": case "L": if (j && j.state === "new") void decide([j], "saved"); else return; break;
      case "s": case "S": if (j) skipCompany(j.company); else return; break;
      case "d": case "D": if (j && j.state !== "applied") void decide([j], "passed"); else return; break;
      case "/": searchRef.current?.focus(); break;
      default: return;
    }
    e.preventDefault();
  };
  useEffect(() => { const f = (e: KeyboardEvent) => keys.current(e); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);

  const running = status?.runs[0]?.status === "running";
  const lastCrawl = status?.runs.find(r => r.status !== "running");
  const crawlTime = lastCrawl && (lastCrawl.finished_at || lastCrawl.started_at);
  const crawlLabels: Record<string, string> = { done: "Completed", completed: "Completed", finished: "Completed", success: "Completed", partial: "Partial crawl", failed: "Failed", interrupted: "Interrupted" };
  const sources = status?.sources ?? [];
  const filtered = track !== "all" || query || filter !== "all";
  const card = (j: Job, index: number) => {
    const waiting = waitingFor(j); const applied = j.state === "applied";
    return <JobCard key={j._id} id={j._id} company={j.company} title={j.title} location={j.location || "Location not specified"} track={j.track} resumeMatch={j.resume_match} resumeReady={Boolean(j.resume)} busy={busy}
      className={index === focused ? "is-focused" : ""} onFocus={() => setFocus(index)}
      selected={selectedIds.includes(j._id)} selectDisabled={busy} onSelect={(checked) => setSelectedIds(ids => checked ? [...ids, j._id] : ids.filter(id => id !== j._id))}
      onTitle={() => void inspect(j)} onSkip={() => skipCompany(j.company)}
      onApplied={() => void decide([j], "applied")} applied={applied} appliedTitle="Mark applied: you applied yourself (A)"
      leadTags={(() => { const [tone, label] = j.resume ? ["ready", "Resume ready"] : waiting ? ["queued", j.resume_status === "running" ? "Building the resume" : "Queued for a resume"] : j.resume_status === "failed" ? ["failed", "The resume build failed"] : ["none", "No resume yet"]; return <span className={`td-resume-dot is-${tone}`} role="img" aria-label={label} title={label}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5h3.5M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></svg></span>; })()}
      tags={<>{j.state === "saved" && <span className="td-tag">Saved</span>}{j.reasons.map(r => <span key={r} className="td-tag">{r}</span>)}</>}
      notes={j.warning ? <p className="td-note warn">{j.warning}</p> : null}
      primary={<>{!applied && <button className="rv-primary" disabled={waiting || busy} onClick={() => void (j.resume ? open(j) : prepare(j))}>{j.resume ? "Open & Fill" : j.resume_status === "running" ? "Building resume…" : waiting ? "Queued for a resume" : "Create resume"}</button>}<button className="apps-btn td-ai-review" disabled={waiting || busy} onClick={() => reviewWithAi(j)}>✦ Review with AI</button></>}
      actionNote={waiting ? <p className="card-action-note" role="status">{j.resume_status === "running" ? "Building your resume now." : "In line for a resume."} This card updates when it is ready.</p> : !j.resume && j.resume_status === "failed" ? <p className="card-action-note">The last build failed. Create resume tries again.</p> : null}
      more={<>{!applied && <><button className="apps-link" disabled={busy} onClick={() => void decide([j], j.state === "saved" ? "new" : "saved")}>{j.state === "saved" ? "Unsave job" : "Save job"}</button><button className="apps-link" disabled={busy} onClick={() => void decide([j], "passed")}>Pass</button></>}{j.resume && <a className="apps-link" href={`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(j.resume)}&dl=1`}>Download saved resume</a>}<button className="apps-link" onClick={() => void inspect(j)}>View job details</button></>}
      source={j.source_id === "manual" ? "Added by you" : sources.find(s => s._id === j.source_id)?.name ?? "Staffing"} age={ago(j.first_seen_at)} ageTitle={`Found ${when(j.first_seen_at)}`} />;
  };

  return <div className="rv-page td-page staffing-page">{header}
    <div className="td-bar">
      <div className="td-title"><h1>Staffing</h1><span className="apps-muted">{!workspace ? "Loading…" : `${total} job${total === 1 ? "" : "s"} here`}</span></div>
      <form className="td-search" role="search" onSubmit={(e) => { e.preventDefault(); searchRef.current?.blur(); }}>
        <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input ref={searchRef} type="search" value={query} placeholder="Search company or role" aria-label="Search jobs" autoComplete="off" spellCheck={false} enterKeyHint="search"
          onChange={(e) => pick({ query: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") { pick({ query: "" }); e.currentTarget.blur(); } }} />
        {query ? <button type="button" className="td-search-clear" aria-label="Clear search" onClick={() => { pick({ query: "" }); searchRef.current?.focus(); }}>×</button> : <kbd aria-hidden="true">/</kbd>}
      </form>
      <div className="td-moods" role="group" aria-label="Track">
        {TRACK_FILTERS.map((t, n) => (
          <button key={t} type="button" className={`td-mood is-${t} ${track === t ? "is-on" : ""}`} aria-pressed={track === t} title={`Key ${n + 1}${t === "mixed" ? ": the tracks in turn" : ""}`} onClick={() => pick({ track: t })}>
            {t === "mixed" ? <><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.5h3c2.5 0 3.5 7 6 7h3M12 9.5l2 2-2 2M2 11.5h3c1 0 1.7-1 2.3-2.3M8.7 6.3c.6-1.1 1.3-1.8 2.3-1.8h3M12 2.5l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>Mixed</> : <>{t !== "all" && <i className="td-dot" aria-hidden="true" />}{t === "all" ? "All" : TRACK_LABEL[t]}<b>{workspace?.track_counts?.[t] ?? "…"}</b></>}
          </button>
        ))}
      </div>
      <div className="td-kinds" role="group" aria-label="Job views">
        {VIEWS.map(([k, label]) => <button key={k} type="button" className={`td-kind ${view === k ? "is-on" : ""}`} aria-pressed={view === k} onClick={() => pick({ view: k })}>{label} <b>{workspace?.counts[k] ?? "…"}</b></button>)}
        <select className="td-kind staffing-source-pick" aria-label="Source" value={filter} onChange={e => pick({ filter: e.target.value })}><option value="all">All sources</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}<option value="manual">Manually added</option></select>
        <span className="td-skiplist">
          <button type="button" className={`td-kind ${skipOpen ? "is-on" : ""}`} aria-expanded={skipOpen} onClick={() => setSkipOpen(o => !o)}>Skipped companies <b>{exclusions.companies.length}</b></button>
          {skipOpen && <div className="td-skip-pop" role="dialog" aria-label="Skipped companies">
            <form onSubmit={(e) => { e.preventDefault(); if (skipDraft.trim()) { excludeCompany(skipDraft); setSkipDraft(""); } }}>
              <input value={skipDraft} onChange={(e) => setSkipDraft(e.target.value)} placeholder="Add a company…" aria-label="Company to skip" autoFocus />
              <button type="submit" className="apps-btn" disabled={!skipDraft.trim()}>Skip</button>
            </form>
            {exclusions.companies.length ? <ul>{exclusions.companies.map((c) => <li key={c}><span>{c}</span><button type="button" className="apps-link" aria-label={`Stop skipping ${c}`} onClick={() => removeExclusion("company", c)}>Remove</button></li>)}</ul>
              : <p className="apps-muted">No companies skipped. Use Skip company on a card (or S), or add one here.</p>}
          </div>}
        </span>
        <button type="button" className="td-kind" onClick={() => setSourcesOpen(true)} title={`${sources.filter(s => s.status === "ready").length} readable · Last crawl ${when(crawlTime || null)}`}>Sources{running ? " · crawling" : ""}</button>
        <button type="button" className="td-kind" onClick={() => setAdding(true)}>+ Add a job</button>
        {filtered && <button type="button" className="apps-link" onClick={() => pick({ track: "all", query: "", filter: "all" })}>Clear filters</button>}
      </div>
      <div className="td-actions">
        {selected.length > 0 && <>
          {needResume.length > 0 && <button className="apps-btn" disabled={busy} onClick={() => void prepareAll(needResume)}>Create resumes ({needResume.length})</button>}
          {confirmPass
            ? <span className="td-confirm">Pass {selected.length}? <button className="apps-btn danger" disabled={busy} onClick={() => void decide(selected, "passed")}>Pass</button><button className="apps-link" onClick={() => setConfirmPass(false)}>Cancel</button></span>
            : <button className="apps-btn" disabled={busy} onClick={() => setConfirmPass(true)}>Pass selected ({selected.length})</button>}
          <button className="apps-btn td-desk" disabled={busy} onClick={() => setSelectedIds([])}>Clear</button>
        </>}
        {jobs.length > 0 && selected.length < jobs.length && <button className="apps-btn td-desk" disabled={busy} onClick={() => setSelectedIds(jobs.map(j => j._id))}>Select all on this page ({jobs.length})</button>}
      </div>
    </div>
    {error && <p className="ar-error" role="alert">{error} <button className="apps-link" onClick={() => void refresh()}>Retry</button></p>}
    <main className="td-grid" aria-label="Job shortlist" style={mobile ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {!workspace && <div className="td-empty">Finding your matches…</div>}
      {workspace && !jobs.length && <div className="td-empty"><strong>{filtered ? "Nothing here for this filter." : view === "recommended" ? "You’re caught up." : "No jobs here yet."}</strong>{!filtered && view === "recommended" && <span>Browse all jobs or add a posting you like.</span>}<span className="product-empty-actions">{filtered ? <button className="apps-link" onClick={() => pick({ track: "all", query: "", filter: "all" })}>Show everything</button> : <><button className="apps-btn" onClick={() => pick({ view: "browse" })}>Browse jobs</button><button className="apps-btn" onClick={() => setAdding(true)}>Add a job</button></>}</span></div>}
      {jobs.map((j, i) => card(j, i))}
    </main>
    <div className="td-bottom">
      <aside className="td-keys" aria-label="Keyboard shortcuts"><span><kbd>1</kbd>–<kbd>7</kbd> track</span><span><kbd>←</kbd><kbd>→</kbd> move</span><span><kbd>O</kbd> open</span><span><kbd>A</kbd> mark applied</span><span><kbd>L</kbd> later</span><span><kbd>S</kbd> skip company</span><span><kbd>D</kbd> pass</span><span><kbd>/</kbd> search</span></aside>
      {total > perPage && (
        <nav className="td-pager" aria-label="More jobs">
          <button className="apps-btn" disabled={current === 0} onClick={() => { setOffset(Math.max(0, offset - perPage)); setFocus(0); }} aria-label="Previous jobs">←</button>
          <span>{offset + 1}–{Math.min(offset + perPage, total)} of {total}</span>
          <button className="apps-btn" disabled={current + 1 >= pages} onClick={() => { setOffset(offset + perPage); setFocus(0); }} aria-label="Next jobs">→</button>
        </nav>
      )}
    </div>
    {note && <div className="apps-toast" role="status"><span>{note}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNote("")}>×</button></div>}
    {dialogOpen && <div className="staffing-modal-back" onClick={closeDialogs}><section ref={dialogRef} className={`staffing-detail ${sourcesOpen ? "is-sources" : ""}`} role="dialog" aria-modal="true" aria-label={adding ? "Add a job" : sourcesOpen ? "Sources and crawl status" : "Job description"} onClick={e => e.stopPropagation()}><button className="apps-btn staffing-close" autoFocus onClick={closeDialogs}>Close ✕</button>
      {detail && <><h2>{detail.title}</h2><p>{detail.company} · {detail.location}</p><a href={detail.job_url} target="_blank" rel="noreferrer">Original posting ↗</a>{detail.resume && <a className="apps-btn" href={`/resume_builder?${detail.builder_id ? `pasted=${detail.builder_id}` : `job=${encodeURIComponent(detail.job_url)}`}`}>Edit resume</a>}<div className="staffing-description">{detail.description}</div></>}
      {adding && <form onSubmit={e => { e.preventDefault(); setBusy(true); void request("add", manual).then(() => { setAdding(false); pick({ view: "saved" }); setNote("Job saved. Create its resume when you’re ready."); return refresh(); }).catch(e => setError(String(e.message))).finally(() => setBusy(false)); }}><h2>Add a job</h2><p>Paste the posting link and description. It will appear in Saved.</p>{(["url", "title", "company", "location"] as const).map(k => <label key={k}>{k === "url" ? "Job link" : k === "title" ? "Role title" : k[0].toUpperCase() + k.slice(1)}<input required={k === "url" || k === "title"} type={k === "url" ? "url" : "text"} value={manual[k]} onChange={e => setManual({ ...manual, [k]: e.target.value })} /></label>)}<label>Job description<textarea required minLength={300} value={manual.description} onChange={e => setManual({ ...manual, description: e.target.value })} /></label><button className="rv-primary" disabled={busy}>Save job</button></form>}
      {sourcesOpen && <><h2>Sources & crawl status</h2>
        <div className="staffing-title"><p>{sources.filter(s => s.status === "ready").length} readable · {lastCrawl ? `${crawlLabels[lastCrawl.status] || lastCrawl.status} ${when(crawlTime || null)} · ${lastCrawl.new_jobs ?? 0} new jobs` : "No completed crawl yet"} · Next run {when(status?.schedule.next_at || null)}</p><button className="apps-btn" disabled={busy || running || !status} onClick={() => void action("run", {})}>{running ? "Crawling…" : "Run crawl"}</button></div>
        <section aria-label="Staffing company sources" className="staffing-sources">{!status && !error && <p>Loading sources…</p>}{[1, 2, 3].map(tier => <div className="staffing-tier" key={tier}><h2>Tier {tier}</h2>{sources.filter(s => s.tier === tier).map(s => <article className="staffing-source" key={s._id}>
          <div className="staffing-source-top"><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e => void action("source", { sourceId: s._id, enabled: e.target.checked })} />Enabled</label></div>
          <span className={`staffing-state is-${s.status}`}>{s.status === "ready" && (s.limited || s.errors) ? "Jobs readable · partial crawl" : LABELS[s.status] || s.status}</span>{s.connector_state === "access_pending" && s.status !== "ready" && <small className="apps-muted">Awaiting provider access</small>}<p>{s.detail}</p><div className="staffing-source-bottom"><small>{s.last_checked_at ? `Checked ${when(s.last_checked_at)}` : "Awaiting first run"}</small><button className="apps-link" disabled={busy || running || !s.enabled} onClick={() => void action("run", { sourceIds: [s._id] })}>Check source</button></div>
        </article>)}</div>)}</section></>}
    </section></div>}
  </div>;
}
