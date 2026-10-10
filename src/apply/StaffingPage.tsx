import { notifyApplicationsChanged } from "./applicationUpdates";
import JobCard, { ago } from './JobCard';
import { useExclusions } from "../hooks/useExclusions";
import type { ResumeMatch } from "./reviewQueue";
import {useNavigate} from 'react-router-dom';
import { useEffect, useRef, useState } from "react";
import { getJson, when } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";
import { applyWithExtension, canApplyAnywhere } from "./openFill";
import "./staffing.css";

type Source = { _id: string; name: string; url: string; tier: number; enabled: boolean; status: string; detail: string; last_checked_at?: string; matching_jobs?: number; connector_state?: string; limited?: boolean; parse_errors?: number; errors?: number };
type Run = { _id: string; status: string; started_at: string; finished_at?: string; jobs_seen: number; new_jobs: number; published_jobs?: number; error?: string };
type Job = { track?: string | null; resume_match?: ResumeMatch | null; _id: string; company: string; title: string; location: string; job_url: string; summary: string; source_id: string; first_seen_at: string; observed_at?: string; description?: string; reasons: string[]; warning?: string; resume?: string; resume_status?: string | null; builder_id?: string; state: string; eligible: boolean };
type Workspace = { jobs: Job[]; total: number; counts: Record<string, number> };
type Status = { sources: Source[]; runs: Run[]; schedule: { label: string; next_at: string }; total_jobs: number };
const LABELS: Record<string, string> = { access_pending: "Needs provider access", not_checked: "Not checked yet", running: "Checking", ready: "Jobs readable", needs_connector: "Needs connector", blocked: "Access blocked", failed: "Check failed" };

function rememberedWorkspace(){try{const saved=JSON.parse(sessionStorage.getItem("atriveo-staffing-view")||"{}");return {view:["recommended","saved","applied","browse"].includes(saved.view)?saved.view:"recommended",offset:Number.isInteger(saved.offset)&&saved.offset>=0?saved.offset:0,query:typeof saved.query==="string"?saved.query:"",filter:typeof saved.filter==="string"?saved.filter:"all"};}catch{return {view:"recommended",offset:0,query:"",filter:"all"};}}
export default function StaffingPage({ header }: { header?: React.ReactNode }) {
  const navigate=useNavigate();
  const { exclusions, excludeCompany } = useExclusions();
  const skipQuery = exclusions.companies.map(c => `&skip=${encodeURIComponent(c)}`).join("");
  const remembered=useRef(rememberedWorkspace());
  const refreshSequence = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const [view, setView] = useState(remembered.current.view);
  const [offset, setOffset] = useState(remembered.current.offset);
  const [query, setQuery] = useState(remembered.current.query);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [detail, setDetail] = useState<Job | null>(null);
  const [queueing, setQueueing] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ url: "", company: "", title: "", location: "", description: "" });
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(remembered.current.filter);
  const [note, setNote] = useState("");
  useEffect(()=>{try{sessionStorage.setItem("atriveo-staffing-view",JSON.stringify({view,offset,query,filter}));}catch{}},[view,offset,query,filter]);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const [s, j] = await Promise.all([getJson<Status>("/staffing/status"), getJson<Workspace>(`/staffing/workspace?view=${view}&offset=${offset}&q=${encodeURIComponent(query)}&source=${filter === "all" ? "" : encodeURIComponent(filter)}${skipQuery}`)]);
      if (sequence !== refreshSequence.current) return;
      setStatus(s); setJobs(j.jobs); setWorkspace(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  // Resumes build in the background; poll faster while any card on screen is waiting for one.
  const building = Boolean(workspace?.jobs.some(j => j.resume_status === "queued" || j.resume_status === "running"));
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), building ? 5000 : 15000); return () => clearInterval(timer); }, [view, offset, query, filter, building, skipQuery]);
  useEffect(() => {
    if (!detail && !adding) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDetail(null); setAdding(false); }
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [Boolean(detail), adding]);
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
  async function decide(j: Job, state: string) {
    setBusy(true); setError("");
    try { await request("decision", { id: j._id, state }); if (state === "applied") notifyApplicationsChanged(); setDetail(null); setOffset(0); await refresh(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  }
  async function prepare(j: Job, then = "") {
    setQueueing(q => [...q, j._id]); setError("");
    try { const r = await request("prepare", { id: j._id }); setNote(r.resume ? "Resume ready. Open & Fill to start your application." : `${j.title} is queued for a resume. The card updates when it is ready.${then}`); await refresh(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setQueueing(q => q.filter(id => id !== j._id)); }
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
  const running = status?.runs[0]?.status === "running";
  const lastCrawl = status?.runs.find(r => r.status !== "running");
  const crawlTime = lastCrawl && (lastCrawl.finished_at || lastCrawl.started_at);
  const crawlLabels: Record<string, string> = { done: "Completed", completed: "Completed", finished: "Completed", success: "Completed", partial: "Partial crawl", failed: "Failed", interrupted: "Interrupted" };
  const sources = status?.sources ?? [];
  const selectedJobs = jobs;
  return <div className="rv-page staffing-page">{header}<main className="staffing-main">
    <div className="staffing-title"><div><h1>Your next applications</h1><p>A few good matches. One clear next step.</p></div><button className="apps-btn" onClick={() => setAdding(true)}>+ Add a job</button></div>
    {error && <p className="staffing-error" role="alert">{error} <button className="apps-link" onClick={() => void refresh()}>Retry</button></p>}
    {note && <p role="status">{note}</p>}
    <nav className="staffing-views" aria-label="Job views">{[["recommended", "Recommended"], ["saved", "Saved"], ["applied", "Applied"], ["browse", "Browse all"]].map(([key, label]) => <button className={`apps-btn ${view === key ? "accent" : ""}`} aria-pressed={view === key} key={key} onClick={() => { setView(key); setOffset(0); setFilter("all"); setQuery(""); }}>{label} <small>{workspace?.counts[key] ?? "…"}</small></button>)}</nav>
    {view === "browse" && <div className="staffing-search"><input aria-label="Search jobs" placeholder="Search role, company, location" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} /><select aria-label="Source" value={filter} onChange={e => { setFilter(e.target.value); setOffset(0); }}><option value="all">All sources</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}<option value="manual">Manually added</option></select></div>}
    <section className="staffing-shortlist td-page" aria-label="Job shortlist"><div className="td-grid staffing-grid">
      {!workspace ? <p>Finding your matches…</p> : !selectedJobs.length ? <p className="apps-muted">{view === "recommended" ? "You’re caught up. Browse all jobs or add a posting you like." : "No jobs here yet."}<span className="product-empty-actions"><button className="apps-btn" onClick={()=>{setView("browse");setOffset(0);}}>Browse jobs</button><button className="apps-btn" onClick={()=>setAdding(true)}>Add a job</button></span></p> : selectedJobs.map(j => { const waiting = !j.resume && (queueing.includes(j._id) || j.resume_status === "queued" || j.resume_status === "running"); const applied = j.state === "applied"; return <JobCard key={j._id} id={j._id} company={j.company} title={j.title} location={j.location || "Location not specified"} track={j.track} resumeMatch={j.resume_match} resumeReady={Boolean(j.resume)} busy={busy}
        onTitle={() => void inspect(j)} onSkip={() => { excludeCompany(j.company); setNote(`Skipping ${j.company}: its jobs stay off Staffing and Today until you remove it from Skipped companies.`); }}
        onApplied={() => void decide(j, "applied")} applied={applied} appliedTitle="Mark applied: you applied yourself"
        tags={<>{j.resume ? <span className="td-tag" title="Its tailored resume is ready">Resume ready</span> : waiting ? <span className="td-tag td-notready">{j.resume_status === "running" ? "Building resume" : "Queued for a resume"}</span> : <span className="td-tag td-notready">Resume needed</span>}{j.reasons.map(r => <span key={r} className="td-tag">{r}</span>)}</>}
        notes={j.warning ? <p className="td-note warn">{j.warning}</p> : null}
        primary={<>{!applied && <button className="rv-primary" disabled={waiting || busy} onClick={() => void (j.resume ? open(j) : prepare(j))}>{j.resume ? "Open & Fill" : j.resume_status === "running" ? "Building resume…" : waiting ? "Queued for a resume" : "Create resume"}</button>}<button className="apps-btn td-ai-review" disabled={waiting || busy} onClick={() => reviewWithAi(j)}>✦ Review with AI</button></>}
        actionNote={waiting ? <p className="card-action-note" role="status">{j.resume_status === "running" ? "Building your resume now." : "In line for a resume."} This card updates when it is ready.</p> : !j.resume && j.resume_status === "failed" ? <p className="card-action-note">The last build failed. Create resume tries again.</p> : null}
        more={<>{!applied && <><button className="apps-link" disabled={busy} onClick={() => void decide(j, j.state === "saved" ? "new" : "saved")}>{j.state === "saved" ? "Unsave job" : "Save job"}</button><button className="apps-link" disabled={busy} onClick={() => void decide(j, "passed")}>Pass</button></>}{j.resume && <a className="apps-link" href={`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(j.resume)}&dl=1`}>Download saved resume</a>}<button className="apps-link" onClick={() => void inspect(j)}>View job details</button></>}
        source={j.source_id === "manual" ? "Added by you" : sources.find(s => s._id === j.source_id)?.name ?? "Staffing"} age={ago(j.first_seen_at)} ageTitle={`Found ${when(j.first_seen_at)}`} />; })}
    </div></section>
    {workspace && workspace.total > 10 && <div className="staffing-pagination"><button className="apps-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 10))}>Previous</button><small>{offset + 1}–{Math.min(offset + 10, workspace.total)} of {workspace.total}</small><button className="apps-btn" disabled={offset + 10 >= workspace.total} onClick={() => setOffset(offset + 10)}>Next ten →</button></div>}
    <details className="staffing-source-details"><summary>Sources & crawl status <small>{sources.filter(s => s.status === "ready").length} readable · Last crawl {when(crawlTime || null)}</small></summary>
    <div className="staffing-title"><p>{lastCrawl ? `${crawlLabels[lastCrawl.status] || lastCrawl.status} · ${lastCrawl.new_jobs ?? 0} new jobs` : "No completed crawl yet"} · Next run {when(status?.schedule.next_at || null)}</p><button className="apps-btn" disabled={busy || running || !status} onClick={() => void action("run", {})}>{running ? "Crawling…" : "Run crawl"}</button></div>
    <section aria-label="Staffing company sources" className="staffing-sources">{!status && !error && <p>Loading sources…</p>}{[1, 2, 3].map(tier => <div className="staffing-tier" key={tier}><h2>Tier {tier}</h2>{sources.filter(s => s.tier === tier).map(s => <article className="staffing-source" key={s._id}>
      <div className="staffing-source-top"><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e => void action("source", { sourceId: s._id, enabled: e.target.checked })} />Enabled</label></div>
      <span className={`staffing-state is-${s.status}`}>{s.status === "ready" && (s.limited || s.errors) ? "Jobs readable · partial crawl" : LABELS[s.status] || s.status}</span>{s.connector_state === "access_pending" && s.status !== "ready" && <small className="apps-muted">Awaiting provider access</small>}<p>{s.detail}</p><div className="staffing-source-bottom"><small>{s.last_checked_at ? `Checked ${when(s.last_checked_at)}` : "Awaiting first run"}</small><button className="apps-link" disabled={busy || running || !s.enabled} onClick={() => void action("run", { sourceIds: [s._id] })}>Check source</button></div>
    </article>)}</div>)}</section>
    </details>
    {(detail || adding) && <div className="staffing-modal-back" onClick={() => { setDetail(null); setAdding(false); }}><section ref={dialogRef} className="staffing-detail" role="dialog" aria-modal="true" aria-label={adding ? "Add a job" : "Job description"} onClick={e => e.stopPropagation()}><button className="apps-btn staffing-close" autoFocus onClick={() => { setDetail(null); setAdding(false); }}>Close ✕</button>{detail && <><h2>{detail.title}</h2><p>{detail.company} · {detail.location}</p><a href={detail.job_url} target="_blank" rel="noreferrer">Original posting ↗</a>{detail.resume && <a className="apps-btn" href={`/resume_builder?${detail.builder_id ? `pasted=${detail.builder_id}` : `job=${encodeURIComponent(detail.job_url)}`}`}>Edit resume</a>}<div className="staffing-description">{detail.description}</div></>}{adding && <form onSubmit={e => { e.preventDefault(); setBusy(true); void request("add", manual).then(() => { setAdding(false); setView("saved"); setOffset(0); setNote("Job saved. Create its resume when you’re ready."); return refresh(); }).catch(e => setError(String(e.message))).finally(() => setBusy(false)); }}><h2>Add a job</h2><p>Paste the posting link and description. It will appear in Saved.</p>{(["url", "title", "company", "location"] as const).map(k => <label key={k}>{k === "url" ? "Job link" : k === "title" ? "Role title" : k[0].toUpperCase() + k.slice(1)}<input required={k === "url" || k === "title"} type={k === "url" ? "url" : "text"} value={manual[k]} onChange={e => setManual({ ...manual, [k]: e.target.value })} /></label>)}<label>Job description<textarea required minLength={300} value={manual.description} onChange={e => setManual({ ...manual, description: e.target.value })} /></label><button className="rv-primary" disabled={busy}>Save job</button></form>}</section></div>}
  </main></div>;
}
