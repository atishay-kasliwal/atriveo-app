import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { TailorRecord } from "../types/tailorQueue";
import { formatTailorDuration } from "../utils/tailorProgress";
import TrustReportPanel from "./TrustReportPanel";
import {
  fmtTailorLogElapsed,
  fmtTailorLogTime,
  formatTailorLogsForCopy,
  TAILOR_LOG_MARKER,
} from "../utils/tailorLogCapture";

interface Props {
  record: TailorRecord;
  onClose: () => void;
}

function buildSummaryLines(record: TailorRecord): string[] {
  const lines: string[] = [];
  if (record.ats) lines.push(`ATS match: ${record.ats}`);
  if (record.tailoredAt) {
    lines.push(`Finished: ${new Date(record.tailoredAt).toLocaleString()}`);
  }
  if (record.durationMs != null) {
    lines.push(`Duration: ${formatTailorDuration(record.durationMs)}`);
  }
  if (record.folder || record.dir) {
    lines.push(`Output: ${record.folder || record.dir}`);
  }
  if (record.error) lines.push(`Note: ${record.error}`);
  return lines;
}

export default function TailorJobLogModal({ record, onClose }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const logs = record.logs ?? [];
  const summary = buildSummaryLines(record);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  const copyLogs = () => {
    const header = `${record.company} · ${record.title}\n${summary.join("\n")}\n`;
    const body = logs.length ? formatTailorLogsForCopy(logs) : "(No step log saved for this run)";
    navigator.clipboard.writeText(`${header}\n${body}`).catch(() => {});
  };

  return createPortal(
    <div className="tailor-log-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="tailor-log-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Tailor log for ${record.company}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tailor-log-modal-head">
          <div>
            <p className="tailor-log-modal-kicker">Tailor log</p>
            <h3>{record.company}</h3>
            <p className="tailor-log-modal-sub">{record.title}</p>
          </div>
          <div className="tailor-log-modal-head-actions">
            <button type="button" className="tailor-log-modal-btn" onClick={copyLogs}>
              Copy
            </button>
            <button type="button" className="tailor-log-modal-btn tailor-log-modal-btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {summary.length > 0 ? (
          <ul className="tailor-log-modal-summary">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        {record.explain || record.dir || record.folder ? (
          <TrustReportPanel explain={record.explain} dir={record.dir || record.folder} compact />
        ) : (
          <p className="tailor-log-modal-empty">Trust report loads after compile artifacts are on disk.</p>
        )}

        {record.status === "failed" && record.outcome === "unsupported" && record.error ? (
          <p className="tailor-explain-banner tailor-explain-banner--blocked" role="status">
            {record.error}
          </p>
        ) : null}

        {logs.length > 0 ? (
          <div className="tailor-log-modal-stream tailor-thought-stream" aria-label="Tailor step log">
            {logs.map((entry) => (
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
            ))}
            <div ref={endRef} />
          </div>
        ) : (
          <p className="tailor-log-modal-empty">
            No detailed step log was saved for this run. Future tailored jobs will include full logs here.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
