import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../types";
import type { SortBy, SortDir } from "../pages/Dashboard.types";
import type { SavedJobSource } from "../hooks/useApplyClickLog";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import CompanyLogo from "./CompanyLogo";
import { careerOpsRating, careerOpsStars, companyDomain, matchReasons } from "../utils/jobPresentation";
import { groupJobsByCompany, type CompanyJobGroup } from "../utils/jobGrouping";
import { copyJobDescription } from "../utils/jobCopy";
import type { TailorRecord } from "../types/tailorQueue";
import { tailorCellLabel, tailorFolderPath } from "../utils/tailorProgress";
import { formatResumeSlot, resolveResumeSlot, resolveSessionHour } from "../utils/resumeSlot";
import { formatResumeId, type SessionResumeMeta } from "../utils/sessionResume";
import TailorJobLogModal from "./TailorJobLogModal";

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

function fmtTime(iso?: string | null, scrapedDate?: string, relative = false, board = false): string {
  const tz = "America/New_York";
  if (iso && iso !== "null") {
    const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      const todayEt = now.toLocaleDateString("en-CA", { timeZone: tz });
      const dateEt = d.toLocaleDateString("en-CA", { timeZone: tz });
      if (relative && dateEt === todayEt) {
        const diffMs = now.getTime() - d.getTime();
        const diffM = Math.floor(diffMs / 60000);
        if (diffM < 1) return "Just now";
        if (diffM < 60) return `${diffM}m ago`;
        const diffH = Math.floor(diffM / 60);
        if (diffH < 24) return `${diffH}h ago`;
      }
      const timeOpts: Intl.DateTimeFormatOptions = {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        ...(board ? { second: "2-digit" } : {}),
      };
      if (dateEt === todayEt) {
        return d.toLocaleTimeString("en-US", timeOpts);
      }
      const yest = new Date(now.getTime() - 86400000);
      const yestEt = yest.toLocaleDateString("en-CA", { timeZone: tz });
      if (dateEt === yestEt) return "Yesterday";
      return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
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

function scoreTrend(careerOps: ReturnType<typeof careerOpsRating>): "up" | "down" | "flat" {
  const { atsPct, fitPct } = careerOps;
  if (atsPct == null || fitPct == null) return "flat";
  if (fitPct > atsPct + 5) return "up";
  if (fitPct < atsPct - 5) return "down";
  return "flat";
}

function scoreDelta(careerOps: ReturnType<typeof careerOpsRating>): number | null {
  const { atsPct, fitPct } = careerOps;
  if (atsPct == null || fitPct == null) return null;
  return Math.abs(Math.round(fitPct - atsPct));
}

function parseRunDateFromPath(path?: string | null): string | null {
  if (!path) return null;
  const match = path.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function parseFolderFromPath(path?: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return null;
  return parts[parts.length - 1] || null;
}

function resumeLocationLabel(
  record: TailorRecord | null | undefined,
  displayHour: string,
  displaySlot: number,
): string {
  const sourcePath = record?.dir || record?.pdfPath || "";
  const date = parseRunDateFromPath(sourcePath) || "unknown-date";
  const folder = record?.folder || parseFolderFromPath(record?.dir) || displayHour;
  return `${date}/${folder}/#${formatResumeSlot(displaySlot)}`;
}

function JobTableSelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  title,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={`job-table-checkbox${className ? ` ${className}` : ""}`}
      checked={checked}
      onChange={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onClick={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
    />
  );
}

interface SortableHeaderProps {
  label: string;
  column: SortBy;
  sortBy?: SortBy;
  sortDir?: SortDir;
  onSort?: (column: SortBy) => void;
}

function SortableHeader({ label, column, sortBy, sortDir, onSort }: SortableHeaderProps) {
  const active = sortBy === column;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : undefined;

  if (!onSort) {
    return <th>{label}</th>;
  }

  return (
    <th
      className={`job-table-sort-th${active ? " is-active" : ""}`}
      aria-sort={ariaSort}
    >
      <button type="button" className="job-table-sort-btn" onClick={() => onSort(column)}>
        <span className="job-table-sort-label">{label}</span>
        <span className="job-table-sort-icon" aria-hidden>
          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function ScoreCell({ job, board = false }: { job: Job; board?: boolean }) {
  const careerOps = careerOpsRating(job);
  const trend = scoreTrend(careerOps);
  const delta = scoreDelta(careerOps);
  const trendSymbol = trend === "up" ? "▲" : trend === "down" ? "▼" : "→";

  if (board) {
    return (
      <div className="job-table-score-cell job-table-score-cell--board">
        <div className="job-table-score-top">
          <span className="job-table-score-num">{careerOps.score}</span>
          {delta != null && delta > 0 && (
            <span className={`job-table-score-delta job-table-score-delta--${trend}`} title="Fit vs ATS">
              {trendSymbol} {delta}
            </span>
          )}
        </div>
        <div className="job-table-score-bar" aria-hidden>
          <span
            className={`job-table-score-bar-fill job-table-score-bar-fill--${careerOps.key}`}
            style={{ width: `${careerOps.score}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="job-table-score-cell">
      <div className="job-table-score-top">
        <span className={`job-table-score-badge job-table-score-badge--${careerOps.key}`}>{careerOps.score}</span>
        <span className={`job-table-score-trend job-table-score-trend--${trend}`} title="Fit vs ATS">
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
        </span>
      </div>
      <div className="job-table-score-bar" aria-hidden>
        <span
          className={`job-table-score-bar-fill job-table-score-bar-fill--${careerOps.key}`}
          style={{ width: `${careerOps.score}%` }}
        />
      </div>
    </div>
  );
}

function CompanyBandRow({
  group,
  solo = false,
  onGroupSelectAll,
  isGroupFullySelected,
}: {
  group: CompanyJobGroup;
  solo?: boolean;
  onGroupSelectAll?: (jobs: Job[]) => void;
  isGroupFullySelected?: (jobs: Job[]) => boolean;
}) {
  const domain = companyDomain(group.company);
  const openings = group.jobs.length;
  const allSelected = isGroupFullySelected?.(group.jobs) ?? false;

  return (
    <tr className={`job-table-band${solo ? " job-table-band--solo" : ""}`}>
      <td className="job-table-check" onClick={(e) => e.stopPropagation()}>
        {onGroupSelectAll ? (
          <JobTableSelectCheckbox
            checked={allSelected}
            onChange={() => onGroupSelectAll(group.jobs)}
            title={allSelected ? `Deselect all ${group.company} roles` : `Select all ${group.company} roles`}
            className="job-table-checkbox--band"
          />
        ) : null}
      </td>
      <td colSpan={11}>
        <div className="job-table-band-inner">
          <CompanyLogo company={group.company} size="sm" />
          <span className="job-table-band-name">{group.company.toUpperCase()}</span>
          <span className="job-table-band-openings">
            {openings} opening{openings !== 1 ? "s" : ""}
          </span>
          {domain && (
            <a
              className="job-table-band-link"
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {domain}
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

interface RowProps {
  job: Job;
  index: number;
  applyRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onSaveJob?: (job: Job, source: SavedJobSource) => void;
  isSelected?: boolean;
  onSelectionToggle?: (job: Job) => void;
  onExcludeCompany?: (company: string) => void;
  getTailorRecord?: (job: Job) => TailorRecord | null;
  onQueueUrgent?: (job: Job, resumeSlot: number) => void;
  onOpenTailorPath?: (path: string) => void;
  onDismissJob?: (job: Job) => void;
  nested?: boolean;
  showCompany?: boolean;
  board?: boolean;
  sessionResumeByUrl?: Map<string, SessionResumeMeta>;
  resumeIdCompact?: boolean;
}

function JobTableRow({
  job,
  index,
  applyRecord,
  onAddToTracker,
  onSaveJob,
  isSelected = false,
  onSelectionToggle,
  onExcludeCompany,
  getTailorRecord,
  onQueueUrgent,
  onOpenTailorPath,
  onDismissJob,
  nested = false,
  showCompany = true,
  board = false,
  sessionResumeByUrl,
  resumeIdCompact = false,
}: RowProps) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [jdCopyState, setJdCopyState] = useState<"" | "loading" | "copied" | "summary" | "missing">("");
  const [savedFeedback, setSavedFeedback] = useState<SavedJobSource | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const co = job.company || "—";
  const title = job.title || "—";
  const careerOps = careerOpsRating(job);
  const stars = careerOpsStars(careerOps.score);
  const reasons = matchReasons(job, 2);
  const isApplied = Boolean(applyRecord);
  const trackerSyncStatus = applyRecord?.trackerSyncStatus ?? null;
  const isTrackerSynced = trackerSyncStatus === "synced" || trackerSyncStatus === "duplicate";
  const isTrackerPending = trackerSyncStatus === "pending";
  const canRetryTracker = Boolean(
    job.job_url
    && isApplied
    && !isTrackerSynced
    && !isTrackerPending,
  );
  const trackerCopy = trackerSyncStatus === "error" || trackerSyncStatus === "not_configured"
    ? "Retry"
    : "Sync";
  const sessionMeta = job.job_url ? sessionResumeByUrl?.get(job.job_url) : undefined;
  const tailorRecord = getTailorRecord?.(job) ?? null;
  const tailor = tailorCellLabel(tailorRecord);
  const folderPath = tailorFolderPath(tailorRecord);
  const isResumeActive = tailorRecord?.status === "queued" || tailorRecord?.status === "running";
  const canQueueResume = Boolean(
    onQueueUrgent
    && job.job_url
    && (!tailorRecord || tailorRecord.status === "none" || tailorRecord.status === "failed"),
  );
  const displaySlot = resolveResumeSlot(tailorRecord, sessionMeta?.slot ?? index);
  const displayHour = resolveSessionHour(tailorRecord, sessionMeta?.hour);
  const displayId = resumeIdCompact
    ? formatResumeSlot(displaySlot)
    : formatResumeId(displayHour, displaySlot);
  const resumePathHint = resumeLocationLabel(tailorRecord, displayHour, displaySlot);
  const showTailorLog = tailorRecord?.status === "done";

  function saveJob(source: SavedJobSource, e?: React.MouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    if (!onSaveJob) return;
    onSaveJob(job, source);
    setSavedFeedback(source);
    setTimeout(() => setSavedFeedback(null), 1400);
  }

  async function handleCopyJd(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (jdCopyState === "loading") return;
    setJdCopyState("loading");
    try {
      const result = await copyJobDescription(job);
      setJdCopyState(result === "missing" ? "missing" : result === "summary" ? "summary" : "copied");
      window.setTimeout(() => setJdCopyState(""), 1400);
    } catch {
      setJdCopyState("missing");
      window.setTimeout(() => setJdCopyState(""), 1400);
    }
  }

  const jdCopyLabel = jdCopyState === "loading"
    ? "…"
    : jdCopyState === "copied"
      ? "Copied"
      : jdCopyState === "summary"
        ? "Snippet"
        : jdCopyState === "missing"
          ? "No JD"
          : board
            ? "JD"
            : "Copy JD";

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>) {
    if (!board || !onDismissJob) return;
    if ((e.target as HTMLElement).closest(
      "button, a, input, textarea, select, label, .job-table-check, .job-table-actions, .job-table-tailored",
    )) return;
    onDismissJob(job);
  }

  return (
    <tr
      className={`job-table-row job-table-row--${careerOps.key}${isApplied ? " is-applied" : ""}${isSelected ? " is-selected" : ""}${isResumeActive ? " is-compiling" : ""}${nested ? " is-nested" : ""}${board ? " job-table-row--board job-table-row--clickable" : ""}`}
      title={reasons.join(" · ") || careerOps.tooltip}
      onClick={board ? handleRowClick : undefined}
    >
      <td className="job-table-check">
        {onSelectionToggle && (
          <JobTableSelectCheckbox
            checked={isSelected}
            onChange={() => onSelectionToggle(job)}
            title={isSelected ? "Deselect" : "Select for bulk actions"}
          />
        )}
      </td>
      <td className="job-table-num" title={resumePathHint}>
        {board || !nested ? displayId : ""}
      </td>
      <td className="job-table-score">
        <ScoreCell job={job} board={board} />
      </td>
      {board ? (
        <>
          <td className="job-table-job job-table-job--role">
            <div className="job-table-role-title" title={title}>{title}</div>
          </td>
          <td className="job-table-job job-table-job--company">
            <div className="job-table-company-cell">
              <CompanyLogo company={co} size="sm" />
              <span className="job-table-company-name" title={co}>{co}</span>
              {onExcludeCompany && (
                <button
                  type="button"
                  className="job-table-exclude"
                  onClick={(e) => { e.stopPropagation(); onExcludeCompany(co); }}
                  title={`Block ${co}`}
                >
                  ⊘
                </button>
              )}
            </div>
          </td>
        </>
      ) : (
        <td className="job-table-job">
          {showCompany ? (
            <div className="job-table-role-cell">
              <CompanyLogo company={co} size="sm" />
              <div className="job-table-role-copy">
                <div className="job-table-role-title" title={title}>{title}</div>
                <div className="job-table-role-company" title={co}>{co.toUpperCase()}</div>
              </div>
              {onExcludeCompany && (
                <button
                  type="button"
                  className="job-table-exclude"
                  onClick={(e) => { e.stopPropagation(); onExcludeCompany(co); }}
                  title={`Block ${co}`}
                >
                  ⊘
                </button>
              )}
            </div>
          ) : (
            <div className="job-table-job-title job-table-job-title--nested" title={title}>{title}</div>
          )}
        </td>
      )}
      {!board && (
        <td className="job-table-match">
          <span className="job-table-stars" aria-label={`Rating ${stars.replace(/☆/g, "").length} of 5`}>{stars}</span>
          <span className={`job-table-match-label job-table-match-label--${careerOps.key}`}>{careerOps.label}</span>
        </td>
      )}
      <td className="job-table-loc" title={job.location}>{locationShort(job.location)}</td>
      <td className="job-table-level">{job.level || "—"}</td>
      {board && (
        <td className="job-table-tailored">
          <div className="job-table-tailored-inner">
            <span
              className={`job-table-tailored-pill job-table-tailored-pill--${tailor.tone}`}
              title={`${tailor.tooltip} · ${resumePathHint}`}
            >
              {tailor.label}
            </span>
            <div className="job-table-tailored-actions">
              {folderPath && onOpenTailorPath ? (
                <button
                  type="button"
                  className="job-table-tailored-folder"
                  title={tailorRecord?.folder || folderPath}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTailorPath(folderPath);
                  }}
                >
                  #{formatResumeSlot(displaySlot)}
                </button>
              ) : null}
              {showTailorLog && tailorRecord ? (
                <button
                  type="button"
                  className="job-table-tailored-log"
                  title="View tailor log"
                  aria-label={`View tailor log for ${co}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLogOpen(true);
                  }}
                >
                  <span className="job-table-tailored-log-icon" aria-hidden>📋</span>
                </button>
              ) : null}
            </div>
            {folderPath ? (
              <span className="job-table-tailored-path" title={resumePathHint}>
                {resumePathHint}
              </span>
            ) : null}
          </div>
          {logOpen && tailorRecord ? (
            <TailorJobLogModal record={tailorRecord} onClose={() => setLogOpen(false)} />
          ) : null}
        </td>
      )}
      <td className="job-table-time">{fmtTime(job.batch_time || job.date_posted, job.scraped_date, board)}</td>
      <td className={`job-table-actions${board ? " job-table-actions--board" : ""}`}>
        {board ? (
          <div className="job-table-board-actions">
            {job.job_url ? (
              <a
                className="job-table-board-apply job-table-board-apply--primary"
                href={job.job_url}
                target="_blank"
                rel="noopener"
                title="Open job posting"
                onClick={(e) => e.stopPropagation()}
              >
                Apply
              </a>
            ) : null}
            {job.job_url && onSaveJob && (
              <button
                type="button"
                className={`job-table-board-apply${savedFeedback === "click" ? " is-logged" : ""}`}
                onClick={(e) => saveJob("click", e)}
                title="Log application and send to tracker"
              >
                {savedFeedback === "click" ? "Moved ✓" : "Click"}
              </button>
            )}
            <button
              type="button"
              className="job-table-board-apply"
              title="Copy referral message"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
                  setMsgCopied(true);
                  setTimeout(() => setMsgCopied(false), 1200);
                });
              }}
            >
              {msgCopied ? "Copied" : "Msg"}
            </button>
            <button
              type="button"
              className={`job-table-board-apply${jdCopyState === "copied" || jdCopyState === "summary" ? " is-logged" : ""}${jdCopyState === "missing" ? " is-warn" : ""}`}
              title="Copy full job description"
              disabled={jdCopyState === "loading"}
              onClick={handleCopyJd}
            >
              {jdCopyLabel}
            </button>
            {canRetryTracker && (
              <button
                type="button"
                className="job-table-board-apply"
                title="Retry sending to Atriveo tracker"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToTracker(job.job_url, title, co, { location: job.location || null });
                }}
              >
                {trackerCopy}
              </button>
            )}
            {canQueueResume && (
              <button
                type="button"
                className="job-table-board-apply job-table-board-apply--urgent"
                title="Queue resume compile"
                onClick={(e) => {
                  e.stopPropagation();
                  onQueueUrgent!(job, displaySlot);
                }}
              >
                Resume
              </button>
            )}
          </div>
        ) : (
          <>
            {job.job_url ? (
              <a
                className="job-table-action job-table-action--apply"
                href={job.job_url}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
              >
                Apply
              </a>
            ) : null}
            {job.job_url && onSaveJob && (
              <button type="button" className="job-table-action" onClick={(e) => saveJob("click", e)}>Click</button>
            )}
            <button
              type="button"
              className="job-table-action"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
                  setMsgCopied(true);
                  setTimeout(() => setMsgCopied(false), 1200);
                });
              }}
            >
              {msgCopied ? "Copied" : "Msg"}
            </button>
            <button
              type="button"
              className="job-table-action"
              title="Copy full job description"
              disabled={jdCopyState === "loading"}
              onClick={handleCopyJd}
            >
              {jdCopyLabel}
            </button>
            {canRetryTracker && (
              <button
                type="button"
                className="job-table-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToTracker(job.job_url, title, co, { location: job.location || null });
                }}
              >
                {trackerCopy}
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

interface CompanyGroupRowProps {
  group: CompanyJobGroup;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onExcludeCompany?: (company: string) => void;
  onGroupSelectAll?: (jobs: Job[]) => void;
  isGroupFullySelected?: (jobs: Job[]) => boolean;
}

function CompanyGroupRow({
  group,
  index,
  expanded,
  onToggle,
  onExcludeCompany,
  onGroupSelectAll,
  isGroupFullySelected,
}: CompanyGroupRowProps) {
  const top = group.jobs[0];
  const topOps = careerOpsRating(top);
  const allSelected = isGroupFullySelected?.(group.jobs) ?? false;
  const title = top.title || "—";

  return (
    <tr
      className={`job-table-row job-table-row--group job-table-row--${topOps.key}${expanded ? " is-expanded" : ""}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={expanded}
    >
      <td className="job-table-check" onClick={(e) => e.stopPropagation()}>
        {onGroupSelectAll && (
          <JobTableSelectCheckbox
            checked={allSelected}
            onChange={() => onGroupSelectAll(group.jobs)}
            title={allSelected ? "Deselect all roles" : "Select all roles"}
          />
        )}
      </td>
      <td className="job-table-num">{index}</td>
      <td className="job-table-score">
        <ScoreCell job={top} />
      </td>
      <td className="job-table-job">
        <div className="job-table-group-head">
          <span className="job-table-group-chevron" aria-hidden>{expanded ? "▾" : "▸"}</span>
          <CompanyLogo company={group.company} size="sm" />
          <div className="job-table-group-copy">
            <span className="job-table-group-name" title={group.company}>{group.company}</span>
            {!expanded && (
              <span className="job-table-group-preview" title={title}>
                {title}
                {group.jobs.length > 1 ? ` · +${group.jobs.length - 1} more` : ""}
              </span>
            )}
          </div>
          <span className="job-table-group-count">{group.jobs.length}</span>
        </div>
      </td>
      <td className="job-table-match">
        <span className="job-table-stars">{careerOpsStars(topOps.score)}</span>
        <span className={`job-table-match-label job-table-match-label--${topOps.key}`}>{topOps.label}</span>
      </td>
      <td className="job-table-loc" title={top.location}>{locationShort(top.location)}</td>
      <td className="job-table-level">{top.level || "—"}</td>
      <td className="job-table-tailored" />
      <td className="job-table-time">{fmtTime(top.batch_time || top.date_posted, top.scraped_date)}</td>
      <td className="job-table-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`job-table-action job-table-action--ghost${allSelected ? " is-active" : ""}`}
          onClick={() => onGroupSelectAll?.(group.jobs)}
        >
          {allSelected ? "Deselect" : "Select all"}
        </button>
        {onExcludeCompany && (
          <button
            type="button"
            className="job-table-action job-table-action--ghost"
            onClick={() => onExcludeCompany(group.company)}
            title={`Block ${group.company}`}
          >
            Block
          </button>
        )}
      </td>
    </tr>
  );
}

interface Props {
  jobs: Job[];
  getRecord: (jobUrl: string) => ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onSaveJob?: (job: Job, source: SavedJobSource) => void;
  onExcludeCompany?: (company: string) => void;
  isJobSelected?: (job: Job) => boolean;
  onSelectionToggle?: (job: Job) => void;
  onGroupSelectAll?: (jobs: Job[]) => void;
  isGroupFullySelected?: (jobs: Job[]) => boolean;
  groupByCompany?: boolean;
  getTailorRecord?: (job: Job) => TailorRecord | null;
  onQueueUrgent?: (job: Job, resumeSlot: number) => void;
  onOpenTailorPath?: (path: string) => void;
  onDismissJob?: (job: Job) => void;
  variant?: "default" | "board";
  sortBy?: SortBy;
  sortDir?: SortDir;
  onSortColumn?: (column: SortBy) => void;
  sessionResumeByUrl?: Map<string, SessionResumeMeta>;
  resumeIdCompact?: boolean;
}

export default function JobTable({
  jobs,
  getRecord,
  onAddToTracker,
  onSaveJob,
  onExcludeCompany,
  isJobSelected,
  onSelectionToggle,
  onGroupSelectAll,
  isGroupFullySelected,
  groupByCompany = true,
  getTailorRecord,
  onQueueUrgent,
  onOpenTailorPath,
  onDismissJob,
  variant = "default",
  sortBy,
  sortDir,
  onSortColumn,
  sessionResumeByUrl,
  resumeIdCompact = false,
}: Props) {
  const groups = useMemo(
    () => (
      groupByCompany
        ? groupJobsByCompany(jobs, sortBy, sortDir, getTailorRecord)
        : []
    ),
    [jobs, groupByCompany, sortBy, sortDir, getTailorRecord],
  );
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());

  const toggleCompany = (company: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  };

  const wrapClass = variant === "board" ? "job-table-wrap job-table-wrap--board" : "job-table-wrap";
  const tableClass = variant === "board" ? "job-table job-table--board" : "job-table";

  const visibleSelection = useMemo(() => {
    if (!isJobSelected || !jobs.length) {
      return { all: false, some: false, count: 0 };
    }
    const count = jobs.filter((job) => isJobSelected(job)).length;
    return {
      all: count === jobs.length,
      some: count > 0 && count < jobs.length,
      count,
    };
  }, [jobs, isJobSelected]);

  return (
    <div className={wrapClass}>
      <table className={tableClass}>
        {variant === "board" && (
          <colgroup>
            <col className="col-check" />
            <col className="col-num" />
            <col className="col-score" />
            <col className="col-role" />
            <col className="col-company" />
            <col className="col-loc" />
            <col className="col-level" />
            <col className="col-tailored" />
            <col className="col-posted" />
            <col className="col-actions" />
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="job-table-check job-table-check--head">
              {onSelectionToggle && onGroupSelectAll ? (
                <JobTableSelectCheckbox
                  checked={visibleSelection.all}
                  indeterminate={visibleSelection.some}
                  onChange={() => onGroupSelectAll(jobs)}
                  title={visibleSelection.all ? "Deselect all visible jobs" : "Select all visible jobs"}
                  className="job-table-checkbox--head"
                />
              ) : null}
            </th>
            <th>#</th>
            {variant === "board" && onSortColumn ? (
              <>
                <SortableHeader label="Score" column="score" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Role" column="company" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Company" column="company" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Location" column="location" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Level" column="level" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Resume" column="tailored" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Posted" column="time" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
              </>
            ) : (
              <>
                <th>Score</th>
                <th>{variant === "board" ? "Role" : "Job"}</th>
                {variant === "board" ? <th>Company</th> : null}
                <th>Location</th>
                <th>Level</th>
                {variant === "board" ? <th>Resume</th> : null}
                <th>{variant === "board" ? "Posted" : "Time"}</th>
              </>
            )}
            <th>{variant === "board" ? "Actions" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {groupByCompany ? (
            variant === "board" ? (
              groups.map((group, gi) => {
                const multiRole = group.jobs.length > 1;
                const priorCount = groups.slice(0, gi).reduce((acc, g) => acc + g.jobs.length, 0);
                return (
                  <Fragment key={group.company}>
                    <CompanyBandRow
                      group={group}
                      solo={!multiRole}
                      onGroupSelectAll={onGroupSelectAll}
                      isGroupFullySelected={isGroupFullySelected}
                    />
                    {group.jobs.map((job, j) => (
                      <JobTableRow
                        key={job.job_url || `${group.company}-${j}`}
                        job={job}
                        index={priorCount + j + 1}
                        applyRecord={job.job_url ? getRecord(job.job_url) : null}
                        onAddToTracker={onAddToTracker}
                        onSaveJob={onSaveJob}
                        isSelected={isJobSelected?.(job)}
                        onSelectionToggle={onSelectionToggle}
                        onExcludeCompany={onExcludeCompany}
                        getTailorRecord={getTailorRecord}
                        onQueueUrgent={onQueueUrgent}
                        onOpenTailorPath={onOpenTailorPath}
                        onDismissJob={onDismissJob}
                        nested={multiRole}
                        board
                        sessionResumeByUrl={sessionResumeByUrl}
                        resumeIdCompact={resumeIdCompact}
                      />
                    ))}
                  </Fragment>
                );
              })
            ) : (
              groups.map((group, i) => {
                const rowIndex = i + 1;
                if (group.jobs.length === 1) {
                  const job = group.jobs[0];
                  return (
                    <JobTableRow
                      key={job.job_url || group.company}
                      job={job}
                      index={rowIndex}
                      applyRecord={job.job_url ? getRecord(job.job_url) : null}
                      onAddToTracker={onAddToTracker}
                      onSaveJob={onSaveJob}
                      isSelected={isJobSelected?.(job)}
                      onSelectionToggle={onSelectionToggle}
                      onExcludeCompany={onExcludeCompany}
                      showCompany
                    />
                  );
                }

                const expanded = expandedCompanies.has(group.company);
                return (
                  <Fragment key={group.company}>
                    <CompanyGroupRow
                      group={group}
                      index={rowIndex}
                      expanded={expanded}
                      onToggle={() => toggleCompany(group.company)}
                      onExcludeCompany={onExcludeCompany}
                      onGroupSelectAll={onGroupSelectAll}
                      isGroupFullySelected={isGroupFullySelected}
                    />
                    {expanded &&
                      group.jobs.map((job, j) => (
                        <JobTableRow
                          key={job.job_url || `${group.company}-${j}`}
                          job={job}
                          index={rowIndex}
                          applyRecord={job.job_url ? getRecord(job.job_url) : null}
                          onAddToTracker={onAddToTracker}
                          onSaveJob={onSaveJob}
                          isSelected={isJobSelected?.(job)}
                          onSelectionToggle={onSelectionToggle}
                          nested
                          showCompany={false}
                        />
                      ))}
                  </Fragment>
                );
              })
            )
          ) : (
            jobs.map((job, i) => (
              <JobTableRow
                key={job.job_url || i}
                job={job}
                index={i + 1}
                applyRecord={job.job_url ? getRecord(job.job_url) : null}
                onAddToTracker={onAddToTracker}
                onSaveJob={onSaveJob}
                isSelected={isJobSelected?.(job)}
                onSelectionToggle={onSelectionToggle}
                onExcludeCompany={onExcludeCompany}
                getTailorRecord={getTailorRecord}
                onQueueUrgent={onQueueUrgent}
                onOpenTailorPath={onOpenTailorPath}
                onDismissJob={onDismissJob}
                sessionResumeByUrl={sessionResumeByUrl}
                resumeIdCompact={resumeIdCompact}
                showCompany
                board={variant === "board"}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
