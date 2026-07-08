import { useState } from "react";
import type { TailorQueueItem } from "../types/tailorQueue";
import type { TailorRecord } from "../types/tailorQueue";
import { formatTailorDuration, tailorFolderPath } from "../utils/tailorProgress";
import { formatTailorLogsForCopy } from "../utils/tailorLogCapture";
import type { ManualTailorSession } from "../utils/manualJob";
import { tailorCellDisplay } from "../utils/tailorOutcome";
import type { ApplyMetadata, ApplyRecord, TrackerStatus } from "../hooks/useApplyTracker";
import TailorExplainPanel from "./TailorExplainPanel";
import TrackerAddForm from "./TrackerAddForm";

interface Props {
  session: ManualTailorSession;
  record: TailorRecord | null;
  queueItem: TailorQueueItem | null;
  queuePosition: number | null;
  onOpenFolder?: (path: string) => void;
  onRetry?: () => void;
  stuckQueued?: boolean;
  trackerRecord?: ApplyRecord | null;
  onAddToTracker?: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onSetTrackerStatus?: (jobUrl: string, status: TrackerStatus) => void;
  onSetTrackerNotes?: (jobUrl: string, notes: string) => void;
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
  trackerRecord,
  onAddToTracker,
  onSetTrackerStatus,
  onSetTrackerNotes,
}: Props) {
  const [trackerOpen, setTrackerOpen] = useState(false);
  const logs = record?.logs ?? [];
  const folderPath = tailorFolderPath(record);
  const tone = statusTone(record, queueItem);
  const label = statusLabel(record, queueItem, queuePosition);
  const isLive = record?.status === "running" || queueItem?.status === "running";
  const isDone = record?.status === "done";

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

      {(record?.durationMs != null || record?.explain || (record?.status === "failed" && record.outcome === "unsupported" && record.error)) && (
        <div className="manual-tailor-assistant-body">
          {record?.durationMs != null ? (
            <p className="manual-tailor-assistant-meta">
              Completed in {formatTailorDuration(record.durationMs)}
            </p>
          ) : null}

          {record?.explain ? (
            <TailorExplainPanel explain={record.explain} />
          ) : null}

          {record?.status === "failed" && record.outcome === "unsupported" && record.error ? (
            <p className="tailor-explain-banner tailor-explain-banner--blocked" role="status">
              {record.error}
            </p>
          ) : null}
        </div>
      )}

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
          {isDone ? (
            <button type="button" className="manual-tailor-foot-btn manual-tailor-foot-btn--ghost" onClick={copyLogs}>
              Copy log
            </button>
          ) : null}
          {isDone && onAddToTracker ? (
            <button
              type="button"
              className="manual-tailor-foot-btn manual-tailor-foot-btn--ghost"
              onClick={() => setTrackerOpen((v) => !v)}
            >
              {trackerRecord ? "Edit tracker entry" : "Add to tracker"}
            </button>
          ) : null}
        </div>
      </footer>

      {isDone && trackerOpen && onAddToTracker && onSetTrackerStatus && onSetTrackerNotes ? (
        <TrackerAddForm
          jobUrl={session.jobKey}
          defaultCompany={session.company}
          defaultTitle={session.title}
          trackerRecord={trackerRecord ?? null}
          onAddToTracker={onAddToTracker}
          onSetTrackerStatus={onSetTrackerStatus}
          onSetTrackerNotes={onSetTrackerNotes}
          onClose={() => setTrackerOpen(false)}
        />
      ) : null}
    </article>
  );
}
