import { useMemo, useState } from "react";
import type { Job } from "../types";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import CompanyLogo from "./CompanyLogo";
import { careerOpsRating, careerOpsStars, matchReasons } from "../utils/jobPresentation";
import { groupJobsByCompany, type CompanyJobGroup } from "../utils/jobGrouping";

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

function fmtTime(iso?: string | null, scrapedDate?: string): string {
  if (iso && iso !== "null") {
    const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) {
      const today = new Date();
      if (d.toDateString() === today.toDateString()) {
        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      }
      const yest = new Date(today.getTime() - 86400000);
      if (d.toDateString() === yest.toDateString()) return "Yesterday";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
  if (scrapedDate) {
    const today = new Date().toLocaleDateString("en-CA");
    if (scrapedDate === today) return "Today";
  }
  return "—";
}

function locationShort(loc?: string | null): string {
  if (!loc) return "—";
  if (loc.toLowerCase().includes("remote")) return "Remote";
  const parts = loc.split(",");
  return parts.length >= 2 ? parts.slice(-2).join(",").trim() : loc;
}

interface RowProps {
  job: Job;
  index: number;
  applyRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onApplyClick?: (job: Job) => void;
  isSelected?: boolean;
  onSelectionToggle?: (job: Job) => void;
}

function JobTableRow({
  job,
  index,
  applyRecord,
  onAddToTracker,
  onApplyClick,
  isSelected = false,
  onSelectionToggle,
}: RowProps) {
  const [msgCopied, setMsgCopied] = useState(false);
  const co = job.company || "—";
  const title = job.title || "—";
  const careerOps = careerOpsRating(job);
  const stars = careerOpsStars(careerOps.score);
  const reasons = matchReasons(job, 2);
  const isApplied = Boolean(applyRecord);
  const trackerSyncStatus = applyRecord?.trackerSyncStatus ?? null;
  const isTrackerSynced = trackerSyncStatus === "synced" || trackerSyncStatus === "duplicate";
  const isTrackerPending = trackerSyncStatus === "pending";
  const canSendToTracker = Boolean(job.job_url && (!isApplied || (!isTrackerSynced && !isTrackerPending)));
  const trackerCopy = !isApplied
    ? "Add"
    : isTrackerSynced
      ? "Synced"
      : isTrackerPending
        ? "…"
        : trackerSyncStatus === "error" || trackerSyncStatus === "not_configured"
          ? "Retry"
          : "Sync";

  return (
    <tr
      className={`job-table-row job-table-row--${careerOps.key}${isApplied ? " is-applied" : ""}${isSelected ? " is-selected" : ""}`}
      title={reasons.join(" · ") || careerOps.tooltip}
    >
      <td className="job-table-check">
        {onSelectionToggle && (
          <button
            type="button"
            className={`job-table-select${isSelected ? " is-selected" : ""}`}
            onClick={() => onSelectionToggle(job)}
            aria-pressed={isSelected}
            title={isSelected ? "Deselect" : "Select for bulk actions"}
          >
            {isSelected ? "✓" : ""}
          </button>
        )}
      </td>
      <td className="job-table-num">{index}</td>
      <td className="job-table-score">
        <span className={`job-table-score-badge job-table-score-badge--${careerOps.key}`}>{careerOps.score}</span>
      </td>
      <td className="job-table-title" title={title}>{title}</td>
      <td className="job-table-match">
        <span className="job-table-stars">{stars}</span>
        <span className={`job-table-match-label job-table-match-label--${careerOps.key}`}>{careerOps.label}</span>
      </td>
      <td className="job-table-loc" title={job.location}>{locationShort(job.location)}</td>
      <td className="job-table-level">{job.level || "—"}</td>
      <td className="job-table-time">{fmtTime(job.batch_time || job.date_posted, job.scraped_date)}</td>
      <td className="job-table-actions">
        {job.job_url ? (
          <a
            className="job-table-action job-table-action--apply"
            href={job.job_url}
            target="_blank"
            rel="noopener"
            onClick={() => onApplyClick?.(job)}
          >
            Apply
          </a>
        ) : null}
        {job.job_url && onApplyClick && (
          <button type="button" className="job-table-action" onClick={() => onApplyClick(job)}>Click</button>
        )}
        <button
          type="button"
          className="job-table-action"
          onClick={() => {
            navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
              setMsgCopied(true);
              setTimeout(() => setMsgCopied(false), 1200);
            });
          }}
        >
          {msgCopied ? "Copied" : "Msg"}
        </button>
        {canSendToTracker && job.job_url && (
          <button
            type="button"
            className="job-table-action"
            onClick={() => onAddToTracker(job.job_url, title, co, { location: job.location || null })}
          >
            {trackerCopy}
          </button>
        )}
      </td>
    </tr>
  );
}

interface GroupProps {
  group: CompanyJobGroup;
  startIndex: number;
  getRecord: (jobUrl: string) => ApplyRecord | null;
  onAddToTracker: RowProps["onAddToTracker"];
  onApplyClick?: (job: Job) => void;
  onExcludeCompany?: (company: string) => void;
  isJobSelected?: (job: Job) => boolean;
  onSelectionToggle?: (job: Job) => void;
  onGroupSelectAll?: (jobs: Job[]) => void;
  isGroupFullySelected?: (jobs: Job[]) => boolean;
}

function CompanyJobGroupTable({
  group,
  startIndex,
  getRecord,
  onAddToTracker,
  onApplyClick,
  onExcludeCompany,
  isJobSelected,
  onSelectionToggle,
  onGroupSelectAll,
  isGroupFullySelected,
}: GroupProps) {
  const allSelected = isGroupFullySelected?.(group.jobs) ?? false;
  const topTier = careerOpsRating(group.jobs[0]).key;

  return (
    <section className="job-table-group">
      <header className="job-table-group-head">
        <CompanyLogo company={group.company} size="md" />
        <div className="job-table-group-meta">
          <strong title={group.company}>{group.company}</strong>
          <span>{group.jobs.length} role{group.jobs.length === 1 ? "" : "s"}</span>
        </div>
        <span className={`job-table-group-score job-table-score-badge job-table-score-badge--${topTier}`}>
          {group.bestScore}
        </span>
        {onGroupSelectAll && (
          <button
            type="button"
            className={`job-table-group-select${allSelected ? " is-selected" : ""}`}
            onClick={() => onGroupSelectAll(group.jobs)}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
        {onExcludeCompany && (
          <button
            type="button"
            className="job-table-group-exclude"
            onClick={() => onExcludeCompany(group.company)}
            title={`Block ${group.company}`}
          >
            ⊘
          </button>
        )}
      </header>
      <div className="job-table-wrap job-table-wrap--nested">
        <table className="job-table">
          <thead>
            <tr>
              <th aria-label="Select" />
              <th>#</th>
              <th>Score</th>
              <th>Role</th>
              <th>Match</th>
              <th>Location</th>
              <th>Level</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.jobs.map((job, i) => (
              <JobTableRow
                key={job.job_url || `${group.company}-${i}`}
                job={job}
                index={startIndex + i + 1}
                applyRecord={job.job_url ? getRecord(job.job_url) : null}
                onAddToTracker={onAddToTracker}
                onApplyClick={onApplyClick}
                isSelected={isJobSelected?.(job)}
                onSelectionToggle={onSelectionToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Props {
  jobs: Job[];
  getRecord: (jobUrl: string) => ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onApplyClick?: (job: Job) => void;
  onExcludeCompany?: (company: string) => void;
  isJobSelected?: (job: Job) => boolean;
  onSelectionToggle?: (job: Job) => void;
  onGroupSelectAll?: (jobs: Job[]) => void;
  isGroupFullySelected?: (jobs: Job[]) => boolean;
  groupByCompany?: boolean;
}

export default function JobTable({
  jobs,
  getRecord,
  onAddToTracker,
  onApplyClick,
  onExcludeCompany,
  isJobSelected,
  onSelectionToggle,
  onGroupSelectAll,
  isGroupFullySelected,
  groupByCompany = true,
}: Props) {
  const groups = useMemo(
    () => (groupByCompany ? groupJobsByCompany(jobs) : []),
    [jobs, groupByCompany],
  );

  if (!groupByCompany) {
    return (
      <div className="job-table-wrap">
        <table className="job-table">
          <thead>
            <tr>
              <th aria-label="Select" />
              <th>#</th>
              <th>Score</th>
              <th>Role</th>
              <th>Match</th>
              <th>Location</th>
              <th>Level</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <JobTableRow
                key={job.job_url || i}
                job={job}
                index={i + 1}
                applyRecord={job.job_url ? getRecord(job.job_url) : null}
                onAddToTracker={onAddToTracker}
                onApplyClick={onApplyClick}
                isSelected={isJobSelected?.(job)}
                onSelectionToggle={onSelectionToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  let runningIndex = 0;
  return (
    <div className="job-table-groups">
      {groups.map((group) => {
        const startIndex = runningIndex;
        runningIndex += group.jobs.length;
        return (
          <CompanyJobGroupTable
            key={group.company}
            group={group}
            startIndex={startIndex}
            getRecord={getRecord}
            onAddToTracker={onAddToTracker}
            onApplyClick={onApplyClick}
            onExcludeCompany={onExcludeCompany}
            isJobSelected={isJobSelected}
            onSelectionToggle={onSelectionToggle}
            onGroupSelectAll={onGroupSelectAll}
            isGroupFullySelected={isGroupFullySelected}
          />
        );
      })}
    </div>
  );
}
