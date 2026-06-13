import { useMemo, useState } from "react";
import type { TailorQueueItem } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE } from "../types/tailorQueue";

function formatSyncTime(ts: number): string {
  if (!ts) return "Never";
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

interface Props {
  queue: TailorQueueItem[];
  pendingCount: number;
  doneInQueue: number;
  processing: boolean;
  runningItem: TailorQueueItem | null;
  lastHourlySyncAt: number;
  syncMessage: string;
  onSyncNow: () => void;
  onProcessNow: () => void;
  onClearDone: () => void;
  onBumpUrgent: (jobKey: string) => void;
  onRemoveFromQueue: (jobKey: string) => void;
  onReorderPending: (orderedKeys: string[]) => void;
}

export default function TailorQueueBar({
  queue,
  pendingCount,
  doneInQueue,
  processing,
  runningItem,
  lastHourlySyncAt,
  syncMessage,
  onSyncNow,
  onProcessNow,
  onClearDone,
  onBumpUrgent,
  onRemoveFromQueue,
  onReorderPending,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const pendingItems = useMemo(
    () => queue.filter((item) => item.status === "pending"),
    [queue],
  );

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
          {processing && runningItem ? (
            <div className="tailor-queue-running">
              Tailoring <strong>{runningItem.company}</strong> · {runningItem.title}
            </div>
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
        </div>
      </div>

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
