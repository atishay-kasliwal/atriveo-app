import { useState } from "react";
import type { JobResumeView } from "../types/jobResumeView";
import type { ApplyRecord } from "../hooks/useApplyTracker";
import TailorJobLogModal from "./TailorJobLogModal";
import JobPipelineTimeline from "./JobPipelineTimeline";
import ExplainSummary from "./ExplainSummary";
import type { TailorRecord } from "../types/tailorQueue";

interface Props {
  view: JobResumeView;
  tailorRecord?: TailorRecord | null;
  applyRecord?: ApplyRecord | null;
  onOpenPdf?: () => void;
  onOpenFolder?: () => void;
  onGenerate?: () => void;
  compact?: boolean;
}

const TONE: Record<JobResumeView["status"], string> = {
  never: "muted",
  queued: "queued",
  compiling: "running",
  ready: "ready",
  borderline: "warn",
  unsupported: "muted",
  failed: "error",
  skipped: "skip",
  "no-jd": "warn",
};

export default function JobResumeCell({
  view,
  tailorRecord,
  applyRecord,
  onOpenPdf,
  onOpenFolder,
  onGenerate,
  compact = true,
}: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const tone = TONE[view.status];
  const canTrust = Boolean(tailorRecord?.explain || tailorRecord?.dir || tailorRecord?.folder);

  return (
    <div className={`job-resume-cell job-resume-cell--${tone}`}>
      <div className="job-resume-cell-main">
        <span className={`job-resume-status job-resume-status--${tone}`}>{view.statusLine}</span>
        {view.subLine ? <span className="job-resume-sub">{view.subLine}</span> : null}
      </div>
      {!compact && view.identityPrimary ? (
        <div className="job-resume-identity">{view.identityPrimary}</div>
      ) : null}
      {!compact && view.summaryBullets && view.summaryBullets.length > 0 ? (
        <ExplainSummary explain={view.explain} showDetails={false} />
      ) : null}
      {(view.status === "ready" || view.status === "borderline") && (view.compiledAt || applyRecord) ? (
        <div className="job-resume-pipeline">
          <JobPipelineTimeline
            compact
            compiledAt={view.compiledAt}
            appliedAt={applyRecord?.lastAppliedAt}
            interviewAt={applyRecord?.interviewAt}
            offerStatus={applyRecord?.offerStatus ?? null}
          />
        </div>
      ) : null}
      <div className="job-resume-actions">
        {view.status === "never" && onGenerate ? (
          <button type="button" className="job-resume-btn" onClick={(e) => { e.stopPropagation(); onGenerate(); }}>
            Generate
          </button>
        ) : null}
        {(view.status === "ready" || view.status === "borderline") && onOpenPdf && view.pdfPath ? (
          <button type="button" className="job-resume-btn job-resume-btn--primary" onClick={(e) => { e.stopPropagation(); onOpenPdf(); }}>
            PDF
          </button>
        ) : null}
        {onOpenFolder && view.folderPath ? (
          <button type="button" className="job-resume-btn" onClick={(e) => { e.stopPropagation(); onOpenFolder(); }}>
            Folder
          </button>
        ) : null}
        {canTrust && (tailorRecord?.status === "done" || tailorRecord?.status === "running" || tailorRecord?.explain) ? (
          <button type="button" className="job-resume-btn" onClick={(e) => { e.stopPropagation(); setLogOpen(true); }}>
            Trust
          </button>
        ) : null}
      </div>
      {logOpen && tailorRecord ? (
        <TailorJobLogModal record={tailorRecord} onClose={() => setLogOpen(false)} />
      ) : null}
    </div>
  );
}
