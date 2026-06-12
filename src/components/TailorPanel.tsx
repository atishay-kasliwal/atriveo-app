import type { TailorJobState, TailorRunState } from "../types/tailor";

interface Props {
  run: TailorRunState | null;
  onOpenPath: (path: string) => void;
  onDismiss: () => void;
}

const PHASE_LABEL: Record<TailorJobState["phase"], string> = {
  queued: "Queued",
  analyzing: "Ollama · ATS + rewrites",
  assembling: "Assembling resume.tex",
  compiling: "Compiling PDF",
  done: "Complete",
};

function statusTone(job: TailorJobState): string {
  if (job.phase !== "done") return job.phase === "queued" ? "queued" : "running";
  if (job.status === "ok" && job.pdf) return "success";
  if (job.status === "no-go") return "blocked";
  return "error";
}

function statusCopy(job: TailorJobState): string {
  if (job.phase !== "done") return PHASE_LABEL[job.phase];
  if (job.status === "ok" && job.pdf) return job.ats ? `PDF ready · ATS ${job.ats}` : "PDF ready";
  if (job.status === "no-go") return job.error || "No-Go · eligibility blocked";
  if (job.status === "tex-failed") return job.error ? `Compile failed · ${job.error.slice(0, 80)}` : "Compile failed";
  if (job.status === "ai-failed") return job.error ? `AI failed · ${job.error.slice(0, 80)}` : "AI failed";
  return job.error || "Finished with issues";
}

export default function TailorPanel({ run, onOpenPath, onDismiss }: Props) {
  if (!run || (!run.active && !run.jobs.length && !run.fatalError && !run.summary)) return null;

  const progressPct = run.total > 0 ? Math.round((run.completed / run.total) * 100) : 0;
  const okCount = run.jobs.filter((j) => j.phase === "done" && j.status === "ok" && j.pdf).length;

  return (
    <section className="tailor-panel" aria-label="Resume tailoring progress" aria-live="polite">
      <div className="tailor-panel-head">
        <div>
          <span className="tailor-panel-kicker">Local tailor</span>
          <h3>{run.active ? "Tailoring selected jobs…" : run.fatalError ? "Tailor run failed" : "Tailor run complete"}</h3>
          <p>
            {run.fatalError
              ? run.fatalError
              : run.active
                ? `${run.completed}/${run.total} finished · ${run.model || "Ollama"} · outputs on external drive`
                : run.summary || `${okCount}/${run.total} PDF${okCount === 1 ? "" : "s"} saved`}
          </p>
          {run.dateDir && !run.fatalError && (
            <code className="tailor-panel-path">{run.dateDir}</code>
          )}
        </div>
        <div className="tailor-panel-head-actions">
          {run.dateDir && !run.active && (
            <button type="button" className="tailor-panel-btn subtle" onClick={() => onOpenPath(run.dateDir!)}>
              Open folder
            </button>
          )}
          {!run.active && (
            <button type="button" className="tailor-panel-btn subtle" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      </div>

      {run.total > 0 && (
        <div className="tailor-panel-progress" aria-hidden={!run.active}>
          <div className="tailor-panel-progress-track">
            <span style={{ width: `${progressPct}%` }} />
          </div>
          <strong>{progressPct}%</strong>
        </div>
      )}

      {run.jobs.length > 0 && (
        <ol className="tailor-job-list">
          {run.jobs.map((job) => {
            const tone = statusTone(job);
            const isRunning = job.phase !== "done" && job.phase !== "queued";
            return (
              <li key={`${job.index}-${job.company}-${job.role}`} className={`tailor-job-row is-${tone}${isRunning ? " is-active" : ""}`}>
                <div className="tailor-job-main">
                  <strong>{job.company}</strong>
                  <span>{job.role}</span>
                  {job.folder && <small>{job.folder}</small>}
                </div>
                <div className="tailor-job-status">
                  {isRunning && <span className="tailor-job-spinner" aria-hidden="true" />}
                  <span>{statusCopy(job)}</span>
                </div>
                {job.phase === "done" && (job.pdfPath || job.dir) && (
                  <div className="tailor-job-actions">
                    {job.pdfPath && (
                      <button type="button" className="tailor-panel-btn" onClick={() => onOpenPath(job.pdfPath!)}>
                        Open PDF
                      </button>
                    )}
                    {job.dir && (
                      <button type="button" className="tailor-panel-btn subtle" onClick={() => onOpenPath(job.dir!)}>
                        Folder
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
