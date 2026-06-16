import { useEffect, useMemo, useRef, useState } from "react";
import type { TailorProcessLogEntry, TailorQueueItem } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE } from "../types/tailorQueue";
import { formatTailorDuration } from "../utils/tailorProgress";
import { formatProcessLogTime } from "../utils/processLogTime";

const NEXT_VISIBLE = 3;

function formatSyncTime(ts: number): string {
  if (!ts) return "never";
  return formatProcessLogTime(new Date(ts));
}

function useElapsedMs(startedAt?: string, active = false): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !startedAt) {
      setElapsedMs(null);
      return;
    }
    const start = Date.parse(startedAt);
    const tick = () => setElapsedMs(Math.max(0, Date.now() - start));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);

  return elapsedMs;
}

interface QueueTiming {
  avgDurationMs: number | null;
  totalDurationMs: number;
  etaMs: number | null;
  finishedCount: number;
}

interface Props {
  queue: TailorQueueItem[];
  pendingCount: number;
  doneInQueue: number;
  failedInQueue: number;
  totalInQueue: number;
  overallProgressPct: number;
  processLogs: TailorProcessLogEntry[];
  queueTiming: QueueTiming;
  processing: boolean;
  runningItem: TailorQueueItem | null;
  runningProgressPct?: number;
  runningLogs?: unknown[];
  lastFinishedLogs?: unknown[];
  lastFinishedLabel?: string;
  lastHourlySyncAt: number;
  syncMessage: string;
  onSyncNow: () => void;
  onProcessNow: () => void;
  onClearDone: () => void;
  onClearTailor: () => void;
  logsPanelCleared?: boolean;
  onBumpUrgent: (jobKey: string) => void;
  onRemoveFromQueue: (jobKey: string) => void;
  onReorderPending: (orderedKeys: string[]) => void;
  /** Live Feed shows hourly sync; manual page hides feed-only controls. */
  variant?: "feed" | "manual";
}

function lastFinishedEntry(logs: TailorProcessLogEntry[]) {
  return logs.find(
    (entry) => entry.durationMs != null && /^(Finished|Failed|Skipped)/.test(entry.message),
  ) ?? null;
}

export default function TailorQueueBar({
  queue,
  pendingCount,
  doneInQueue,
  failedInQueue,
  processLogs,
  queueTiming,
  processing,
  runningItem,
  runningProgressPct,
  lastHourlySyncAt,
  syncMessage,
  onSyncNow,
  onProcessNow,
  onClearDone,
  onClearTailor,
  onBumpUrgent,
  onRemoveFromQueue,
  onReorderPending,
  variant = "feed",
}: Props) {
  const isManual = variant === "manual";
  const [manageOpen, setManageOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const prevPendingRef = useRef(pendingCount);

  useEffect(() => {
    if (pendingCount > prevPendingRef.current) setManageOpen(false);
    prevPendingRef.current = pendingCount;
  }, [pendingCount]);

  const pendingItems = useMemo(
    () => queue.filter((item) => item.status === "pending"),
    [queue],
  );

  const lastDone = useMemo(() => lastFinishedEntry(processLogs), [processLogs]);

  const runningElapsedMs = useElapsedMs(runningItem?.startedAt, processing && Boolean(runningItem));
  const jobProgress = Math.min(100, Math.max(0, runningProgressPct ?? (processing ? 12 : 0)));
  const showRunning = processing && Boolean(runningItem);
  const showLastDone = !showRunning && lastDone != null;
  const nextItems = pendingItems.slice(0, NEXT_VISIBLE);
  const moreCount = Math.max(0, pendingItems.length - NEXT_VISIBLE);

  const queueEta = queueTiming.etaMs != null && pendingCount > 0
    ? formatTailorDuration(queueTiming.etaMs)
    : null;

  function handleDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      return;
    }
    const keys = pendingItems.map((item) => item.jobKey);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) {
      setDragKey(null);
      return;
    }
    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    onReorderPending(next);
    setDragKey(null);
  }

  const lastDoneLabel = lastDone
    ? lastDone.message.replace(/^(Finished|Failed|Skipped)\s+/, "")
    : "";
  const lastDoneTone = lastDone?.outcome === "done" || lastDone?.message.startsWith("Finished")
    ? "done"
    : lastDone?.outcome === "skip" || lastDone?.message.startsWith("Skipped")
      ? "skip"
      : "fail";

  const manualStatusLine = useMemo(() => {
    if (syncMessage) return syncMessage;
    if (showRunning && runningItem) {
      return `Tailoring ${runningItem.company} · ${runningItem.title} · ${jobProgress}%`;
    }
    if (showLastDone && lastDone) return lastDoneLabel;
    if (processing) return "Processing…";
    if (pendingCount > 0) return `${pendingCount} job${pendingCount === 1 ? "" : "s"} waiting`;
    return "";
  }, [syncMessage, showRunning, runningItem, jobProgress, showLastDone, lastDone, lastDoneLabel, processing, pendingCount]);

  return (
    <div className={`tq-panel${isManual ? " tq-panel--manual" : ""}`} aria-label="Tailor queue">
      <header className="tq-header">
        <div className="tq-header-copy">
          <span className="tq-kicker">Tailor queue</span>
          <span className="tq-meta">
            {pendingCount} waiting
            {doneInQueue > 0 ? ` · ${doneInQueue} done` : ""}
            {failedInQueue > 0 ? ` · ${failedInQueue} skipped` : ""}
            {!isManual ? (
              <>
                <span className="tq-meta-dot" aria-hidden>·</span>
                sync {formatSyncTime(lastHourlySyncAt)}
                <span className="tq-meta-dot" aria-hidden>·</span>
                top {HOURLY_QUEUE_SIZE}/hr
              </>
            ) : null}
          </span>
        </div>
        <div className={`tq-header-actions${isManual ? " tq-header-actions--manual" : ""}`}>
          {!isManual && pendingCount > 0 ? (
            <button
              type="button"
              className="tq-btn tq-btn--ghost"
              onClick={() => setManageOpen((v) => !v)}
            >
              {manageOpen ? "Done" : "Reorder"}
            </button>
          ) : null}
          {!isManual ? (
            <button type="button" className="tq-btn tq-btn--ghost" onClick={onSyncNow}>
              Sync
            </button>
          ) : null}
          <button
            type="button"
            className="tq-btn tq-btn--primary"
            onClick={onProcessNow}
            disabled={processing || pendingCount === 0}
          >
            {processing ? "Running…" : "Process"}
          </button>
          {isManual || doneInQueue > 0 ? (
            <button
              type="button"
              className={`tq-btn tq-btn--ghost${isManual && doneInQueue === 0 ? " tq-btn--hidden" : ""}`}
              onClick={onClearDone}
              disabled={doneInQueue === 0}
              aria-hidden={isManual && doneInQueue === 0}
              tabIndex={isManual && doneInQueue === 0 ? -1 : 0}
            >
              Clear
            </button>
          ) : null}
          <button type="button" className="tq-btn tq-btn--ghost" onClick={onClearTailor}>
            Reset
          </button>
        </div>
      </header>

      {isManual ? (
        <div
          className={`tq-status-slot tq-status-slot--manual${showLastDone && lastDone ? ` tq-status-slot--${lastDoneTone}` : showRunning ? " tq-status-slot--running" : ""}`}
          aria-live="polite"
        >
          <span className="tq-status-slot-text">{manualStatusLine || "\u00a0"}</span>
        </div>
      ) : (
        <>
      {syncMessage ? <p className="tq-sync-msg">{syncMessage}</p> : null}

      {showRunning && runningItem ? (
        <section className="tq-now" aria-live="polite">
          <div className="tq-now-head">
            <span className="tq-live-pill">
              <span className="tq-live-dot" aria-hidden />
              Now tailoring
            </span>
            {runningElapsedMs != null ? (
              <span className="tq-now-elapsed">{formatTailorDuration(runningElapsedMs, true)}</span>
            ) : null}
          </div>
          <div className="tq-now-job">
            <span className="tq-now-company">{runningItem.company}</span>
            <span className="tq-now-title">{runningItem.title}</span>
          </div>
          <div className="tq-progress-wrap">
            <div className="tq-progress-track" aria-hidden>
              <span
                className="tq-progress-fill is-live"
                style={{ width: `${jobProgress}%` }}
              />
            </div>
            <div className="tq-progress-labels">
              <span className="tq-progress-pct">{jobProgress}%</span>
              {queueEta ? <span className="tq-progress-eta">~{queueEta} for queue</span> : null}
            </div>
          </div>
        </section>
      ) : showLastDone && lastDone ? (
        <section className={`tq-finished tq-finished--${lastDoneTone}`} aria-live="polite">
          <span className="tq-finished-icon" aria-hidden>
            {lastDoneTone === "done" ? "✓" : lastDoneTone === "skip" ? "–" : "!"}
          </span>
          <span className="tq-finished-copy">{lastDoneLabel}</span>
          <span className="tq-finished-time">{formatTailorDuration(lastDone.durationMs ?? 0)}</span>
        </section>
      ) : pendingCount === 0 && !processing ? (
        <p className="tq-idle">
          {isManual
            ? "Queue is idle. Paste a job description below to add one."
            : "No jobs queued. Select roles to tailor or wait for the hourly batch."}
        </p>
      ) : null}

      {pendingItems.length > 0 && !manageOpen ? (
        <section className="tq-next">
          <h3 className="tq-next-label">Up next</h3>
          <ol className="tq-next-list">
            {nextItems.map((item, index) => (
              <li key={item.jobKey} className="tq-next-item">
                <span className="tq-next-rank">{index + 1}</span>
                <span className="tq-next-copy">
                  <strong>{item.company}</strong>
                  <span>{item.title}</span>
                </span>
                <span className="tq-next-score">{item.score}</span>
              </li>
            ))}
          </ol>
          {moreCount > 0 ? (
            <p className="tq-next-more">+{moreCount} more in queue</p>
          ) : null}
        </section>
      ) : null}

      {manageOpen && pendingItems.length > 0 ? (
        <ul className="tq-manage-list">
          {pendingItems.map((item, index) => (
            <li
              key={item.jobKey}
              className={`tq-manage-item${dragKey === item.jobKey ? " is-dragging" : ""}`}
              draggable
              onDragStart={() => setDragKey(item.jobKey)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.jobKey)}
            >
              <span className="tq-manage-drag" aria-hidden title="Drag to reorder">⋮⋮</span>
              <span className="tq-manage-rank">{index + 1}</span>
              <span className="tq-manage-copy">
                <strong>{item.company}</strong>
                <span>{item.title}</span>
              </span>
              <span className="tq-manage-score">{item.score}</span>
              <div className="tq-manage-actions">
                <button type="button" className="tq-manage-btn" onClick={() => onBumpUrgent(item.jobKey)}>
                  Top
                </button>
                <button type="button" className="tq-manage-btn" onClick={() => onRemoveFromQueue(item.jobKey)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
        </>
      )}
    </div>
  );
}
