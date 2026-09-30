import { useEffect, useRef, useState } from "react";
import { useScrapeRunContext } from "../context/ScrapeRunContext";
import { formatDuration, scrapeElapsedMs, scrapeJobDelta } from "../utils/scrapeControl";
import { SCRAPE_PHASE_LABELS, type ScrapePhase, type ScrapeRunState } from "../types/scrape";
import "../styles/scrape.css";

function phaseFor(state: ScrapeRunState, name: string): ScrapePhase | undefined {
  return state.phases?.find((p) => p.name === name);
}

function phaseMark(phase: ScrapePhase | undefined, isActive: boolean): string {
  if (!phase) return isActive ? "◍" : "○";
  if (phase.status === "ok") return "✓";
  if (phase.status === "failed") return "✗";
  if (phase.status === "cancelled") return "⊘";
  return "◍";
}

function summaryLabel(state: ScrapeRunState, running: boolean, elapsed: number): string {
  if (running) {
    const label = SCRAPE_PHASE_LABELS[state.phase ?? ""] ?? "Starting";
    return `${label} · ${formatDuration(elapsed)}`;
  }
  if (state.status === "done") {
    const delta = scrapeJobDelta(state);
    if (delta != null && delta > 0) return `+${delta} new jobs`;
    return "Up to date";
  }
  if (state.status === "failed") return "Last run failed";
  if (state.status === "cancelled") return "Last run cancelled";
  if (state.status === "interrupted") return "Last run interrupted";
  return "Never run";
}

/**
 * Header control that triggers a scrape on the Mac and reports progress.
 *
 * Replaces the hourly LaunchAgent. Runs live on the Mac, not in this tab, so
 * everything here reflects polled state — closing the tab does not stop a run,
 * and reopening reattaches to one already going.
 */
export default function ScrapeNowButton() {
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLDivElement>(null);

  // Shared with the blocking overlay — see context/ScrapeRunContext. The hook
  // owns "a run just finished"; a finished run redeploys the static feed JSON
  // that /api/jobs serves, so the new rows only exist after a page load.
  const {
    state, knownPhases, running, offline, error, starting,
    logLines, loadingLog, start, cancel, loadLog, dismissError, justFinished,
  } = useScrapeRunContext();
  const freshRun = justFinished?.status === "done" ? justFinished : null;

  // Local ticker so the elapsed readout moves between 2s status polls.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (showLog) void loadLog();
  }, [showLog, loadLog, state.phase]);

  const elapsed = scrapeElapsedMs(state, now);
  const tone = offline ? "offline"
    : running ? "running"
    : state.status === "failed" || state.status === "interrupted" ? "error"
    : state.status === "done" ? "ok"
    : "idle";

  return (
    <div className="scrape-ctl" ref={panelRef}>
      <button
        type="button"
        className={`scrape-btn scrape-btn--${tone}`}
        onClick={() => (running || offline ? setOpen((v) => !v) : void start())}
        disabled={starting}
        title={offline ? "Your Mac is unreachable — the sidecar is not running" : "Run the pipeline now"}
      >
        <span className={`scrape-dot scrape-dot--${tone}`} aria-hidden />
        <span className="scrape-btn-label">
          {offline ? "Mac offline" : running ? summaryLabel(state, true, elapsed) : starting ? "Starting…" : "Scrape now"}
        </span>
      </button>

      <button
        type="button"
        className="scrape-caret"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Scrape details"
      >
        ▾
      </button>

      {open && (
        <div className="scrape-panel" role="dialog" aria-label="Scrape status">
          <div className="scrape-panel-head">
            <span className="scrape-panel-title">Pipeline run</span>
            <span className="scrape-panel-meta">
              {running ? formatDuration(elapsed) : summaryLabel(state, false, elapsed)}
            </span>
          </div>

          {offline && (
            <p className="scrape-note scrape-note--warn">
              Cannot reach your Mac. Start the sidecar there:
              <code>npm run tailor:prod</code>
            </p>
          )}

          {error && (
            <p className="scrape-note scrape-note--error">
              {error}
              <button type="button" className="scrape-note-x" onClick={dismissError} aria-label="Dismiss">×</button>
            </p>
          )}

          {freshRun && !running && (
            <p className="scrape-note scrape-note--fresh">
              {(() => {
                const delta = scrapeJobDelta(freshRun);
                return delta != null && delta > 0
                  ? `${delta} new job${delta === 1 ? "" : "s"} deployed.`
                  : "Feed redeployed.";
              })()}
              <button
                type="button"
                className="scrape-note-action"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </p>
          )}

          <ol className="scrape-phases">
            {knownPhases.map((name: string) => {
              const phase = phaseFor(state, name);
              const isActive = running && state.phase === name;
              const status = phase?.status ?? (isActive ? "running" : "pending");
              return (
                <li key={name} className={`scrape-phase scrape-phase--${status}`}>
                  <span className="scrape-phase-mark">{phaseMark(phase, isActive)}</span>
                  <span className="scrape-phase-name">{SCRAPE_PHASE_LABELS[name] ?? name}</span>
                  {phase?.finishedAt && phase.startedAt && (
                    <span className="scrape-phase-time">
                      {formatDuration(Date.parse(phase.finishedAt) - Date.parse(phase.startedAt))}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {state.host && <p className="scrape-host">on {state.host}</p>}

          <div className="scrape-actions">
            {running ? (
              <button type="button" className="scrape-action scrape-action--stop" onClick={() => void cancel()}>
                Stop run
              </button>
            ) : (
              <button
                type="button"
                className="scrape-action scrape-action--go"
                onClick={() => void start()}
                disabled={offline || starting}
              >
                {starting ? "Starting…" : "Run now"}
              </button>
            )}
            <button type="button" className="scrape-action" onClick={() => setShowLog((v) => !v)}>
              {showLog ? "Hide log" : "Show log"}
            </button>
          </div>

          {showLog && (
            <pre className="scrape-log">
              {loadingLog && !logLines.length ? "Loading…" : logLines.slice(-60).join("\n") || "No log output yet."}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
