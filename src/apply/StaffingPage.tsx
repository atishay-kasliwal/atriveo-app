import { useEffect, useState } from "react";
import { getJson, when } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";
import "./staffing.css";

type Source = { _id: string; name: string; url: string; tier: number; enabled: boolean; status: string; detail: string; last_checked_at?: string; matching_jobs?: number };
type Run = { _id: string; status: string; started_at: string; jobs_seen: number; new_jobs: number; published_jobs?: number; error?: string };
type Job = { _id: string; company: string; title: string; location: string; job_url: string; summary: string; source_id: string; first_seen_at: string };
type Status = { sources: Source[]; runs: Run[]; schedule: { label: string; next_at: string }; total_jobs: number };
const LABELS: Record<string, string> = { not_checked: "Not checked yet", running: "Checking", ready: "Jobs readable", needs_connector: "Needs connector", blocked: "Access blocked", failed: "Check failed" };

export default function StaffingPage({ header }: { header?: React.ReactNode }) {
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
  const sources = status?.sources ?? [];
  const selectedJobs = jobs.filter(j => filter === "all" || j.source_id === filter);
  return <div className="rv-page staffing-page">{header}<main className="staffing-main">
    <div className="staffing-title"><div><h1>Staffing sources</h1><p>40 company job boards · {status?.schedule.label ?? "Daily at 7:00 a.m. Eastern"}</p></div><button className="apps-btn accent" disabled={busy || running || !status} onClick={() => void action("run", {})}>{running ? "Crawl running…" : "Run daily crawl now"}</button></div>
    {error && <p className="staffing-error" role="alert">{error} <button className="apps-link" onClick={() => void refresh()}>Retry</button></p>}
    {note && <p role="status">{note}</p>}
    <div className="staffing-kpis"><span><b>{sources.filter(s => s.enabled).length}</b> enabled sources</span><span><b>{sources.filter(s => s.status === "ready").length}</b> readable boards</span><span><b>{status?.total_jobs ?? 0}</b> unique matching jobs</span><span>Next daily run <b>{when(status?.schedule.next_at ?? null)}</b></span></div>
    <p className="apps-muted">Relevant jobs appear below. Jobs that pass your existing eligibility and scoring rules also enter the job feed. Duplicate listings are grouped; no applications are submitted.</p>
    <section aria-label="Staffing company sources" className="staffing-sources">{!status && !error && <p>Loading sources…</p>}{[1, 2, 3].map(tier => <div className="staffing-tier" key={tier}><h2>Tier {tier}</h2>{sources.filter(s => s.tier === tier).map(s => <article className="staffing-source" key={s._id}>
      <div className="staffing-source-top"><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e => void action("source", { sourceId: s._id, enabled: e.target.checked })} />Enabled</label></div>
      <span className={`staffing-state is-${s.status}`}>{LABELS[s.status] || s.status}</span><p>{s.detail}</p><div className="staffing-source-bottom"><small>{s.last_checked_at ? `Checked ${when(s.last_checked_at)}` : "Awaiting first run"}</small><button className="apps-link" disabled={busy || running || !s.enabled} onClick={() => void action("run", { sourceIds: [s._id] })}>Check source</button></div>
    </article>)}</div>)}</section>
    <section className="staffing-results"><div className="staffing-title"><h2>Collected jobs</h2><label>Source <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All companies</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label></div>
      {!selectedJobs.length ? <p className="apps-muted">{running ? "The first crawl is running. Readable jobs will appear here." : "No collected jobs for this selection yet. Source cards show which boards need attention."}</p> : selectedJobs.map(j => <article className="staffing-job" key={j._id}><div><b>{j.title}</b><span>{j.company} · {j.location || "Location not specified"}</span><p>{j.summary}</p></div><a className="apps-btn" href={j.job_url} target="_blank" rel="noreferrer">View job ↗</a></article>)}
      {jobs.length >= 200 && <p className="apps-muted">Showing the latest 200 jobs.</p>}
    </section>
    <section><h2>Recent runs</h2>{status?.runs.map(r => <p className="staffing-run" key={r._id}><b>{r.status}</b> · {when(r.started_at)} · {r.jobs_seen} matching listings · {r.new_jobs} new · {r.published_jobs ?? 0} eligible for feed {r.error && <span role="alert">{r.error}</span>}</p>)}</section>
  </main></div>;
}
