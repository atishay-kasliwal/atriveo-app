import type { Job } from "../types";

const AVATAR_COLORS = [
  "#7c3aed","#0ea5e9","#059669","#d97706","#db2777","#0891b2","#16a34a","#9333ea",
];

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
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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

function compClass(c: number) {
  return c >= 15 ? "comp-hi" : c >= 8 ? "comp-md" : "comp-lo";
}

interface Props {
  job: Job;
  index: number;
}

export default function JobRow({ job, index }: Props) {
  const co = job.company || "—";
  const title = job.title || "—";
  const initial = co.charAt(0).toUpperCase();
  const color = avatarColor(co);
  const score = job.score ?? 0;
  const pct = job.score_pct ?? null;
  const lvl = job.level || "Entry";
  const exp = fmtExp(job.min_exp, job.max_exp);
  const batch = fmtBatch(job.batch_time);
  const comp = job.competition_score ?? null;
  const term = (job.search_term || "").replace(/ engineer$/i, "").trim();
  const tier = pct !== null ? (pct >= 60 ? " tier-hi" : pct >= 35 ? " tier-md" : " tier-lo") : "";
  const top = index < 3 && score >= 8;

  return (
    <div className={`job-card${top ? " top" : ""}${tier}`}>
      <div className="row-num">{index + 1}</div>
      <div className="avatar" style={{ background: color }}>{initial}</div>
      <div className="job-main">
        <div className="job-title-row">
          <span className="job-title-text" title={title}>{title}</span>
          <span className="job-title-badges">
            {term && <span className="badge badge-term">{term}</span>}
            <span className="badge badge-src badge-src-linkedin">LinkedIn</span>
          </span>
        </div>
        <div className="job-meta">
          <span className="job-company" title={co}>{co}</span>
          <span className="sep">·</span>
          <span title={job.location}>{job.location || "Remote"}</span>
          {exp && <><span className="sep">·</span><span className="exp-badge">{exp}</span></>}
          {batch && <><span className="sep">·</span><span className="job-batch">⏱ {batch}</span></>}
        </div>
        {job.summary && <div className="job-summary">{job.summary}</div>}
      </div>
      <div className="match-line">
        {pct !== null
          ? <span className={`match-pct ${matchPctClass(pct)}`}>{pct}%</span>
          : <span>—</span>}
      </div>
      <div className="job-score">
        <span className="star">★</span>
        <span className={scoreColor(score)}>{score}</span>
      </div>
      <div className="job-comp">
        {comp !== null
          ? <span className={`comp-val ${compClass(comp)}`}>{comp}</span>
          : <span style={{ color: "var(--muted)" }}>—</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span className={`badge ${levelClass(lvl)}`}>{lvl}</span>
      </div>
      <div className="job-apply-col">
        {job.job_url
          ? <a className="apply-btn" href={job.job_url} target="_blank" rel="noopener">Apply ↗</a>
          : <span style={{ fontSize: "11px", color: "var(--muted)" }}>—</span>}
      </div>
    </div>
  );
}
