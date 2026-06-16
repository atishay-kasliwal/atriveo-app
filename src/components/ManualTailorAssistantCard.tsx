import { useEffect, useRef } from "react";
import type { TailorQueueItem } from "../types/tailorQueue";
import type { TailorRecord } from "../types/tailorQueue";
import { formatTailorDuration, tailorFolderPath } from "../utils/tailorProgress";
import {
  fmtTailorLogElapsed,
  fmtTailorLogTime,
  formatTailorLogsForCopy,
  TAILOR_LOG_MARKER,
} from "../utils/tailorLogCapture";
import type { ManualTailorSession } from "../utils/manualJob";
import { tailorCellDisplay } from "../utils/tailorOutcome";
import TailorExplainPanel from "./TailorExplainPanel";

interface Props {
  session: ManualTailorSession;
  record: TailorRecord | null;
  queueItem: TailorQueueItem | null;
  queuePosition: number | null;
  onOpenFolder?: (path: string) => void;
  onRetry?: () => void;
  stuckQueued?: boolean;
}

function statusLabel(record: TailorRecord | null, queueItem: TailorQueueItem | null, queuePosition: number | null): string {
  if (record) {
    const cell = tailorCellDisplay(record);
    if (record.status === "running") return `${cell.label} · tailoring`;
    if (record.status === "done") {
      if (record.borderline || record.outcome === "borderline") {
        return record.ats ? `Done · ATS ${record.ats} · borderline JD` : "Done · borderline JD warning";
      }
      return record.ats ? `Done · ATS ${record.ats}` : "Done · PDF ready";
    }
    if (record.status === "failed" || record.status === "no-go") return cell.tooltip;
  }
  if (record?.status === "queued" || queueItem?.status === "pending") {
    return queuePosition != null ? `Queued · #${queuePosition} in line` : "Queued";
  }
  if (queueItem?.status === "running") return "Running…";
  if (queueItem?.status === "done") return "Finished in queue";
  if (queueItem?.status === "failed") return queueItem.error || "Error";
  return "Waiting for queue";
}

function statusTone(record: TailorRecord | null, queueItem: TailorQueueItem | null): string {
  if (record && record.status !== "none") return tailorCellDisplay(record).tone;
  if (queueItem?.status === "running") return "running";
  if (queueItem?.status === "failed") return "error";
  return "queued";
}

export default function ManualTailorAssistantCard({
  session,
  record,
  queueItem,
  queuePosition,
  onOpenFolder,
  onRetry,
  stuckQueued = false,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const logs = record?.logs ?? [];
  const folderPath = tailorFolderPath(record);
  const tone = statusTone(record, queueItem);
  const label = statusLabel(record, queueItem, queuePosition);
  const isLive = record?.status === "running" || queueItem?.status === "running";

  useEffect(() => {
    if (!isLive || !streamRef.current) return;
    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [logs.length, isLive]);

  const copyLogs = () => {
    const header = `${session.company} · ${session.title}\n${label}\n`;
    const body = logs.length ? formatTailorLogsForCopy(logs) : session.jdPreview;
    navigator.clipboard.writeText(`${header}\n${body}`).catch(() => {});
  };

  return (
    <article className={`manual-tailor-assistant manual-tailor-assistant--${tone}`}>
      <header className="manual-tailor-assistant-head">
        <div>
          <strong>{session.company}</strong>
          <span>{session.title}</span>
        </div>
        <span className={`manual-tailor-assistant-status manual-tailor-assistant-status--${tone}`}>
          {isLive ? <span className="manual-tailor-live-dot" aria-hidden /> : null}
          {label}
        </span>
      </header>

      <div className="manual-tailor-assistant-body">
        {record?.durationMs != null ? (
          <p className="manual-tailor-assistant-meta">
            Completed in {formatTailorDuration(record.durationMs)}
          </p>
        ) : (
          <p className="manual-tailor-assistant-meta manual-tailor-assistant-meta--spacer" aria-hidden>
            &nbsp;
          </p>
        )}

        {record?.explain ? (
          <TailorExplainPanel explain={record.explain} />
        ) : null}

        {record?.status === "failed" && record.outcome === "unsupported" && record.error ? (
          <p className="tailor-explain-banner tailor-explain-banner--blocked" role="status">
            {record.error}
          </p>
        ) : null}

        <div
          ref={streamRef}
          className={`manual-tailor-assistant-stream tailor-thought-stream${logs.length > 0 ? " has-logs" : ""}`}
        >
          {logs.length > 0 ? (
            logs.map((entry) => (
              <div key={entry.id} className={`tailor-thought-line is-${entry.kind}`}>
                <span className="tailor-thought-meta">
                  <time dateTime={entry.at}>{fmtTailorLogTime(entry.at)}</time>
                  {entry.step != null ? <span className="tailor-thought-step">#{entry.step}</span> : null}
                  {entry.elapsedMs != null ? (
                    <span className="tailor-thought-elapsed">{fmtTailorLogElapsed(entry.elapsedMs)}</span>
                  ) : null}
                </span>
                <span className="tailor-thought-marker" aria-hidden="true">
                  {TAILOR_LOG_MARKER[entry.kind]}
                </span>
                <span className="tailor-thought-text">{entry.text}</span>
              </div>
            ))
          ) : (
            <p className="manual-tailor-assistant-placeholder">
              {stuckQueued
                ? "Queued in the app but not sent to the Mac yet. Click Send to Mac below."
                : isLive
                  ? "Tailor is running — logs will stream here as phases complete."
                  : record?.status === "queued" || queueItem?.status === "pending"
                    ? "Added to the shared tailor queue. Processing starts automatically when earlier jobs finish."
                    : "Submit a job description to start tailoring."}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="manual-tailor-assistant-foot">
        <div className="manual-tailor-assistant-foot-actions">
          {onRetry ? (
            <button type="button" className="manual-tailor-foot-btn manual-tailor-foot-btn--primary" onClick={onRetry}>
              Send to Mac
            </button>
          ) : null}
          {folderPath && onOpenFolder ? (
            <button type="button" className="manual-tailor-foot-btn" onClick={() => onOpenFolder(folderPath)}>
              Open folder
            </button>
          ) : null}
          {(logs.length > 0 || record?.status === "done") ? (
            <button type="button" className="manual-tailor-foot-btn manual-tailor-foot-btn--ghost" onClick={copyLogs}>
              Copy log
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
