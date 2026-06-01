import { useState } from "react";
import type { Job } from "../types";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import CompanyLogo from "./CompanyLogo";
import { confidenceStars, matchReasons, rankBadge, scoreTier } from "../utils/jobPresentation";

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
  if (s >= 150) return { gradient: "linear-gradient(135deg,#4f4f47,#77766a)", solid: "#4f4f47", glow: "rgba(79,79,71,0.24)", bg: "rgba(79,79,71,0.05)", bgHover: "rgba(79,79,71,0.09)" };
  if (s >= 100) return { gradient: "linear-gradient(135deg,#5f5e54,#8a8776)", solid: "#5f5e54", glow: "rgba(95,94,84,0.22)", bg: "rgba(119,118,106,0.055)", bgHover: "rgba(119,118,106,0.1)" };
  if (s >= 70)  return { gradient: "linear-gradient(135deg,#69725a,#8a9272)", solid: "#69725a", glow: "rgba(105,114,90,0.22)", bg: "rgba(105,114,90,0.05)", bgHover: "rgba(105,114,90,0.09)" };
  if (s >= 40)  return { gradient: "linear-gradient(135deg,#9a7653,#b6946e)", solid: "#9a7653", glow: "rgba(154,118,83,0.22)", bg: "rgba(154,118,83,0.045)", bgHover: "rgba(154,118,83,0.085)" };
  return { gradient: "linear-gradient(135deg,#77766a,#c4c0ab)", solid: "#77766a", glow: "rgba(119,118,106,0.18)", bg: "rgba(119,118,106,0.035)", bgHover: "rgba(119,118,106,0.07)" };
}

function compactTerm(term?: string | null): string | null {
  if (!term) return null;
  return term.replace(/ engineer$/i, "").trim() || null;
}

interface Props {
  job: Job;
  index?: number;
  applyRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onExcludeCompany?: (company: string) => void;
  onCartToggle?: (job: Job) => void;
  isInCart?: boolean;
}

export default function JobCard({
  job,
  index,
  applyRecord,
  onAddToTracker,
  onExcludeCompany,
  onCartToggle,
  isInCart = false,
}: Props) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const isApplied = Boolean(applyRecord);
  const t = tier(score);
  const match = scoreTier(score);
  const confidence = confidenceStars(score);
  const reasons = matchReasons(job, 4);
  const rank = rankBadge(index);
  const isTopOpportunity = Boolean(index && index <= 5 && score >= 90);
  const trackerSyncStatus = applyRecord?.trackerSyncStatus ?? null;
  const isTrackerSynced = trackerSyncStatus === "synced" || trackerSyncStatus === "duplicate";
  const isTrackerPending = trackerSyncStatus === "pending";
  const canSendToTracker = Boolean(job.job_url && (!isApplied || (!isTrackerSynced && !isTrackerPending)));
  const trackerActionCopy = !isApplied
    ? "Add to tracker"
    : trackerSyncStatus === "error" || trackerSyncStatus === "not_configured"
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
  const restingBorder = isApplied
    ? "rgba(105,114,90,0.34)"
    : isInCart
      ? "rgba(79,79,71,0.28)"
      : "rgba(79,79,71,0.14)";
  const atsScore = job.ats_score ?? job.score_pct;
  const fitScore = job.fit_score;
  const searchTerm = compactTerm(job.search_term);

  const dateLabel = job.scraped_date
    ? scrapedDateLabel(job.scraped_date)
    : fmtDate(job.batch_time || job.date_posted);

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

  function handleCartClick(e: React.MouseEvent) {
    e.preventDefault();
    onCartToggle?.(job);
  }

  function handleTrackerClick(e: React.MouseEvent) {
    e.preventDefault();
    if (job.job_url) onAddToTracker(job.job_url, title, co, { location: job.location || null });
  }

  return (
    <div
      className={`job-tile job-tile--${match.key}${isApplied ? " is-applied" : ""}${isInCart ? " is-saved" : ""}${isTopOpportunity ? " is-top-opportunity" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(160deg, ${t.bgHover} 0%, #fffdf4 55%)`
          : `linear-gradient(160deg, ${t.bg} 0%, #fffdf4 55%)`,
        borderRadius: 12,
        border: `1px solid ${hovered ? t.solid + "44" : restingBorder}`,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.18s ease",
        boxShadow: hovered
          ? `0 8px 24px ${t.glow}, 0 2px 8px rgba(0,0,0,0.06)`
          : "0 1px 4px rgba(79,79,71,0.09)",
        transform: hovered ? "translateY(-2px)" : "none",
        overflow: "hidden",
        cursor: "default",
        minWidth: 0,
        position: "relative",
      }}
    >
      <div className="job-tile-top">
        <div className="job-tile-lead">
          {rank && <span className="job-tile-rank">{rank}</span>}
          <CompanyLogo company={co} size="md" />
        </div>

        <div className="job-tile-score-group">
          {onExcludeCompany && (
            <button
              type="button"
              className="job-tile-exclude"
              onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
              title={`Block "${co}"`}
            >⊘</button>
          )}
          <div className={`job-tile-match job-tile-match--${match.key}`}>
            <span className="job-tile-match-icon">{match.icon}</span>
            <strong>{score}</strong>
            <span>Match</span>
          </div>
        </div>
      </div>

      <div className="job-tile-title">
        {title}
      </div>

      <div className="job-tile-company">
        {co}
      </div>

      <div className="job-tile-confidence" aria-label={`Application confidence ${confidence}`}>
        <span>Confidence</span>
        <strong>{confidence}</strong>
      </div>

      <div className="job-tile-meta">
        🕐 {dateLabel}{locationShort ? ` · ${locationShort}` : ""}
      </div>

      <div className="job-tile-signals">
        {job.level && <span className="job-tile-signal">{job.level}</span>}
        {atsScore !== undefined && atsScore !== null && (
          <span className="job-tile-signal">ATS {atsScore}%</span>
        )}
        {fitScore !== undefined && fitScore !== null && (
          <span className="job-tile-signal">Fit {fitScore}%</span>
        )}
        {searchTerm && <span className="job-tile-signal job-tile-signal--term">{searchTerm}</span>}
      </div>

      {reasons.length > 0 && (
        <div className="job-tile-reasons">
          <span className="job-tile-reasons-label">Why</span>
          {reasons.map((reason) => (
            <span key={reason} className="job-tile-reason">✓ {reason}</span>
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
          {onCartToggle && job.job_url && (
            <button
              type="button"
              className={`job-tile-action job-tile-action--save${isInCart ? " is-saved" : ""}`}
              onClick={handleCartClick}
              title={isInCart ? "Remove from saved jobs" : "Save job"}
              aria-pressed={isInCart}
            >
              {isInCart ? "♥ Saved" : "♡ Save"}
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
          {canSendToTracker && (
            <button
              type="button"
              className="job-tile-action job-tile-action--tracker"
              onClick={handleTrackerClick}
              title="Add to Atriveo tracker"
            >
              <span className="job-tile-action-label-full">{trackerActionCopy}</span>
              <span className="job-tile-action-label-short">{isApplied ? "Retry" : "Tracker +"}</span>
            </button>
          )}
        </div>
        {job.job_url ? (
          <a
            className={`job-tile-action job-tile-action--apply${isApplied ? " is-applied" : ""}`}
            href={job.job_url}
            target="_blank"
            rel="noopener"
            style={{
              background: isApplied ? "linear-gradient(135deg,#69725a,#4f4f47)" : t.gradient,
              color: "#fff",
              boxShadow: hovered ? `0 3px 10px ${t.glow}` : "none",
            }}
          >
            {isApplied ? "Open ↗" : "🚀 Apply"}
          </a>
        ) : (
          <span className="job-tile-action job-tile-action--empty">—</span>
        )}
      </div>
    </div>
  );
}
