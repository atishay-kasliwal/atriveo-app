import type { Job } from "../types";
import type { ApplyRecord } from "../hooks/useApplyTracker";

const AVATAR_COLORS = [
  "#7c3aed","#0ea5e9","#059669","#d97706","#db2777","#0891b2","#16a34a","#9333ea",
];
const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

function avatarColor(s: string) {
  const code = [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function fmtExp(min: number | null, max: number | null) {
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} yrs`;
  if (min) return `${min}+ yrs`;
  if (max) return `≤${max} yrs`;
  return null;
}

function fmtBatch(iso: string) {
  if (!iso) return null;
  const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso || iso === "null") return null;
  const normalized = TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const yest = new Date(now.getTime() - 86400000);
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtClickTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function levelClass(l: string) {
  return l === "New Grad" ? "badge-ng" : l === "Mid" ? "badge-mid" : "badge-entry";
}

function matchPctClass(p: number) {
  return p >= 60 ? "match-hi" : p >= 40 ? "match-md" : "match-lo";
}

function scoreColor(s: number) {
  return s >= 12 ? "score-hi" : s >= 6 ? "score-md" : "";
}


interface Props {
  job: Job;
  index: number;
  applyRecord: ApplyRecord | null;
  onApplyClick: (jobUrl: string, title: string, company: string) => void;
  onTrackerStatus: (jobUrl: string, status: "applied" | "rejected") => void;
}

export default function JobRow({ job, index, applyRecord, onApplyClick, onTrackerStatus }: Props) {
  const co = job.company || "—";
  const title = job.title || "—";
  const initial = co.charAt(0).toUpperCase();
  const color = avatarColor(co);
  const score = job.score ?? 0;
  const pct = job.score_pct ?? null;
  const lvl = job.level || "Entry";
  const exp = fmtExp(job.min_exp, job.max_exp);
  const batch = fmtBatch(job.batch_time);
  const term = (job.search_term || "").replace(/ engineer$/i, "").trim();
  const tier = pct !== null ? (pct >= 60 ? " tier-hi" : pct >= 35 ? " tier-md" : " tier-lo") : "";
  const top = index < 3 && score >= 8;
  const posted = fmtDate(job.date_posted);
  const isNew = posted === "Today";
  const trackerStatus = applyRecord?.trackerStatus ?? null;
  const isApplied = Boolean(applyRecord);
  const applyClicks = applyRecord?.clicks ?? 0;
  const appliedAt = applyRecord?.lastAppliedAt ? fmtClickTime(applyRecord.lastAppliedAt) : "";

  return (
    <div className={`job-card${top ? " top" : ""}${tier}`}>
      <div className="row-num">{index + 1}</div>
      <div className="avatar" style={{ background: color }}>{initial}</div>
      <div className="job-main">
        <div className="job-title-row">
          <span className="job-title-text" title={title}>{title}</span>
          <span className="job-title-badges">
            {isNew && <span className="badge badge-new">NEW</span>}
            {isApplied && <span className="badge badge-applied">Clicked {applyClicks}x</span>}
            {term && <span className="badge badge-term">{term}</span>}
            <span className="badge badge-src badge-src-linkedin">LinkedIn</span>
          </span>
        </div>
        <div className="job-meta">
          <span className="job-company" title={co}>{co}</span>
          <span className="sep">·</span>
          <span title={job.location}>{job.location || "Remote"}</span>
          {exp && <><span className="sep">·</span><span className="exp-badge">{exp}</span></>}
          {posted && !isNew && <><span className="sep">·</span><span className="job-date">{posted}</span></>}
          {batch && <><span className="sep">·</span><span className="job-batch">⏱ {batch}</span></>}
          {isApplied && appliedAt && (
            <><span className="sep">·</span><span className="apply-inline-meta">Clicked {applyClicks}x · {appliedAt}</span></>
          )}
        </div>
      </div>
      <div className="job-score">
        <span className="star">★</span>
        <span className={scoreColor(score)}>{score}</span>
      </div>
      <div className="match-line">
        {pct !== null
          ? <span className={`match-pct ${matchPctClass(pct)}`}>{pct}%</span>
          : <span>—</span>}
      </div>
      <div className="job-tag-col">
        {term
          ? <span className="badge badge-term">{term}</span>
          : <span style={{ color: "var(--muted)", fontSize: "11px" }}>—</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span className={`badge ${levelClass(lvl)}`}>{lvl}</span>
      </div>
      <div className="job-apply-col">
        {!job.job_url ? (
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>—</span>
        ) : trackerStatus === "applied" ? (
          <span className="tracker-btn tracker-applied">Applied ✓</span>
        ) : trackerStatus === "rejected" ? (
          <span className="tracker-btn tracker-rejected">Rejected</span>
        ) : isApplied ? (
          <div className="tracker-actions">
            <button className="tracker-btn tracker-right" onClick={() => onTrackerStatus(job.job_url, "applied")}>✓ Right</button>
            <button className="tracker-btn tracker-wrong" onClick={() => onTrackerStatus(job.job_url, "rejected")}>✗ Wrong</button>
          </div>
        ) : (
          <a
            className="apply-btn"
            href={job.job_url}
            target="_blank"
            rel="noopener"
            onClick={() => onApplyClick(job.job_url, title, co)}
          >
            Apply ↗
          </a>
        )}
      </div>
    </div>
  );
}
