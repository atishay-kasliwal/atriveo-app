import { useState } from "react";
import type { Job } from "../types";
import type { ApplyMetadata, ApplyRecord } from "../hooks/useApplyTracker";
import { isTop500 } from "../data/top500";

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

const AVATAR_COLORS = [
  "#4f4f47","#5f5e54","#77766a","#69725a","#7a624a","#8d534c","#6f6855","#3f4039",
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

function scorePctClass(p: number) {
  return p >= 60 ? "match-hi" : p >= 35 ? "match-md" : "match-lo";
}

function scoreColor(s: number) {
  return s >= 12 ? "score-hi" : s >= 6 ? "score-md" : "";
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function finiteOrZero(value: unknown): number {
  return finiteOrNull(value) ?? 0;
}


interface Props {
  job: Job;
  index: number;
  applyRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onExcludeCompany?: (company: string) => void;
}

export default function JobRow({ job, index, applyRecord, onAddToTracker, onExcludeCompany }: Props) {
  const [msgCopied, setMsgCopied] = useState(false);

  function handleMessageClick(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 1200);
    });
  }
  const co = job.company || "—";
  const title = job.title || "—";
  const initial = co.charAt(0).toUpperCase();
  const color = avatarColor(co);
  const score = finiteOrZero(job.score);
  const ats = finiteOrNull(job.ats_score ?? job.score_pct);
  const fit = finiteOrNull(job.fit_score);
  const lvl = job.level || "Entry";
  const exp = fmtExp(job.min_exp, job.max_exp);
  const batch = fmtBatch(job.batch_time);
  const term = (job.search_term || "").replace(/ engineer$/i, "").trim();
  const tier = ats !== null ? (ats >= 60 ? " tier-hi" : ats >= 35 ? " tier-md" : " tier-lo") : "";
  const top = index < 3 && score >= 8;
  const posted = fmtDate(job.date_posted);
  const isNew = posted === "Today";
  const isApplied = Boolean(applyRecord);
  const applyClicks = applyRecord?.clicks ?? 0;
  const appliedAt = applyRecord?.lastAppliedAt ? fmtClickTime(applyRecord.lastAppliedAt) : "";
  const isTopCo = isTop500(co);

  return (
    <div className={`job-card${top ? " top" : ""}${tier}${isApplied ? " applied" : ""}${isTopCo ? " top500" : ""}`}>
      <div className="job-score">
        <span className="star">★</span>
        <span className={scoreColor(score)}>{score}</span>
      </div>
      <div className="job-company-col">
        <span className="job-company-name" title={co}>{co}</span>
        {onExcludeCompany && (
          <button
            className="exclude-btn"
            title={`Block "${co}" from feed`}
            onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
          >⊘</button>
        )}
      </div>
      <div className="avatar" style={{ background: color }}>{initial}</div>
      <div className="job-main">
        <div className="job-title-row">
          <span className="job-title-text" title={title}>{title}</span>
          <span className="job-title-badges">
            {isNew && <span className="badge badge-new">NEW</span>}
            {isApplied && <span className="badge badge-applied">Tracked {applyClicks}x</span>}
            {term && <span className="badge badge-term">{term}</span>}
          </span>
        </div>
        <div className="job-meta">
          <span className="job-co-mobile" title={co}>{co}</span>
          <span className="sep mobile-sep">·</span>
          <span title={job.location}>{job.location || "Remote"}</span>
          {exp && <><span className="sep">·</span><span className="exp-badge">{exp}</span></>}
          {posted && !isNew && <><span className="sep">·</span><span className="job-date">{posted}</span></>}
          {batch && <><span className="sep">·</span><span className="job-batch">⏱ {batch}</span></>}
          {isApplied && appliedAt && (
            <><span className="sep">·</span><span className="apply-inline-meta">Tracked {applyClicks}x · {appliedAt}</span></>
          )}
        </div>
      </div>
      <div className="score-col ats-col">
        {ats !== null
          ? <span className={`match-pct ${scorePctClass(ats)}`}>{ats}%</span>
          : <span className="score-pending">—</span>}
      </div>
      <div className="score-col fit-col">
        {fit !== null
          ? <span className={`match-pct ${scorePctClass(fit)}`}>{fit}%</span>
          : <span className="score-pending">—</span>}
      </div>
      <div className="job-level-col" style={{ display: "flex", justifyContent: "flex-start" }}>
        <span className={`badge ${levelClass(lvl)}`}>{lvl}</span>
      </div>
      <div className="job-apply-col">
        {!isApplied && job.job_url && (
          <button
            className="mark-btn tracker-add-btn"
            title="Add to Atriveo tracker"
            onClick={(e) => { e.preventDefault(); onAddToTracker(job.job_url, title, co, { location: job.location || null }); }}
          >Add to tracker</button>
        )}
        <button className="message-btn" onClick={handleMessageClick}>
          {msgCopied ? "Copied!" : "Msg"}
        </button>
        {job.job_url ? (
          <a
            className={`apply-btn${isApplied ? " applied" : ""}`}
            href={job.job_url}
            target="_blank"
            rel="noopener"
          >
            {isApplied ? "Open ↗" : "Apply ↗"}
          </a>
        ) : (
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>—</span>
        )}
      </div>
    </div>
  );
}
