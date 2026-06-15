import type { ApplyClickRecord, SavedJobSource } from "../hooks/useApplyClickLog";
import type { ApplyRecord, OfferStatus } from "../hooks/useApplyTracker";
import JobPipelineTimeline from "./JobPipelineTimeline";
import { jobBoardLabel } from "../utils/jobPresentation";
import type { TailoredResumeOnDisk } from "../utils/tailorRun";

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

function formatRunTime(iso?: string | null): string {
  if (!iso) return "—";
  const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sourceLabel(source: SavedJobSource): string {
  switch (source) {
    case "apply": return "Apply";
    case "add": return "Add";
    default: return "Click";
  }
}

interface Props {
  records: ApplyClickRecord[];
  getRecord: (jobUrl: string) => ApplyRecord | null;
  getCompiled?: (jobUrl: string) => TailoredResumeOnDisk | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: { location: string | null }) => void;
  onUpdatePipeline?: (jobUrl: string, patch: { interviewAt?: string | null; offerStatus?: OfferStatus }) => void;
  onRestore?: (jobKey: string) => void;
  emptyMessage?: string;
}

export default function ClickedJobsTable({
  records,
  getRecord,
  getCompiled,
  onAddToTracker,
  onUpdatePipeline,
  onRestore,
  emptyMessage = "No saved jobs yet. Use Apply, Click, or Add on the live feed to send a posting here.",
}: Props) {
  if (records.length === 0) {
    return <div className="clicked-jobs-empty">{emptyMessage}</div>;
  }

  return (
    <div className="clicked-jobs-table-wrap">
      <table className="clicked-jobs-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Saved</th>
            <th>Pipeline</th>
            <th>Via</th>
            <th>Score</th>
            <th>Company</th>
            <th>Role</th>
            <th>Level</th>
            <th>Location</th>
            <th>Board</th>
            <th>Tracker</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            const trackerRecord = getRecord(record.jobUrl);
            const compiled = getCompiled?.(record.jobUrl) ?? null;
            const trackerStatus = trackerRecord?.trackerSyncStatus ?? null;
            const isSynced = trackerStatus === "synced" || trackerStatus === "duplicate";
            const isSending = trackerStatus === "pending";
            const isRetryable = trackerStatus === "error" || trackerStatus === "not_configured" || trackerStatus === "skipped";
            const trackerCopy = isSending
              ? "Sending…"
              : isSynced
                ? "Synced"
                : isRetryable
                  ? "Retry"
                  : trackerRecord
                    ? "Sync"
                    : "Tracker +";
            const trackerTone = isSending
              ? " pending"
              : isSynced
                ? " synced"
                : isRetryable
                  ? " retry"
                  : "";

            return (
              <tr key={record.jobKey}>
                <td className="clicked-jobs-index">{index + 1}</td>
                <td>{formatRunTime(record.clickedAt)}</td>
                <td className="clicked-jobs-pipeline">
                  <JobPipelineTimeline
                    compiledAt={compiled?.tailoredAt}
                    appliedAt={trackerRecord?.lastAppliedAt}
                    interviewAt={trackerRecord?.interviewAt}
                    offerStatus={trackerRecord?.offerStatus ?? null}
                  />
                  {onUpdatePipeline && trackerRecord ? (
                    <div className="pipeline-stage-actions">
                      {!trackerRecord.interviewAt ? (
                        <button
                          type="button"
                          className="pipeline-stage-btn"
                          onClick={() => onUpdatePipeline(record.jobUrl, { interviewAt: new Date().toISOString() })}
                        >
                          + Interview
                        </button>
                      ) : null}
                      {!trackerRecord.offerStatus ? (
                        <button
                          type="button"
                          className="pipeline-stage-btn"
                          onClick={() => onUpdatePipeline(record.jobUrl, { offerStatus: "pending" })}
                        >
                          + Offer
                        </button>
                      ) : trackerRecord.offerStatus === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="pipeline-stage-btn pipeline-stage-btn--yes"
                            onClick={() => onUpdatePipeline(record.jobUrl, { offerStatus: "accepted" })}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="pipeline-stage-btn"
                            onClick={() => onUpdatePipeline(record.jobUrl, { offerStatus: "declined" })}
                          >
                            Decline
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td>{sourceLabel(record.source)}</td>
                <td>{record.score ?? "—"}</td>
                <td>{record.company}</td>
                <td className="clicked-jobs-role">{record.title}</td>
                <td>{record.level || "—"}</td>
                <td>{record.location || "—"}</td>
                <td>{jobBoardLabel(record.site, record.jobUrl)}</td>
                <td>
                  <button
                    type="button"
                    className={`clicked-jobs-tracker-btn${trackerTone}`}
                    disabled={isSending || isSynced}
                    title={trackerRecord?.trackerSyncMessage || "Add this job to Atriveo tracker"}
                    onClick={() => onAddToTracker(record.jobUrl, record.title, record.company, { location: record.location })}
                  >
                    {trackerCopy}
                  </button>
                </td>
                <td>
                  <div className="clicked-jobs-actions">
                    <a href={record.jobUrl} target="_blank" rel="noopener" className="clicked-jobs-link">
                      Open ↗
                    </a>
                    {onRestore && (
                      <button
                        type="button"
                        className="clicked-jobs-restore-btn"
                        onClick={() => onRestore(record.jobKey)}
                        title="Move back to the live feed"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
