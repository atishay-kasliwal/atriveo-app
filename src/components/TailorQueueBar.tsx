import { useEffect, useMemo, useRef, useState } from "react";
import type { TailorLogEntry } from "../types/tailor";
import type { TailorOutcomeKind, TailorProcessLogEntry, TailorQueueItem } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE } from "../types/tailorQueue";
import TailorLogStream from "./TailorLogStream";
import { formatTailorDuration } from "../utils/tailorProgress";
import { displayProcessLogAt, formatProcessLogTime } from "../utils/processLogTime";

function formatSyncTime(ts: number): string {
  if (!ts) return "Never";
  return formatProcessLogTime(new Date(ts));
}

// Honest, glanceable classification for a finished job line. "Failed" is
// reserved for things that are genuinely broken and need YOU; retryable/expected
// states (no JD yet, skipped, offline) get their own tone + a "what's happening"
// note so the panel never lies about the pipeline state.
type FinishedTone = "done" | "skip" | "retry" | "fail";
interface FinishedDisplay { tone: FinishedTone; icon: string; note: string; }

function classifyFinished(entry: TailorProcessLogEntry): FinishedDisplay {
  const outcome: TailorOutcomeKind | undefined = entry.outcome;
  // Prefer the explicit outcome; fall back to the message prefix for old entries.
  if (outcome === "done" || (!outcome && entry.message.startsWith("Finished"))) {
    return { tone: "done", icon: "✓", note: "" };
  }
  switch (outcome) {
    case "skip":
      return { tone: "skip", icon: "⏭", note: "Skipped — not worth tailoring" };
    case "missing":
      return { tone: "skip", icon: "⏭", note: "Job left the feed" };
    case "no-jd":
      return { tone: "retry", icon: "⏳", note: "No full JD yet — auto-retries after the next hourly scrape" };
    case "no-resume":
      return { tone: "retry", icon: "⏳", note: "Save your resume in Settings, then retry" };
    case "offline":
      return { tone: "retry", icon: "⏳", note: "Tailor server/relay offline — will resume when reachable" };
    case "timeout":
      return { tone: "retry", icon: "⏳", note: "Connection dropped — auto-recovers if the PDF was made" };
    case "compile":
      return { tone: "fail", icon: "✗", note: "PDF compile failed (LaTeX) — needs a look" };
    case "ai":
      return { tone: "fail", icon: "✗", note: "Model step failed (Ollama)" };
    default:
      return { tone: "fail", icon: "✗", note: "Failed — check the queue log" };
  }
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
  runningLogs?: TailorLogEntry[];
  lastFinishedLogs?: TailorLogEntry[];
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
}

export default function TailorQueueBar({
  queue,
  pendingCount,
  doneInQueue,
  failedInQueue,
  totalInQueue,
  overallProgressPct,
  processLogs,
  queueTiming,
  processing,
  runningItem,
  runningLogs = [],
  lastFinishedLogs = [],
  lastFinishedLabel,
  lastHourlySyncAt,
  syncMessage,
  onSyncNow,
  onProcessNow,
  onClearDone,
  onClearTailor,
  logsPanelCleared = false,
  onBumpUrgent,
  onRemoveFromQueue,
  onReorderPending,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [streamOpen, setStreamOpen] = useState(true);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const prevPendingRef = useRef(pendingCount);

  useEffect(() => {
    if (pendingCount > prevPendingRef.current) {
      setExpanded(true);
    }
    prevPendingRef.current = pendingCount;
  }, [pendingCount]);

  const pendingItems = useMemo(
    () => queue.filter((item) => item.status === "pending"),
    [queue],
  );

  const recentFinished = useMemo(
    () => processLogs
      .filter((entry) => entry.durationMs != null && /^(Finished|Failed|Skipped)/.test(entry.message))
      .slice(0, 5),
    [processLogs],
  );

  const finishedCount = doneInQueue + failedInQueue;
  const showProgress = totalInQueue > 0 && (processing || finishedCount > 0 || pendingCount > 0);
  const runningElapsedMs = useElapsedMs(runningItem?.startedAt, processing && Boolean(runningItem));
  const showProcessStream = !logsPanelCleared
    && (processing || runningLogs.length > 0 || lastFinishedLogs.length > 0);
  const showClearTailor = !logsPanelCleared && (
    processing || processLogs.length > 0 || totalInQueue > 0 || showProcessStream
  );
  const streamLogs = processing ? runningLogs : lastFinishedLogs;
  const streamLive = processing && Boolean(runningItem);
  const streamTitle = streamLive
    ? `Live · ${runningItem?.company ?? "Tailoring"}`
    : lastFinishedLabel ?? "Last job";
  const streamEmptyLabel = streamLive
    ? "Connected — waiting for analyze / compile steps from your Mac…"
    : "No detailed step log saved for the last job.";

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

  const timingMeta = [
    queueTiming.totalDurationMs > 0
      ? `${formatTailorDuration(queueTiming.totalDurationMs)} spent`
      : null,
    queueTiming.avgDurationMs != null
      ? `avg ${formatTailorDuration(queueTiming.avgDurationMs)}`
      : null,
    queueTiming.etaMs != null && pendingCount + (runningItem ? 1 : 0) > 0
      ? `~${formatTailorDuration(queueTiming.etaMs)} left`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="tailor-queue-panel" aria-label="Tailor queue">
      <div className="tailor-queue-bar">
        <div className="tailor-queue-bar-main">
          <div className="tailor-queue-bar-stats">
            <span className="tailor-queue-stat">
              <strong>{pendingCount}</strong> queued
            </span>
            <span className="tailor-queue-stat">
              <strong>{doneInQueue}</strong> done
            </span>
            {failedInQueue > 0 ? (
              <span className="tailor-queue-stat tailor-queue-stat--failed">
                <strong>{failedInQueue}</strong> failed/skipped
              </span>
            ) : null}
            {showProgress ? (
              <span className="tailor-queue-stat tailor-queue-stat--progress">
                <strong>{overallProgressPct}%</strong> complete
                <span className="tailor-queue-stat-sub">
                  {finishedCount + (runningItem ? 1 : 0)}/{totalInQueue}
                </span>
              </span>
            ) : null}
            {timingMeta ? (
              <span className="tailor-queue-stat tailor-queue-stat--timing">
                {timingMeta}
              </span>
            ) : null}
            <span className="tailor-queue-stat tailor-queue-stat--muted">
              Hourly batch: top {HOURLY_QUEUE_SIZE} by score
            </span>
            <span className="tailor-queue-stat tailor-queue-stat--muted">
              Last sync {formatSyncTime(lastHourlySyncAt)}
            </span>
            {pendingCount > 0 ? (
              <button
                type="button"
                className="tailor-queue-expand"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Hide queue" : "Reorder queue"}
              </button>
            ) : null}
          </div>

          {showProgress ? (
            <div className="tailor-queue-progress" aria-label="Queue progress">
              <div className="tailor-queue-progress-track">
                <span style={{ width: `${overallProgressPct}%` }} />
              </div>
              <div className="tailor-queue-progress-meta">
                <span>{overallProgressPct}% done</span>
                <span>
                  {finishedCount} finished · {pendingCount} waiting
                  {runningItem ? " · 1 running" : ""}
                </span>
              </div>
            </div>
          ) : null}

          {processing && runningItem ? (
            <div className="tailor-queue-running">
              Tailoring <strong>{runningItem.company}</strong> · {runningItem.title}
              {runningElapsedMs != null ? (
                <span className="tailor-queue-running-time">
                  {formatTailorDuration(runningElapsedMs, true)} elapsed
                </span>
              ) : null}
            </div>
          ) : null}

          {recentFinished.length > 0 ? (
            <ul className="tailor-queue-recent">
              {recentFinished.map((entry) => {
                const d = classifyFinished(entry);
                // Strip the redundant "Finished/Failed/Skipped " prefix — the
                // icon + note already convey state, so show just company · detail.
                const label = entry.message.replace(/^(Finished|Failed|Skipped)\s+/, "");
                return (
                  <li
                    key={entry.id}
                    className={`tailor-queue-recent-item tailor-queue-recent-item--${d.tone}`}
                  >
                    <span className="tailor-queue-recent-icon" aria-hidden>{d.icon}</span>
                    <span className="tailor-queue-recent-main">
                      <span className="tailor-queue-recent-label">{label}</span>
                      {d.note ? <span className="tailor-queue-recent-note">{d.note}</span> : null}
                    </span>
                    <span className="tailor-queue-recent-time">
                      {formatTailorDuration(entry.durationMs ?? 0)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {syncMessage ? <div className="tailor-queue-message">{syncMessage}</div> : null}
        </div>
        <div className="tailor-queue-bar-actions">
          <button type="button" className="tailor-queue-btn" onClick={onSyncNow}>
            Sync now
          </button>
          <button
            type="button"
            className="tailor-queue-btn tailor-queue-btn--primary"
            onClick={onProcessNow}
            disabled={processing || pendingCount === 0}
          >
            {processing ? "Processing…" : "Process queue"}
          </button>
          {doneInQueue > 0 ? (
            <button type="button" className="tailor-queue-btn tailor-queue-btn--ghost" onClick={onClearDone}>
              Clear done
            </button>
          ) : null}
          {showClearTailor ? (
            <button type="button" className="tailor-queue-btn tailor-queue-btn--ghost" onClick={onClearTailor}>
              Clear tailor
            </button>
          ) : null}
        </div>
      </div>

      {!logsPanelCleared && processLogs.length > 0 ? (
        <div className={`tailor-queue-logs${logsOpen ? " is-open" : ""}`}>
          <button type="button" className="tailor-queue-logs-toggle" onClick={() => setLogsOpen((v) => !v)}>
            {logsOpen ? "▾" : "▸"} Queue log · {processLogs.length} lines
          </button>
          {logsOpen ? (
            <div className="tailor-queue-logs-body">
              {processLogs.map((entry) => (
                <div key={entry.id} className="tailor-queue-log-line">
                  <span className="tailor-queue-log-at">{displayProcessLogAt(entry.at)}</span>
                  <span className="tailor-queue-log-msg">{entry.message}</span>
                  {entry.durationMs != null ? (
                    <span className="tailor-queue-log-duration">
                      {formatTailorDuration(entry.durationMs)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showProcessStream ? (
        <div className={`tailor-queue-stream${streamOpen ? " is-open" : ""}`}>
          <button type="button" className="tailor-queue-logs-toggle" onClick={() => setStreamOpen((v) => !v)}>
            {streamOpen ? "▾" : "▸"} Process log · {streamTitle}
            {streamLogs.length > 0 ? ` · ${streamLogs.length} lines` : ""}
            {streamLive ? <span className="tailor-queue-stream-live">Live</span> : null}
          </button>
          {streamOpen ? (
            <div className="tailor-queue-stream-body">
              <TailorLogStream
                logs={streamLogs}
                live={streamLive}
                emptyLabel={streamEmptyLabel}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && pendingItems.length > 0 ? (
        <ul className="tailor-queue-list">
          {pendingItems.map((item, index) => (
            <li
              key={item.jobKey}
              className={`tailor-queue-item${dragKey === item.jobKey ? " is-dragging" : ""}`}
              draggable
              onDragStart={() => setDragKey(item.jobKey)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.jobKey)}
            >
              <span className="tailor-queue-drag" aria-hidden title="Drag to reorder">⋮⋮</span>
              <span className="tailor-queue-rank">{index + 1}</span>
              <span className="tailor-queue-score">{item.score}</span>
              <span className="tailor-queue-copy">
                <strong>{item.company}</strong>
                <span>{item.title}</span>
              </span>
              <span className={`tailor-queue-source tailor-queue-source--${item.source}`}>
                {item.source === "manual" ? "Urgent" : "Hourly"}
              </span>
              <div className="tailor-queue-item-actions">
                <button type="button" className="tailor-queue-mini-btn" onClick={() => onBumpUrgent(item.jobKey)}>
                  Top
                </button>
                <button type="button" className="tailor-queue-mini-btn tailor-queue-mini-btn--ghost" onClick={() => onRemoveFromQueue(item.jobKey)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
