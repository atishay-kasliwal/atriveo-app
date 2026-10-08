import { useEffect, useRef, useState } from "react";
import { getJson, when } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";
import "./staffing.css";

type Source = { _id: string; name: string; url: string; tier: number; enabled: boolean; status: string; detail: string; last_checked_at?: string; matching_jobs?: number; connector_state?: string; limited?: boolean; parse_errors?: number; errors?: number };
type Run = { _id: string; status: string; started_at: string; finished_at?: string; jobs_seen: number; new_jobs: number; published_jobs?: number; error?: string };
type Job = { _id: string; company: string; title: string; location: string; job_url: string; summary: string; source_id: string; first_seen_at: string; observed_at?: string };
type Status = { sources: Source[]; runs: Run[]; schedule: { label: string; next_at: string }; total_jobs: number };
const LABELS: Record<string, string> = { access_pending: "Needs provider access", not_checked: "Not checked yet", running: "Checking", ready: "Jobs readable", needs_connector: "Needs connector", blocked: "Access blocked", failed: "Check failed" };

export default function StaffingPage({ header }: { header?: React.ReactNode }) {
  const carousel = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [note, setNote] = useState("");
  async function refresh() {
    try {
      const [s, j] = await Promise.all([getJson<Status>("/staffing/status"), getJson<{ jobs: Job[] }>("/staffing/jobs")]);
      setStatus(s); setJobs(j.jobs); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, []);
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
  const running = status?.runs[0]?.status === "running";
  const lastCrawl = status?.runs.find(r => r.status !== "running");
  const crawlTime = lastCrawl && (lastCrawl.finished_at || lastCrawl.started_at);
  const crawlLabels: Record<string, string> = { done: "Completed", completed: "Completed", finished: "Completed", success: "Completed", partial: "Partial crawl", failed: "Failed", interrupted: "Interrupted" };
  const sources = status?.sources ?? [];
  const selectedJobs = jobs.filter(j => filter === "all" || j.source_id === filter);
  return <div className="rv-page staffing-page">{header}<main className="staffing-main">
    <div className="staffing-title"><div><h1>Staffing sources</h1><p>{status?.sources.length ?? "…"} job sources · {status?.schedule.label ?? "Daily at 7:00 a.m. Eastern"}</p></div><button className="apps-btn accent" disabled={busy || running || !status} onClick={() => void action("run", {})}>{running ? "Crawl running…" : "Run daily crawl now"}</button></div>
    {error && <p className="staffing-error" role="alert">{error} <button className="apps-link" onClick={() => void refresh()}>Retry</button></p>}
    {note && <p role="status">{note}</p>}
    <div className="staffing-kpis"><span><b>{sources.filter(s => s.enabled).length}</b> enabled sources</span><span><b>{sources.filter(s => s.status === "ready").length}</b> readable boards</span><span><b>{sources.filter(s => (s.status === "blocked" || s.status === "access_pending")).length}</b> access restricted</span><span><b>{status?.total_jobs ?? 0}</b> unique matching jobs</span><span>Next daily run <b>{when(status?.schedule.next_at ?? null)}</b></span></div>
    <div className="staffing-last-crawl" aria-label="Last crawl">
      <div><strong>Last crawl</strong> {crawlTime ? <time dateTime={crawlTime}>{new Date(crawlTime).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time> : status ? "No completed crawl yet" : "Loading…"}</div>
      {lastCrawl && <div className="apps-muted">{crawlLabels[lastCrawl.status] || lastCrawl.status} · {lastCrawl.jobs_seen ?? 0} matching listings · {lastCrawl.new_jobs ?? 0} new · {lastCrawl.published_jobs ?? 0} eligible for feed{lastCrawl.error && <span className="staffing-error" role="alert"> · {lastCrawl.error}</span>}</div>}
      {running && <div className="apps-muted" role="status">A new crawl is running. This shows the previous crawl until it finishes.</div>}
    </div>
    <p className="apps-muted">Relevant jobs appear below. Jobs that pass your existing eligibility and scoring rules also enter the job feed. Duplicate listings are grouped; no applications are submitted.</p>
    <section className="staffing-results" aria-label="Collected jobs">
      <div className="staffing-title"><h2>Collected jobs <small className="apps-muted">({selectedJobs.length})</small></h2><div className="staffing-carousel-controls"><label>Source <select value={filter} onChange={e => { setFilter(e.target.value); carousel.current?.scrollTo({ left: 0 }); }}><option value="all">All companies</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label><button className="apps-btn" aria-label="Previous jobs" onClick={() => carousel.current?.scrollBy({ left: -carousel.current.clientWidth, behavior: "smooth" })}>←</button><button className="apps-btn" aria-label="Next jobs" onClick={() => carousel.current?.scrollBy({ left: carousel.current.clientWidth, behavior: "smooth" })}>→</button></div></div>
      {!selectedJobs.length ? <p className="apps-muted">{!status ? "Loading jobs…" : "No collected jobs for this selection yet."}</p> : <div className="staffing-carousel" ref={carousel} tabIndex={0} aria-label="Job cards; scroll to browse"><div className="staffing-carousel-track">{selectedJobs.map(j => <article className="staffing-job-card" key={j._id}><small className="apps-muted">{sources.find(s => s._id === j.source_id)?.name || j.company}</small><h3>{j.title}</h3><div className="apps-muted">{j.company} · {j.location || "Location not specified"}</div><p>{j.summary}</p><div className="staffing-job-dates"><small>Found <time dateTime={j.first_seen_at}>{when(j.first_seen_at)}</time></small>{j.observed_at && <small>Last seen <time dateTime={j.observed_at}>{when(j.observed_at)}</time></small>}</div><a className="apps-btn" href={j.job_url} target="_blank" rel="noreferrer">View job ↗</a></article>)}</div></div>}
    </section>
    <section aria-label="Staffing company sources" className="staffing-sources">{!status && !error && <p>Loading sources…</p>}{[1, 2, 3].map(tier => <div className="staffing-tier" key={tier}><h2>Tier {tier}</h2>{sources.filter(s => s.tier === tier).map(s => <article className="staffing-source" key={s._id}>
      <div className="staffing-source-top"><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e => void action("source", { sourceId: s._id, enabled: e.target.checked })} />Enabled</label></div>
      <span className={`staffing-state is-${s.status}`}>{s.status === "ready" && (s.limited || s.errors) ? "Jobs readable · partial crawl" : LABELS[s.status] || s.status}</span>{s.connector_state === "access_pending" && s.status !== "ready" && <small className="apps-muted">Awaiting provider access</small>}<p>{s.detail}</p><div className="staffing-source-bottom"><small>{s.last_checked_at ? `Checked ${when(s.last_checked_at)}` : "Awaiting first run"}</small><button className="apps-link" disabled={busy || running || !s.enabled} onClick={() => void action("run", { sourceIds: [s._id] })}>Check source</button></div>
    </article>)}</div>)}</section>
    <section><h2>Recent runs</h2>{status?.runs.map(r => <p className="staffing-run" key={r._id}><b>{r.status}</b> · {when(r.started_at)} · {r.jobs_seen} matching listings · {r.new_jobs} new · {r.published_jobs ?? 0} eligible for feed {r.error && <span role="alert">{r.error}</span>}</p>)}</section>
  </main></div>;
}
