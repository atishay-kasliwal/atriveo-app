import type { TailorQueueItem } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE } from "../types/tailorQueue";

function formatSyncTime(ts: number): string {
  if (!ts) return "Never";
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

interface Props {
  pendingCount: number;
  doneInQueue: number;
  processing: boolean;
  runningItem: TailorQueueItem | null;
  lastHourlySyncAt: number;
  syncMessage: string;
  onSyncNow: () => void;
  onProcessNow: () => void;
  onClearDone: () => void;
}

export default function TailorQueueBar({
  pendingCount,
  doneInQueue,
  processing,
  runningItem,
  lastHourlySyncAt,
  syncMessage,
  onSyncNow,
  onProcessNow,
  onClearDone,
}: Props) {
  return (
    <div className="tailor-queue-bar" aria-label="Tailor queue">
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
  );
}
