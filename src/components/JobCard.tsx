import { useState, type CSSProperties } from "react";
import type { Job } from "../types";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import type { SavedJobSource } from "../hooks/useApplyClickLog";
import CompanyLogo from "./CompanyLogo";
import { careerOpsRating, careerOpsStars, jobBoardLabel, matchReasons, rankBadge } from "../utils/jobPresentation";

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

function extractJobId(url: string | null | undefined): string {
  if (!url) return "";
  const match = url.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : "";
}

function buildReferralMessage(job: Job): string {
  const title = job.title || "this role";
  const company = job.company || "your company";
  const jobId = extractJobId(job.job_url);
  return `Hi Kavish,\nI hope you're doing well! I'm a former SDE2 at Bounteous, currently pursuing my MS in Data Science at Stony Brook. I came across the ${title} role (Job ID: ${jobId}) at ${company}, and would appreciate it if you could review my resume or consider referring me.\nThanks!`;
}

function fmtDate(iso?: string | null): string {
  if (!iso || iso === "null") return "—";
  const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const yest = new Date(now.getTime() - 86400000);
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function scrapedDateLabel(dateStr?: string): string {
  if (!dateStr) return "—";
  const today = new Date().toLocaleDateString("en-CA");
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  const yesterday = d.toLocaleDateString("en-CA");
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  const dt = new Date(dateStr + "T12:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function tier(s: number) {
  if (s >= 75) return { gradient: "linear-gradient(180deg,#1f1f23,#0a0a0a)", solid: "#0a0a0a", glow: "rgba(10,10,10,0.2)" };
  if (s >= 50) return { gradient: "linear-gradient(180deg,#5b53ea,#4f46e5)", solid: "#4f46e5", glow: "rgba(79,70,229,0.2)" };
  if (s >= 25) return { gradient: "linear-gradient(180deg,#6366f1,#4f46e5)", solid: "#6366f1", glow: "rgba(99,102,241,0.18)" };
  return { gradient: "linear-gradient(180deg,#a1a1aa,#71717a)", solid: "#71717a", glow: "rgba(113,113,122,0.16)" };
}

function compactTerm(term?: string | null): string | null {
  if (!term) return null;
  return term.replace(/ engineer$/i, "").trim() || null;
}

function urgencyLabel(iso?: string | null, scrapedDate?: string): string | null {
  const normalized = iso && iso !== "null" ? (TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`) : "";
  const postedAt = normalized ? new Date(normalized) : null;
  if (postedAt && !Number.isNaN(postedAt.getTime())) {
    const minutes = Math.max(0, Math.round((Date.now() - postedAt.getTime()) / 60000));
    if (minutes <= 30) return `🔥 Posted ${Math.max(1, minutes)}m ago`;
    if (minutes <= 120) return "⚡ Early applicant window";
  }
  const today = new Date().toLocaleDateString("en-CA");
  return scrapedDate === today ? "⚡ Fresh today" : null;
}

interface Props {
  job: Job;
  index?: number;
  applyRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onSaveJob?: (job: Job, source: SavedJobSource) => void;
  onExcludeCompany?: (company: string) => void;
  isSelected?: boolean;
  onSelectionToggle?: (job: Job) => void;
}

export default function JobCard({
  job,
  index,
  applyRecord,
  onAddToTracker,
  onSaveJob,
  onExcludeCompany,
  isSelected = false,
  onSelectionToggle,
}: Props) {
  const [msgCopied, setMsgCopied] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const rawScore = job.score ?? 0;
  const careerOps = careerOpsRating(job);
  const isApplied = Boolean(applyRecord);
  const t = tier(careerOps.score);
  const confidence = careerOpsStars(careerOps.score);
  const reasons = matchReasons(job, 3);
  const rank = careerOps.score >= 50 ? rankBadge(index) : index ? `#${index}` : null;
  const boardLabel = jobBoardLabel(job.site, job.job_url);
  const isTopOpportunity = Boolean(index && index <= 5 && careerOps.score >= 62);
  const trackerSyncStatus = applyRecord?.trackerSyncStatus ?? null;
  const isTrackerSynced = trackerSyncStatus === "synced" || trackerSyncStatus === "duplicate";
  const isTrackerPending = trackerSyncStatus === "pending";
  const canRetryTracker = Boolean(
    job.job_url
    && isApplied
    && !isTrackerSynced
    && !isTrackerPending,
  );
  const trackerActionCopy = trackerSyncStatus === "error" || trackerSyncStatus === "not_configured"
    ? "Retry tracker"
    : "Sync tracker";
  const trackerStatusCopy =
    !isApplied
      ? ""
      : isTrackerSynced
        ? `✓ Added to Atriveo tracker ×${applyRecord?.clicks}`
        : isTrackerPending
          ? "↻ Sending to Atriveo tracker…"
          : trackerSyncStatus === "not_configured"
            ? "⚠ Saved locally — tracker not configured"
            : trackerSyncStatus === "error"
              ? "⚠ Saved locally — tracker sync failed"
              : trackerSyncStatus === "skipped"
                ? "⚠ Saved locally — tracker skipped"
                : "Saved locally — sync tracker";
  const searchTerm = compactTerm(job.search_term);
  const cardStyle = {
    "--job-solid": t.solid,
    "--job-gradient": t.gradient,
    "--job-glow": t.glow,
  } as CSSProperties;

  const dateLabel = job.scraped_date
    ? scrapedDateLabel(job.scraped_date)
    : fmtDate(job.batch_time || job.date_posted);
  const urgency = urgencyLabel(job.batch_time || job.date_posted, job.scraped_date);

  const locationShort = (() => {
    const loc = job.location || "";
    if (!loc) return null;
    if (loc.toLowerCase().includes("remote")) return "Remote";
    const parts = loc.split(",");
    return parts.length >= 2 ? parts.slice(-2).join(",").trim() : loc;
  })();

  function handleMsg(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 1200);
    });
  }

  function handleTrackerClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!job.job_url) return;
    onAddToTracker(job.job_url, title, co, { location: job.location || null });
  }

  function handleSaveClick(e: React.MouseEvent, source: SavedJobSource) {
    e.preventDefault();
    onSaveJob?.(job, source);
  }

  function handleSelectionClick(e: React.MouseEvent) {
    e.preventDefault();
    onSelectionToggle?.(job);
  }

  return (
    <div
      className={`job-tile job-tile--${careerOps.key}${careerOps.score < 25 ? " is-low-priority" : ""}${isApplied ? " is-applied" : ""}${isSelected ? " is-selected" : ""}${isTopOpportunity ? " is-top-opportunity" : ""}`}
      style={cardStyle}
    >
      <div className="job-tile-top">
        <div className="job-tile-score-group">
          <div className={`job-tile-match job-tile-match--${careerOps.key} is-number-only`} title={careerOps.tooltip}>
            <strong>{careerOps.score}</strong>
          </div>
        </div>

        <div className="job-tile-lead">
          {rank && <span className="job-tile-rank">{rank}</span>}
          <CompanyLogo company={co} size="md" />
          {boardLabel !== "LinkedIn" && (
            <span className="job-board-tag">{boardLabel}</span>
          )}
          {onExcludeCompany && (
            <button
              type="button"
              className="job-tile-exclude"
              onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
              title={`Block "${co}"`}
            >⊘</button>
          )}
          {onSelectionToggle && (
            <button
              type="button"
              className={`job-tile-select${isSelected ? " is-selected" : ""}`}
              onClick={handleSelectionClick}
              aria-pressed={isSelected}
              title={isSelected ? "Remove from bulk copy" : "Select for bulk copy"}
            >
              {isSelected ? "✓" : "+"}
            </button>
          )}
        </div>
      </div>

      <div className="job-tile-company">
        {co}
      </div>

      <div className="job-tile-title">
        {title}
      </div>

      <div className="job-tile-confidence" aria-label={`Apply confidence ${confidence}`}>
        <strong>{confidence}</strong>
        <span>{careerOps.label}</span>
      </div>

      <div className={`job-tile-meta${urgency ? " has-urgency" : ""}`}>
        {urgency || `🕐 ${dateLabel}`}{locationShort ? ` · ${locationShort}` : ""}
      </div>

      <div className="job-tile-details" title={careerOps.tooltip}>
        {job.level && <span className="job-tile-signal">{job.level}</span>}
        {rawScore > 0 && <span className="job-tile-signal">Raw {rawScore}/250</span>}
        {searchTerm && <span className="job-tile-signal job-tile-signal--term">{searchTerm}</span>}
      </div>

      {reasons.length > 0 && (
        <div className="job-tile-reasons" aria-label="Resume match">
          {reasons.map((reason) => (
            <span key={reason} className="job-tile-reason">{reason}</span>
          ))}
        </div>
      )}

      {isApplied && (
        <div
          className={`job-tile-applied${!isTrackerSynced ? " needs-sync" : ""}${trackerSyncStatus === "error" || trackerSyncStatus === "not_configured" ? " has-error" : ""}`}
          title={applyRecord?.trackerSyncMessage || undefined}
        >
          {trackerStatusCopy}
        </div>
      )}

      <div className="job-tile-divider" />

      <div className="job-tile-actions">
        <div className="job-tile-secondary-actions">
          {job.job_url && onSaveJob && (
            <button
              type="button"
              className="job-tile-action job-tile-action--click"
              onClick={(e) => handleSaveClick(e, "click")}
              title="Log application and send to tracker"
            >
              Click
            </button>
          )}
          <button
            type="button"
            className={`job-tile-action job-tile-action--message${msgCopied ? " is-copied" : ""}`}
            onClick={handleMsg}
            title="Copy referral message"
          >
            {msgCopied ? "Copied" : (
              <>
                <span className="job-tile-action-label-full">Recruiter</span>
                <span className="job-tile-action-label-short">Msg</span>
              </>
            )}
          </button>
          {canRetryTracker && (
            <button
              type="button"
              className="job-tile-action job-tile-action--tracker"
              onClick={handleTrackerClick}
              title="Retry sending to Atriveo tracker"
            >
              <span className="job-tile-action-label-full">{trackerActionCopy}</span>
              <span className="job-tile-action-label-short">Retry</span>
            </button>
          )}
        </div>
        {job.job_url ? (
          <a
            className="job-tile-action job-tile-action--apply"
            href={job.job_url}
            target="_blank"
            rel="noopener"
          >
            Apply
          </a>
        ) : (
          <span className="job-tile-action job-tile-action--empty">—</span>
        )}
      </div>
    </div>
  );
}
