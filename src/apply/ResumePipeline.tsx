import { useEffect, useState } from "react";
import { fetchJson, getJson } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

interface Build { company: string; title: string; stage: string; progress: number }
interface Reason { reason: string; count: number; retryable: boolean; needsText: boolean }
interface Pipeline { queued: number; running: number; stuck: number; done: number; failed: number; reasons: Reason[]; current: Build[]; next: Build[] }

const STAGES: Record<string, string> = { QUEUED: "Waiting", GATED: "Checking fit", COMPOSED: "Choosing bullets", OPTIMIZED: "Fitting the page", TEX: "Typesetting", PDF: "Rendering PDF" };

/** Tailored resumes in the pipeline: a bar that fills as the day's queue finishes; hover or focus shows what is being built. */
export default function ResumePipeline({ online }: { online: boolean | null }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [retrying, setRetrying] = useState(false);
  const busy = Boolean(data?.running);
  useEffect(() => {
    let stop = false, timer: number | undefined;
    const load = async () => {
      if (document.visibilityState === "visible") { try { const d = await getJson<Pipeline>("/applications/resume-pipeline"); if (!stop) setData(d); } catch { /* the bar keeps its last numbers */ } }
      if (!stop) timer = window.setTimeout(load, busy ? 6_000 : 20_000);
    };
    void load();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [busy]);
  const retry = async (scope: "failed" | "stuck") => {
    if (retrying) return;
    setRetrying(true); setNote("");
    try {
      const { res, json } = await fetchJson<{ ok?: boolean; error?: string; requeued: number; waitingForText: number; notRetryable: number }>(`${getTailorServerBase()}/applications/resume-retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      const parts = [`Requeued ${json.requeued}`];
      if (json.waitingForText) parts.push(`${json.waitingForText} still have no job text`);
      if (json.notRetryable) parts.push(`${json.notRetryable} are out of scope`);
      setNote(parts.join(" · ")); setData(await getJson<Pipeline>("/applications/resume-pipeline"));
    } catch (e) { setNote(e instanceof Error ? e.message : "Retry failed"); } finally { setRetrying(false); }
  };
  const waiting = data ? data.queued + data.running : 0;
  const total = data ? data.done + waiting : 0;
  const pct = total ? Math.round((data!.done / total) * 100) : 0;
  const label = online === false ? "Worker offline" : busy ? "Building" : "Worker running";
  return (
    <span className={`apply-pipeline${online === false ? " is-offline" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} tabIndex={0} role="status" aria-label={data ? `Resume pipeline: ${data.running} building, ${data.queued} queued, ${data.done} done in 24 hours` : "Resume pipeline"}>
      <i aria-hidden="true" className={busy ? "is-busy" : ""} />
      <span className="apply-pipeline-label">{label}</span>
      {data && <span className="apply-pipeline-meter" aria-hidden="true"><b style={{ width: `${pct}%` }} /></span>}
      {data && <span className="apply-pipeline-count">{waiting ? `${waiting} queued` : "All built"}</span>}
      {open && data && (
        <span className="apply-pipeline-pop" role="tooltip">
          <b>Tailored resumes · last 24 h</b>
          <span className="apply-pipeline-nums"><span><b>{data.running}</b> building</span><span><b>{data.queued}</b> queued</span><span><b>{data.done}</b> done</span><span className={data.failed ? "is-bad" : ""}><b>{data.failed}</b> failed</span></span>
          {data.failed > 0 && <span className="apply-pipeline-list"><em>Why they failed</em>{data.reasons.map((r, i) => <span key={i} className="apply-pipeline-reason"><b>{r.count}</b><span>{r.reason}<small>{r.retryable ? (r.needsText ? "Retried once the job text arrives" : "Can be retried") : "Out of scope, will not be retried"}</small></span></span>)}<button type="button" className="apps-btn apply-pipeline-retry" onClick={() => void retry("failed")} disabled={retrying || !data.reasons.some((r) => r.retryable)}>{retrying ? "Retrying…" : "Retry failed"}</button></span>}
          {data.stuck > 0 && <span className="apply-pipeline-list"><em>Stuck</em><span className="apply-pipeline-reason"><b>{data.stuck}</b><span>Started by a worker that stopped, so they never finished<small>Put back in the queue</small></span></span><button type="button" className="apps-btn apply-pipeline-retry" onClick={() => void retry("stuck")} disabled={retrying}>{retrying ? "Requeuing…" : "Requeue stuck"}</button></span>}
          {note && <small role="status" className="apply-pipeline-note">{note}</small>}
          {data.current.length > 0 && <span className="apply-pipeline-list"><em>Building now</em>{data.current.map((j, i) => <span key={i} className="apply-pipeline-job"><span>{j.company}<small>{j.title}</small></span><span className="apply-pipeline-step"><small>{STAGES[j.stage] || j.stage}</small><span className="apply-pipeline-meter"><b style={{ width: `${j.progress}%` }} /></span></span></span>)}</span>}
          {data.next.length > 0 && <span className="apply-pipeline-list"><em>Next up</em>{data.next.slice(0, 4).map((j, i) => <span key={i} className="apply-pipeline-job"><span>{j.company}<small>{j.title}</small></span></span>)}{waiting - data.running > 4 && <small>+ {waiting - data.running - 4} more</small>}</span>}
          {!data.current.length && !data.next.length && <small>Nothing waiting. Every queued resume is built.</small>}
        </span>
      )}
    </span>
  );
}
