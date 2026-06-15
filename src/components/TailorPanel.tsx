import { useEffect, useRef, useState } from "react";
import type { TailorJobState, TailorLogEntry, TailorLogKind, TailorRunState } from "../types/tailor";
import { formatProcessLogTime24 } from "../utils/processLogTime";
import TailorExplainPanel from "./TailorExplainPanel";

interface Props {
  run: TailorRunState | null;
  onOpenPath: (path: string) => void;
  onDismiss: () => void;
}

const PHASE_LABEL: Record<TailorJobState["phase"], string> = {
  queued: "Queued",
  analyzing: "Phase 1/3 · Compose",
  assembling: "Phase 2/3 · Assemble",
  compiling: "Phase 3/3 · Compile",
  reviewing: "Phase 3/3 · Compile", // legacy phase id — Gemma review disabled
  done: "Complete",
};

const LOG_MARKER: Record<TailorLogKind, string> = {
  step: "▸",
  think: "·",
  result: "✓",
  warn: "⚠",
  error: "✕",
};

function fmtLogTime(iso: string): string {
  return formatProcessLogTime24(iso);
}

function fmtElapsed(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

function jobPhaseWeight(phase: TailorJobState["phase"]): number {
  switch (phase) {
    case "done": return 1;
    case "reviewing": return 0.94; // legacy — Gemma disabled
    case "compiling": return 0.94;
    case "assembling": return 0.55;
    case "analyzing": return 0.28;
    case "queued": return 0.05;
    default: return 0;
  }
}

function runProgressPct(run: TailorRunState): number {
  if (!run.total) return run.active ? 2 : 0;
  const sum = run.jobs.reduce((acc, job) => acc + jobPhaseWeight(job.phase), 0);
  return Math.min(100, Math.max(run.active ? 2 : 0, Math.round((sum / run.total) * 100)));
}

function estimateRemaining(run: TailorRunState, progressPct: number): string | null {
  if (!run.active || progressPct >= 100) return null;

  const analyzingJobs = run.jobs.filter((j) => j.phase === "analyzing").length;
  const perJobDefaultMin = analyzingJobs > 0 ? 4 : 1;

  const startIso = run.runLogs?.[0]?.at;
  if (!startIso || progressPct < 10) {
    const totalMin = Math.max(perJobDefaultMin, run.total * 3);
    return `~${totalMin} min est.`;
  }

  const elapsedMs = Date.now() - new Date(startIso).getTime();
  if (elapsedMs < 8000 || progressPct < 10) {
    return `~${Math.max(perJobDefaultMin, run.total * 3)} min est.`;
  }

  const totalEstMs = elapsedMs / (progressPct / 100);
  const remainingMs = Math.max(0, totalEstMs - elapsedMs);
  const sec = Math.round(remainingMs / 1000);
  if (sec < 45) return `~${sec}s left`;
  if (sec < 90) return "~1 min left";
  const min = Math.ceil(sec / 60);
  return `~${min} min left`;
}

function latestLogLine(logs: TailorLogEntry[]): string | null {
  if (!logs.length) return null;
  return logs[logs.length - 1]?.text ?? null;
}

function statusTone(job: TailorJobState): string {
  if (job.phase !== "done") return job.phase === "queued" ? "queued" : "running";
  if (job.status === "ok" && job.pdf) return job.borderline ? "success-warn" : "success";
  if (job.status === "no-go") return "blocked";
  if (job.status === "unsupported-jd") return "blocked";
  return "error";
}

function statusCopy(job: TailorJobState): string {
  if (job.phase !== "done") return PHASE_LABEL[job.phase];
  if (job.status === "ok" && job.pdf) {
    return job.borderline
      ? (job.ats ? `PDF ready · ATS ${job.ats} · borderline JD` : "PDF ready · borderline JD")
      : (job.ats ? `PDF ready · ATS ${job.ats}` : "PDF ready");
  }
  if (job.status === "no-go") return job.error || "No-Go · eligibility blocked";
  if (job.status === "unsupported-jd") return job.error || "Unsupported JD · not an engineering role";
  if (job.status === "tex-failed") return job.error ? `Compile failed · ${job.error.slice(0, 80)}` : "Compile failed";
  if (job.status === "ai-failed") return job.error ? `AI failed · ${job.error.slice(0, 80)}` : "AI failed";
  return job.error || "Finished with issues";
}

function formatLogsForCopy(logs: TailorLogEntry[]): string {
  return logs
    .map((entry) => {
      const step = entry.step != null ? `#${String(entry.step).padStart(3, "0")}` : "   ";
      const time = fmtLogTime(entry.at);
      const elapsed = fmtElapsed(entry.elapsedMs);
      return `${time} ${step} ${elapsed.padStart(8)} ${entry.kind.toUpperCase().padEnd(6)} ${entry.text}`;
    })
    .join("\n");
}

function CollapsibleLogPanel({
  logs,
  active,
  label,
  defaultOpen = false,
  onCopy,
}: {
  logs: TailorLogEntry[];
  active: boolean;
  label: string;
  defaultOpen?: boolean;
  onCopy?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const endRef = useRef<HTMLDivElement>(null);
  const latest = latestLogLine(logs);
  const hasNew = active && logs.length > 0;

  useEffect(() => {
    if (open && active) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs.length, active, open]);

  if (!logs.length) return null;

  return (
    <div className={`tailor-thought-block${open ? " is-open" : " is-collapsed"}${hasNew && !open ? " has-updates" : ""}`}>
      <button
        type="button"
        className="tailor-thought-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="tailor-thought-chevron" aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="tailor-thought-toggle-label">{label}</span>
        <span className="tailor-thought-badge">{logs.length} lines</span>
        {!open && hasNew && <span className="tailor-thought-live">Live</span>}
        {!open && (
          <span className="tailor-thought-hint">
            {hasNew ? "Tap to open live log" : "Tap to expand"}
          </span>
        )}
        {onCopy && open && (
          <span
            role="button"
            tabIndex={0}
            className="tailor-thought-copy"
            onClick={(e) => { e.stopPropagation(); onCopy(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onCopy(); } }}
          >
            Copy log
          </span>
        )}
      </button>
      {!open && latest && (
        <div className="tailor-thought-preview" title={latest}>
          Latest · {latest}
        </div>
      )}
      {open && (
        <div className="tailor-thought-stream" aria-label={label}>
          {logs.map((entry) => (
            <div key={entry.id} className={`tailor-thought-line is-${entry.kind}`}>
              <span className="tailor-thought-meta">
                <time dateTime={entry.at} className="tailor-thought-time">{fmtLogTime(entry.at)}</time>
                {entry.step != null && <span className="tailor-thought-step">#{entry.step}</span>}
                {entry.elapsedMs != null && <span className="tailor-thought-elapsed">{fmtElapsed(entry.elapsedMs)}</span>}
              </span>
              <span className="tailor-thought-marker" aria-hidden="true">{LOG_MARKER[entry.kind]}</span>
              <span className="tailor-thought-text">{entry.text}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

export default function TailorPanel({ run, onOpenPath, onDismiss }: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!run?.active) return;
    const id = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, [run?.active]);

  if (!run || (!run.active && !run.jobs.length && !run.fatalError && !run.summary)) return null;

  const progressPct = runProgressPct(run);
  const eta = estimateRemaining(run, progressPct);
  const okCount = run.jobs.filter((j) => j.phase === "done" && j.status === "ok" && j.pdf).length;
  const allLogs = [...(run.runLogs ?? []), ...run.jobs.flatMap((j) => j.logs)];
  const runLogs =
    (run.runLogs?.length ?? 0) > 0
      ? run.runLogs!
      : run.active
        ? [{ id: "wait", index: -1, kind: "step" as const, text: "Waiting for server stream…", at: new Date().toISOString() }]
        : [];

  const copyAllLogs = () => {
    const text = [
      "=== RUN ===",
      formatLogsForCopy(run.runLogs ?? []),
      ...run.jobs.map((j) => `\n=== ${j.company} · ${j.role} ===\n${formatLogsForCopy(j.logs)}`),
    ].join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

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
                ? `${run.completed}/${run.total} finished · ${run.model || "Ollama"} · logs collapsed below — expand to watch live`
                : run.summary || `${okCount}/${run.total} PDF${okCount === 1 ? "" : "s"} saved`}
          </p>
          {run.dateDir && !run.fatalError && (
            <code className="tailor-panel-path">{run.dateDir}</code>
          )}
        </div>
        <div className="tailor-panel-head-actions">
          {allLogs.length > 0 && (
            <button type="button" className="tailor-panel-btn subtle" onClick={copyAllLogs}>
              Copy all logs
            </button>
          )}
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
          <div className="tailor-panel-progress-meta">
            <strong>{progressPct}%</strong>
            {eta && <span className="tailor-panel-eta">{eta}</span>}
          </div>
        </div>
      )}

      {runLogs.length > 0 && (
        <CollapsibleLogPanel
          logs={runLogs}
          active={run.active}
          label="Run log · client + server"
          defaultOpen={false}
          onCopy={() => navigator.clipboard.writeText(formatLogsForCopy(run.runLogs ?? [])).catch(() => {})}
        />
      )}

      {run.jobs.length > 0 && (
        <ol className="tailor-job-list">
          {run.jobs.map((job) => {
            const tone = statusTone(job);
            const isRunning = job.phase !== "done" && job.phase !== "queued";
            const latest = latestLogLine(job.logs);
            const jobLogs =
              job.logs.length > 0
                ? job.logs
                : isRunning || run.active
                  ? [{ id: "wait", index: job.index, kind: "step" as const, text: "Waiting for job logs from server…", at: new Date().toISOString() }]
                  : [];

            return (
              <li key={`${job.index}-${job.company}-${job.role}`} className={`tailor-job-row is-${tone}${isRunning ? " is-active" : ""}`}>
                <div className="tailor-job-row-top">
                  <div className="tailor-job-main">
                    <strong>{job.company}</strong>
                    <span>{job.role}</span>
                    {job.folder && <small>{job.folder}</small>}
                  </div>
                  <div className="tailor-job-status">
                    {isRunning && <span className="tailor-job-spinner" aria-hidden="true" />}
                    <span title={latest || undefined}>{latest || statusCopy(job)}</span>
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
                </div>
                {job.phase === "done" && job.explain ? (
                  <TailorExplainPanel explain={job.explain} compact />
                ) : null}
                {jobLogs.length > 0 && (
                  <CollapsibleLogPanel
                    logs={jobLogs}
                    active={isRunning || run.active}
                    label={`Job log · ${job.logs.length || "…"} steps`}
                    defaultOpen={false}
                    onCopy={() => navigator.clipboard.writeText(formatLogsForCopy(job.logs)).catch(() => {})}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
