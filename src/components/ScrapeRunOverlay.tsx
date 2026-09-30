import { useEffect, useState } from "react";
import { useScrapeRunContext } from "../context/ScrapeRunContext";
import { formatDuration, scrapeElapsedMs, scrapeJobDelta, scrapeRemainingLabel } from "../utils/scrapeControl";
import { SCRAPE_PHASE_LABELS, type ScrapePhase } from "../types/scrape";

function phaseFor(phases: ScrapePhase[], name: string): ScrapePhase | undefined {
  return phases?.find((p) => p.name === name);
}

function mark(phase: ScrapePhase | undefined, active: boolean): string {
  if (phase?.status === "ok") return "✓";
  if (phase?.status === "failed") return "✗";
  if (phase?.status === "cancelled") return "⊘";
  if (phase?.status === "running" || active) return "▸";
  return "○";
}

function phaseClass(phase: ScrapePhase | undefined, active: boolean): string {
  if (phase?.status === "ok") return "scrape-phase scrape-phase--ok";
  if (phase?.status === "failed") return "scrape-phase scrape-phase--failed";
  if (phase?.status === "cancelled") return "scrape-phase scrape-phase--cancelled";
  if (phase?.status === "running" || active) return "scrape-phase scrape-phase--running";
  return "scrape-phase scrape-phase--pending";
}

/**
 * Blocks the app while a run is in flight.
 *
 * A run rewrites the feed the page is displaying and redeploys it mid-session,
 * so letting someone keep tailoring or applying against soon-to-be-stale rows
 * invites acting on data that is about to change underneath them. The overlay
 * is deliberately not dismissable — Stop run is the way out.
 *
 * It is a view over polled state, not the run itself: the scrape lives on the
 * Mac, so closing the tab does not stop it, and reopening lands back here.
 */
export default function ScrapeRunOverlay() {
  const {
    state, knownPhases, estimate, running, cancel, loadLog, logLines, loadingLog,
    justFinished, acknowledgeFinish,
  } = useScrapeRunContext();
  const [now, setNow] = useState(() => Date.now());
  const [showLog, setShowLog] = useState(false);
  // Keyed by run id so a new run starts un-stopped without an effect resetting it.
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const stopping = running && stoppingRunId != null && stoppingRunId === state.runId;

  // The hook decides when a run has finished — it is the thing watching the
  // transition. Here that is just a value to render.
  const finished = running ? null : justFinished?.status ?? null;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Keep the log live while it is open during a run.
  useEffect(() => {
    if (!showLog) return;
    void loadLog();
    if (!running) return;
    const t = setInterval(() => { void loadLog(); }, 4000);
    return () => clearInterval(t);
  }, [showLog, running, loadLog]);

  // Suppress the browser's scroll while blocked.
  useEffect(() => {
    if (!running && !finished) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [running, finished]);

  if (!running && !finished) return null;

  const elapsed = scrapeElapsedMs(running ? state : justFinished ?? state, now);
  const shown = running ? state : justFinished ?? state;
  const delta = finished === "done" ? scrapeJobDelta(shown) : null;
  const remaining = running ? scrapeRemainingLabel(estimate.totalSec, elapsed) : null;

  // Prefer elapsed-vs-estimate for the bar: phases are lumpy (the scrape is most
  // of the run), so a per-phase fraction jumps from 0% to 25% and then stalls.
  // Falls back to phase count when there is no history yet. Capped just under
  // full so it never looks finished while work is still going.
  const doneCount = shown.phases?.filter((p) => p.status === "ok").length ?? 0;
  const phasePct = Math.round((doneCount / Math.max(knownPhases.length, 1)) * 100);
  const pct = running && estimate.totalSec
    ? Math.min(97, Math.round((elapsed / (estimate.totalSec * 1000)) * 100))
    : phasePct;

  return (
    <div className="scrape-overlay" role="dialog" aria-modal="true" aria-label="Pipeline run in progress">
      <div className="scrape-overlay-card">
        <div className="scrape-overlay-head">
          <span className={`scrape-dot ${running ? "scrape-dot--running" : finished === "done" ? "scrape-dot--ok" : "scrape-dot--error"}`} />
          <h2 className="scrape-overlay-title">
            {running ? "Scraping in progress" : finished === "done" ? "Scrape complete" : `Run ${finished}`}
          </h2>
          <span className="scrape-overlay-elapsed">
            {formatDuration(elapsed)}
            {remaining ? <span className="scrape-overlay-eta"> · {remaining}</span> : null}
          </span>
        </div>

        <p className="scrape-overlay-sub">
          {running
            ? estimate.totalSec
              ? `Running for ${formatDuration(elapsed)} — a typical run takes about ${formatDuration(estimate.totalSec * 1000)} (median of ${estimate.samples} run${estimate.samples === 1 ? "" : "s"}). The feed is being rebuilt and redeployed.`
              : "The feed is being rebuilt and redeployed. This is the first tracked run, so there's no time estimate yet."
            : finished === "done"
              ? delta != null && delta > 0
                ? `${delta} new job${delta === 1 ? "" : "s"}. Reload to see them.`
                : "Feed redeployed. Reload to pick it up."
              : "See the log below for what happened."}
        </p>

        <div className="scrape-overlay-bar" aria-hidden>
          <div className="scrape-overlay-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <ol className="scrape-phases scrape-phases--lg">
          {knownPhases.map((name) => {
            const phase = phaseFor(shown.phases ?? [], name);
            const active = running && state.phase === name;
            return (
              <li key={name} className={phaseClass(phase, active)}>
                <span className="scrape-phase-mark">{mark(phase, active)}</span>
                <span>{SCRAPE_PHASE_LABELS[name] ?? name}</span>
                <span className="scrape-phase-time">
                  {phase?.finishedAt
                    ? formatDuration(Date.parse(phase.finishedAt) - Date.parse(phase.startedAt))
                    : active ? "running" : ""}
                </span>
              </li>
            );
          })}
        </ol>

        {shown.host && <p className="scrape-host">on {shown.host}{shown.runId ? ` · ${shown.runId}` : ""}</p>}

        <div className="scrape-actions">
          <button type="button" className="scrape-action" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "Hide log" : loadingLog ? "Loading…" : "Show log"}
          </button>
          {running ? (
            <button
              type="button"
              className="scrape-action scrape-action--stop"
              disabled={stopping}
              onClick={() => { setStoppingRunId(state.runId ?? null); void cancel(); }}
            >
              {stopping ? "Stopping…" : "Stop run"}
            </button>
          ) : (
            <>
              <button type="button" className="scrape-action" onClick={acknowledgeFinish}>
                Dismiss
              </button>
              <button
                type="button"
                className="scrape-action scrape-action--go"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </>
          )}
        </div>

        {showLog && (
          <pre className="scrape-log">{logLines.length ? logLines.join("\n") : "No log output yet."}</pre>
        )}

        <p className="scrape-overlay-foot">
          The run lives on your Mac — closing this tab won't stop it.
        </p>
      </div>
    </div>
  );
}
