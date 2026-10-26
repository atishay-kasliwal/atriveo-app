import { useEffect, useState } from "react";
import { getJson } from "./engine";

interface Build { company: string; title: string; stage: string; progress: number }
interface Pipeline { queued: number; running: number; done: number; failed: number; current: Build[]; next: Build[] }

const STAGES: Record<string, string> = { QUEUED: "Waiting", GATED: "Checking fit", COMPOSED: "Choosing bullets", OPTIMIZED: "Fitting the page", TEX: "Typesetting", PDF: "Rendering PDF" };

/** Tailored resumes in the pipeline: a bar that fills as the day's queue finishes; hover or focus shows what is being built. */
export default function ResumePipeline({ online }: { online: boolean | null }) {
  const [data, setData] = useState<Pipeline | null>(null);
  const [open, setOpen] = useState(false);
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
          {data.current.length > 0 && <span className="apply-pipeline-list"><em>Building now</em>{data.current.map((j, i) => <span key={i} className="apply-pipeline-job"><span>{j.company}<small>{j.title}</small></span><span className="apply-pipeline-step"><small>{STAGES[j.stage] || j.stage}</small><span className="apply-pipeline-meter"><b style={{ width: `${j.progress}%` }} /></span></span></span>)}</span>}
          {data.next.length > 0 && <span className="apply-pipeline-list"><em>Next up</em>{data.next.slice(0, 4).map((j, i) => <span key={i} className="apply-pipeline-job"><span>{j.company}<small>{j.title}</small></span></span>)}{waiting - data.running > 4 && <small>+ {waiting - data.running - 4} more</small>}</span>}
          {!data.current.length && !data.next.length && <small>Nothing waiting. Every queued resume is built.</small>}
        </span>
      )}
    </span>
  );
}
