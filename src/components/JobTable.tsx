import { Fragment, useMemo, useState } from "react";
import type { Job } from "../types";
import type { SortBy, SortDir } from "../pages/Dashboard.types";
import type { SavedJobSource } from "../hooks/useApplyClickLog";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import CompanyLogo from "./CompanyLogo";
import { careerOpsRating, careerOpsStars, companyDomain, matchReasons } from "../utils/jobPresentation";
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

function fmtTime(iso?: string | null, scrapedDate?: string, relative = false): string {
  if (iso && iso !== "null") {
    const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      const today = new Date();
      if (relative && d.toDateString() === today.toDateString()) {
        const diffMs = now.getTime() - d.getTime();
        const diffM = Math.floor(diffMs / 60000);
        if (diffM < 1) return "Just now";
        if (diffM < 60) return `${diffM}m ago`;
        const diffH = Math.floor(diffM / 60);
        if (diffH < 24) return `${diffH}h ago`;
      }
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

function compLabel(value: number | null | undefined): string {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return "Low";
  if (score <= 3) return "Med";
  return "High";
}

// Short, single-word pill label for the dense board rating column.
function ratingPillLabel(key: string): string {
  switch (key) {
    case "green": return "Strong";
    case "blue":  return "Good";
    case "yellow": return "Review";
    default: return "Low";
  }
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

function CompanyBandRow({ group }: { group: CompanyJobGroup }) {
  const domain = companyDomain(group.company);
  const openings = group.jobs.length;

  return (
    <tr className="job-table-band">
      <td colSpan={10}>
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
  nested?: boolean;
  showCompany?: boolean;
  board?: boolean;
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
  nested = false,
  showCompany = true,
  board = false,
}: RowProps) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<SavedJobSource | null>(null);
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

  function saveJob(source: SavedJobSource) {
    if (!onSaveJob) return;
    onSaveJob(job, source);
    setSavedFeedback(source);
    setTimeout(() => setSavedFeedback(null), 1400);
  }

  return (
    <tr
      className={`job-table-row job-table-row--${careerOps.key}${isApplied ? " is-applied" : ""}${isSelected ? " is-selected" : ""}${nested ? " is-nested" : ""}${board ? " job-table-row--board" : ""}`}
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
      <td className="job-table-num">{board || !nested ? index : ""}</td>
      <td className="job-table-score">
        <ScoreCell job={job} board={board} />
      </td>
      <td className="job-table-job">
        {board ? (
          <div className="job-table-role-cell">
            <CompanyLogo company={co} size="sm" />
            <div className="job-table-role-copy">
              <div className="job-table-role-title" title={title}>{title}</div>
              <div className="job-table-role-company" title={co}>{co.toUpperCase()}</div>
            </div>
            {onExcludeCompany && (
              <button type="button" className="job-table-exclude" onClick={() => onExcludeCompany(co)} title={`Block ${co}`}>⊘</button>
            )}
          </div>
        ) : showCompany ? (
          <div className="job-table-job-stack">
            <div className="job-table-job-company">
              <CompanyLogo company={co} size="sm" />
              <span title={co}>{co}</span>
              {onExcludeCompany && (
                <button type="button" className="job-table-exclude" onClick={() => onExcludeCompany(co)} title={`Block ${co}`}>⊘</button>
              )}
            </div>
            <div className="job-table-job-title" title={title}>{title}</div>
          </div>
        ) : (
          <div className="job-table-job-title job-table-job-title--nested" title={title}>{title}</div>
        )}
      </td>
      <td className="job-table-match">
        {board ? (
          <div className="job-table-rating-inner">
            <span className="job-table-stars" aria-label={`Rating ${stars.replace(/☆/g, "").length} of 5`}>{stars}</span>
            <span className={`job-table-rating-pill job-table-rating-pill--${careerOps.key}`} title={careerOps.label}>{ratingPillLabel(careerOps.key)}</span>
          </div>
        ) : (
          <>
            <span className="job-table-stars" aria-label={`Rating ${stars.replace(/☆/g, "").length} of 5`}>{stars}</span>
            <span className={`job-table-match-label job-table-match-label--${careerOps.key}`}>{careerOps.label}</span>
          </>
        )}
      </td>
      <td className="job-table-loc" title={job.location}>{locationShort(job.location)}</td>
      <td className="job-table-comp" title={`Competition score: ${job.competition_score ?? 0}`}>
        {compLabel(job.competition_score)}
      </td>
      <td className="job-table-level">{job.level || "—"}</td>
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
                title="Apply"
                onClick={() => onSaveJob?.(job, "apply")}
              >
                {savedFeedback === "apply" ? "Moved ✓" : "Apply"}
              </a>
            ) : null}
            {job.job_url && onSaveJob && (
              <button
                type="button"
                className={`job-table-board-apply${savedFeedback === "click" ? " is-logged" : ""}`}
                onClick={() => saveJob("click")}
                title="Move this posting to Clicked Jobs"
              >
                {savedFeedback === "click" ? "Moved ✓" : "Click"}
              </button>
            )}
            <button
              type="button"
              className="job-table-board-apply"
              title="Copy referral message"
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
                className={`job-table-board-apply${savedFeedback === "add" ? " is-logged" : ""}`}
                title="Add to Atriveo tracker and move to Clicked Jobs"
                onClick={() => {
                  if (onSaveJob) saveJob("add");
                  else onAddToTracker(job.job_url, title, co, { location: job.location || null });
                }}
              >
                {savedFeedback === "add" ? "Moved ✓" : trackerCopy}
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
                onClick={() => onSaveJob?.(job, "apply")}
              >
                Apply
              </a>
            ) : null}
            {job.job_url && onSaveJob && (
              <button type="button" className="job-table-action" onClick={() => saveJob("click")}>Click</button>
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
                onClick={() => {
                  if (onSaveJob) saveJob("add");
                  else onAddToTracker(job.job_url, title, co, { location: job.location || null });
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
          <button
            type="button"
            className={`job-table-select${allSelected ? " is-selected" : ""}`}
            onClick={() => onGroupSelectAll(group.jobs)}
            aria-pressed={allSelected}
            title={allSelected ? "Deselect all roles" : "Select all roles"}
          >
            {allSelected ? "✓" : ""}
          </button>
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
      <td className="job-table-comp" title={`Competition score: ${top.competition_score ?? 0}`}>
        {compLabel(top.competition_score)}
      </td>
      <td className="job-table-level">{top.level || "—"}</td>
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
  variant?: "default" | "board";
  sortBy?: SortBy;
  sortDir?: SortDir;
  onSortColumn?: (column: SortBy) => void;
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
  variant = "default",
  sortBy,
  sortDir,
  onSortColumn,
}: Props) {
  const groups = useMemo(
    () => (groupByCompany ? groupJobsByCompany(jobs) : []),
    [jobs, groupByCompany],
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

  return (
    <div className={wrapClass}>
      <table className={tableClass}>
        {variant === "board" && (
          <colgroup>
            <col className="col-check" />
            <col className="col-num" />
            <col className="col-score" />
            <col className="col-role" />
            <col className="col-rating" />
            <col className="col-loc" />
            <col className="col-comp" />
            <col className="col-level" />
            <col className="col-posted" />
            <col className="col-actions" />
          </colgroup>
        )}
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>#</th>
            {variant === "board" && onSortColumn ? (
              <>
                <SortableHeader label="Score" column="score" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Role & Company" column="company" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Rating" column="rating" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Location" column="location" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Comp" column="comp" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Level" column="level" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
                <SortableHeader label="Posted" column="time" sortBy={sortBy} sortDir={sortDir} onSort={onSortColumn} />
              </>
            ) : (
              <>
                <th>Score</th>
                <th>{variant === "board" ? "Role & Company" : "Job"}</th>
                <th>{variant === "board" ? "Rating" : "Match"}</th>
                <th>Location</th>
                <th>Comp</th>
                <th>Level</th>
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
                const showBand = group.jobs.length > 1;
                const priorCount = groups.slice(0, gi).reduce((acc, g) => acc + g.jobs.length, 0);
                return (
                  <Fragment key={group.company}>
                    {showBand && <CompanyBandRow group={group} />}
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
                        nested={showBand}
                        board
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
                showCompany
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
