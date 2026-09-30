import { useCallback, useEffect, useRef, useState } from "react";
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

/** Seconds between "scrape finished" and the automatic refresh. */
const AUTO_REFRESH_S = 6;

/** The user is in the middle of something: a review sheet is open or they are typing. Refreshing now would lose it. */
function userIsBusy(): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") && Boolean((el as HTMLInputElement).value);
}

/**
 * Background run dock. It never blocks the page: a small pill in the corner shows the run
 * and opens into the full card (phases, log, Stop). While it runs you can keep reviewing,
 * tailoring and applying against the current feed, which is only replaced when the run
 * finishes.
 *
 * When a run finishes it refreshes the page data by itself: pages that can refresh in place
 * (Applications) listen for `atriveo:feed-updated` and cancel the event; every other page
 * reloads. It waits while a review sheet is open or you are typing, so nothing is lost.
 *
 * It is a view over polled state, not the run itself: the scrape lives on the Mac, so closing
 * the tab does not stop it, and reopening lands back here.
 */
export default function ScrapeRunDock() {
  const {
    state, knownPhases, estimate, running, cancel, loadLog, logLines, loadingLog,
    justFinished, acknowledgeFinish, start, starting,
  } = useScrapeRunContext();
  const dockRef = useRef<HTMLDivElement>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpandedState] = useState(() => {
    try { return sessionStorage.getItem("scrape-dock-open") === "1"; } catch { return false; }
  });
  const setExpanded = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setExpandedState((v) => {
      const value = typeof next === "function" ? next(v) : next;
      try { sessionStorage.setItem("scrape-dock-open", value ? "1" : "0"); } catch { /* private mode */ }
      return value;
    });
  }, []);
  const [showLog, setShowLog] = useState(false);
  // Keyed by run id so a new run starts un-stopped without an effect resetting it.
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const stopping = running && stoppingRunId != null && stoppingRunId === state.runId;
  const [countdown, setCountdown] = useState<number | null>(null);

  const finished = running ? null : justFinished?.status ?? null;
  const finishedKey = finished === "done" ? justFinished?.runId ?? "done" : null;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!expanded || !showLog) return;
    void loadLog();
    if (!running) return;
    const t = setInterval(() => { void loadLog(); }, 4000);
    return () => clearInterval(t);
  }, [expanded, showLog, running, loadLog]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) setExpanded(false); };
    const onDown = (e: MouseEvent) => { if (dockRef.current && !dockRef.current.contains(e.target as Node)) setExpanded(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [expanded, setExpanded]);

  // The tab title shows the run, so it is visible from another tab.
  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title;
    const base = baseTitle.current;
    if (running) {
      const label = SCRAPE_PHASE_LABELS[state.phase ?? ""] ?? "Starting";
      document.title = `◐ ${label} · ${base}`;
    } else if (justFinished?.status === "done") {
      const d = scrapeJobDelta(justFinished);
      document.title = `✓ ${d != null && d > 0 ? `${d} new jobs` : "Feed updated"} · ${base}`;
    } else if (justFinished) {
      document.title = `✕ Run ${justFinished.status} · ${base}`;
    } else {
      document.title = base;
    }
  }, [running, state.phase, justFinished]);

  // A run finished: start the countdown to the automatic refresh (derived during render, not in an effect).
  const [armedFor, setArmedFor] = useState<string | null>(null);
  if (finishedKey !== armedFor) {
    setArmedFor(finishedKey);
    setCountdown(finishedKey ? AUTO_REFRESH_S : null);
  }

  const refreshNow = useCallback(() => {
    // Pages that can update in place cancel the event; everything else reloads.
    const handledInPlace = !window.dispatchEvent(new CustomEvent("atriveo:feed-updated", { cancelable: true }));
    if (handledInPlace) acknowledgeFinish();
    else window.location.reload();
  }, [acknowledgeFinish]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
      return () => clearTimeout(t);
    }
    if (!userIsBusy()) { refreshNow(); return; }
    const t = setInterval(() => { if (!userIsBusy()) { clearInterval(t); refreshNow(); } }, 1500);
    return () => clearInterval(t);
  }, [countdown, refreshNow]);

  if (!running && !finished) return null;

  const elapsed = scrapeElapsedMs(running ? state : justFinished ?? state, now);
  const shown = running ? state : justFinished ?? state;
  const delta = finished === "done" ? scrapeJobDelta(shown) : null;
  const remaining = running ? scrapeRemainingLabel(estimate.totalSec, elapsed) : null;

  // Prefer elapsed-vs-estimate for the bar: phases are lumpy (the scrape is most of the run), so a
  // per-phase fraction jumps and then stalls. Falls back to phase count when there is no history yet.
  // Capped just under full so it never looks finished while work is still going.
  const doneCount = shown.phases?.filter((p) => p.status === "ok").length ?? 0;
  const phasePct = Math.round((doneCount / Math.max(knownPhases.length, 1)) * 100);
  const pct = running && estimate.totalSec
    ? Math.min(97, Math.round((elapsed / (estimate.totalSec * 1000)) * 100))
    : finished === "done" ? 100 : phasePct;

  const activeLabel = SCRAPE_PHASE_LABELS[state.phase ?? ""] ?? "Starting";
  const pillText = running
    ? `${activeLabel} · ${formatDuration(elapsed)}${remaining ? ` · ${remaining}` : ""}`
    : finished === "done"
      ? `${delta != null && delta > 0 ? `${delta} new job${delta === 1 ? "" : "s"}` : "Feed updated"}${countdown != null ? countdown > 0 ? ` · refreshing in ${countdown}s` : " · refreshing…" : ""}`
      : `Run ${finished}`;
  const tone = running ? "running" : finished === "done" ? "ok" : "error";

  return (
    <div className="scrape-dock" ref={dockRef} aria-live="polite">
      {expanded && (
        <section className="scrape-dock-panel scrape-overlay-card" aria-label="Pipeline run details">
          <div className="scrape-overlay-head">
            <span className={`scrape-dot scrape-dot--${tone}`} />
            <h2 className="scrape-overlay-title">
              {running ? "Scraping in progress" : finished === "done" ? "Scrape complete" : `Run ${finished}`}
            </h2>
            <span className="scrape-overlay-elapsed">{formatDuration(elapsed)}</span>
          </div>

          <p className="scrape-overlay-sub">
            {running
              ? (estimate.totalSec
                ? `A typical run takes about ${formatDuration(estimate.totalSec * 1000)} (median of ${estimate.samples}). `
                : "This is the first tracked run, so there is no time estimate yet. ")
                + "You can keep working; the current feed stays in place until the run finishes."
              : finished === "done"
                ? "The page refreshes by itself when you are not in the middle of something."
                : "See the log below for what happened."}
          </p>

          <div className="scrape-overlay-bar" aria-hidden><div className="scrape-overlay-bar-fill" style={{ width: `${pct}%` }} /></div>

          <ol className="scrape-phases scrape-phases--lg">
            {knownPhases.map((name) => {
              const phase = phaseFor(shown.phases ?? [], name);
              const active = running && state.phase === name;
              return (
                <li key={name} className={phaseClass(phase, active)}>
                  <span className="scrape-phase-mark">{mark(phase, active)}</span>
                  <span>{SCRAPE_PHASE_LABELS[name] ?? name}</span>
                  <span className="scrape-phase-time">
                    {phase?.finishedAt ? formatDuration(Date.parse(phase.finishedAt) - Date.parse(phase.startedAt)) : active ? "running" : ""}
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
                onClick={() => {
                  if (!confirmStop) { setConfirmStop(true); setTimeout(() => setConfirmStop(false), 4000); return; }
                  setConfirmStop(false); setStoppingRunId(state.runId ?? null); void cancel();
                }}
              >
                {stopping ? "Stopping…" : confirmStop ? "Confirm stop" : "Stop run"}
              </button>
            ) : finished === "done" ? (
              <>
                <button type="button" className="scrape-action" onClick={() => { setCountdown(null); acknowledgeFinish(); }}>Dismiss</button>
                <button type="button" className="scrape-action scrape-action--go" onClick={refreshNow}>Refresh now</button>
              </>
            ) : (
              <>
                <button type="button" className="scrape-action" onClick={acknowledgeFinish}>Dismiss</button>
                <button type="button" className="scrape-action scrape-action--go" disabled={starting} onClick={() => { acknowledgeFinish(); void start(); }}>{starting ? "Starting…" : "Run again"}</button>
              </>
            )}
          </div>

          {showLog && <pre className="scrape-log">{logLines.length ? logLines.join("\n") : "No log output yet."}</pre>}
          <p className="scrape-overlay-foot">The run lives on your Mac — closing this tab won't stop it.</p>
        </section>
      )}

      <div className={`scrape-dock-pill scrape-dock-pill--${tone}`}>
        <button
          type="button"
          className="scrape-dock-main"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide run details" : "Show run details"}
        >
          {running ? (
            <svg className="scrape-dock-ring" viewBox="0 0 20 20" aria-hidden>
              <circle cx="10" cy="10" r="8" className="scrape-dock-ring-bg" />
              <circle cx="10" cy="10" r="8" className="scrape-dock-ring-fg" style={{ strokeDasharray: `${(pct / 100) * 50.27} 50.27` }} />
            </svg>
          ) : <span className={`scrape-dot scrape-dot--${tone}`} aria-hidden />}
          <span className="scrape-dock-text">{pillText}</span>
          <span className="scrape-dock-caret" aria-hidden>{expanded ? "▾" : "▴"}</span>
        </button>
        {!running && countdown !== null && (
          <button type="button" className="scrape-dock-x" onClick={() => setCountdown(null)}>Cancel</button>
        )}
        {!running && countdown === null && (
          <button type="button" className="scrape-dock-x" onClick={acknowledgeFinish} aria-label="Dismiss">✕</button>
        )}
      </div>
    </div>
  );
}
