import { useEffect, useState } from "react";
import type { Job } from "../types";
import type { ApplyRecord } from "../hooks/useApplyTracker";
import type { TailorRecord } from "../types/tailorQueue";
import type { ApplyMetadata } from "../hooks/useApplyTracker";
import CompanyLogo from "./CompanyLogo";
import { careerOpsRating, careerOpsStars, matchReasons } from "../utils/jobPresentation";
import { extractComp } from "../utils/compExtract";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";
import { tailorCellLabel, tailorFolderPath } from "../utils/tailorProgress";

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

function fmtPosted(iso?: string | null): string {
  if (!iso || iso === "null") return "";
  const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Props {
  job: Job;
  tailorRecord: TailorRecord | null;
  applyRecord: ApplyRecord | null;
  onClose: () => void;
  onQueueUrgent?: (job: Job, resumeSlot: number) => void;
  onOpenTailorPath?: (path: string) => void;
  onDismissJob?: (job: Job) => void;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
}

export default function JobInspector({
  job,
  tailorRecord,
  applyRecord,
  onClose,
  onQueueUrgent,
  onOpenTailorPath,
  onDismissJob,
}: Props) {
  const [jdBody, setJdBody] = useState<string | null>(null);
  const [jdLoading, setJdLoading] = useState(true);
  const [jdCopied, setJdCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const careerOps = careerOpsRating(job);
  const stars = careerOpsStars(careerOps.score);
  const reasons = matchReasons(job, 3);
  const comp = extractComp(job.summary);
  const tailor = tailorCellLabel(tailorRecord);
  const folderPath = tailorFolderPath(tailorRecord);
  const isApplied = Boolean(applyRecord);
  const canQueueResume = Boolean(
    onQueueUrgent
    && job.job_url
    && (!tailorRecord || tailorRecord.status === "none" || tailorRecord.status === "failed"),
  );
  const postedAgo = fmtPosted(job.batch_time || job.date_posted);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setJdLoading(true);
    setJdBody(null);
    loadJobDescriptions([job]).then((map) => {
      const full = job.job_url ? map[job.job_url] : undefined;
      setJdBody(full?.trim() || job.summary?.trim() || null);
      setJdLoading(false);
    });
  }, [job]);

  function handleCopyJd() {
    const text = jdBody || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setJdCopied(true);
      setTimeout(() => setJdCopied(false), 1500);
    });
  }

  function handleDismiss() {
    if (!onDismissJob || dismissed) return;
    setDismissed(true);
    onDismissJob(job);
    onClose();
  }

  const tierBarWidth = `${careerOps.score}%`;
  const co = job.company || "—";
  const title = job.title || "—";
  const level = job.level || "";

  return (
    <>
      <div className="inspector-overlay" onClick={onClose} />
      <div className="inspector-panel" role="dialog" aria-label="Job inspector">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="inspector-header">
          <div className="inspector-header-identity">
            <CompanyLogo company={co} size="md" />
            <div className="inspector-header-text">
              <span className="inspector-company">{co}</span>
              <span className="inspector-title" title={title}>{title}</span>
            </div>
          </div>
          <div className="inspector-header-right">
            {level && <span className="inspector-level-badge">{level}</span>}
            <button type="button" className="inspector-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────── */}
        <div className="inspector-body">

          {/* Score hero */}
          <div className={`inspector-score-hero inspector-score-hero--${careerOps.key}`}>
            <div className="inspector-score-left">
              <span className="inspector-score-num">{careerOps.score}</span>
              <div className="inspector-score-meta">
                <span className="inspector-score-label">{careerOps.label}</span>
                <span className="inspector-score-stars" aria-hidden>{stars}</span>
              </div>
            </div>
            <div className="inspector-score-right">
              <div className="inspector-score-bar" aria-hidden>
                <span
                  className={`inspector-score-bar-fill inspector-score-bar-fill--${careerOps.key}`}
                  style={{ width: tierBarWidth }}
                />
              </div>
              {reasons.length > 0 && (
                <ul className="inspector-reasons">
                  {reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
            </div>
          </div>

          {/* Meta row */}
          {(comp || job.location || postedAgo) && (
            <div className="inspector-meta-row">
              {comp && <span className="inspector-meta-chip inspector-meta-chip--comp">{comp}</span>}
              {job.location && <span className="inspector-meta-chip">{job.location}</span>}
              {postedAgo && <span className="inspector-meta-chip inspector-meta-chip--time">{postedAgo}</span>}
            </div>
          )}

          {/* Action bar */}
          <div className="inspector-actions">
            {job.job_url ? (
              <a
                className={`inspector-btn inspector-btn--primary${isApplied ? " inspector-btn--applied" : ""}`}
                href={job.job_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {isApplied ? "Applied ✓" : "Apply ↗"}
              </a>
            ) : null}
            {canQueueResume && (
              <button
                type="button"
                className="inspector-btn inspector-btn--secondary"
                onClick={() => onQueueUrgent?.(job, 0)}
              >
                Queue Resume
              </button>
            )}
            {onDismissJob && (
              <button
                type="button"
                className="inspector-btn inspector-btn--ghost"
                onClick={handleDismiss}
                disabled={dismissed}
              >
                Dismiss
              </button>
            )}
          </div>

          {/* Resume section */}
          {tailorRecord && tailorRecord.status !== "none" && (
            <div className="inspector-section">
              <h3 className="inspector-section-title">Resume</h3>
              <div className="inspector-resume-row">
                <span className={`inspector-resume-status inspector-resume-status--${tailor.tone}`}>
                  {tailor.label}
                </span>
                {folderPath && onOpenTailorPath && (
                  <button
                    type="button"
                    className="inspector-btn inspector-btn--ghost inspector-btn--sm"
                    onClick={() => onOpenTailorPath(folderPath)}
                  >
                    Open Folder
                  </button>
                )}
                {tailorRecord.pdfPath && (
                  <a
                    className="inspector-btn inspector-btn--ghost inspector-btn--sm"
                    href={`file://${tailorRecord.pdfPath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    PDF ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {/* JD section */}
          <div className="inspector-section inspector-section--jd">
            <div className="inspector-jd-header">
              <h3 className="inspector-section-title">Job Description</h3>
              <button
                type="button"
                className={`inspector-btn inspector-btn--ghost inspector-btn--sm${jdCopied ? " inspector-btn--done" : ""}`}
                disabled={jdLoading || !jdBody}
                onClick={handleCopyJd}
              >
                {jdCopied ? "Copied" : "Copy"}
              </button>
            </div>
            {jdLoading ? (
              <div className="inspector-jd-state">Loading…</div>
            ) : jdBody ? (
              <pre className="inspector-jd-text">{jdBody}</pre>
            ) : (
              <div className="inspector-jd-state">No description available.</div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
