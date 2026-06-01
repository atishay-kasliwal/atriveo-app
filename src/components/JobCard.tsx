import { useState } from "react";
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
  if (s >= 150) return { gradient: "linear-gradient(135deg,#7c3aed,#a855f7)", solid: "#7c3aed", glow: "rgba(124,58,237,0.28)", bg: "rgba(124,58,237,0.035)", bgHover: "rgba(124,58,237,0.07)" };
  if (s >= 100) return { gradient: "linear-gradient(135deg,#2563eb,#3b82f6)", solid: "#2563eb", glow: "rgba(37,99,235,0.28)", bg: "rgba(37,99,235,0.035)", bgHover: "rgba(37,99,235,0.07)" };
  if (s >= 70)  return { gradient: "linear-gradient(135deg,#059669,#10b981)", solid: "#059669", glow: "rgba(5,150,105,0.28)", bg: "rgba(5,150,105,0.035)", bgHover: "rgba(5,150,105,0.07)" };
  if (s >= 40)  return { gradient: "linear-gradient(135deg,#d97706,#f59e0b)", solid: "#d97706", glow: "rgba(217,119,6,0.25)", bg: "rgba(217,119,6,0.03)", bgHover: "rgba(217,119,6,0.06)" };
  return { gradient: "linear-gradient(135deg,#64748b,#94a3b8)", solid: "#94a3b8", glow: "rgba(100,116,139,0.2)", bg: "rgba(100,116,139,0.02)", bgHover: "rgba(100,116,139,0.04)" };
}

interface Props {
  job: Job;
  index?: number;
  applyRecord: ApplyRecord | null;
  onApplyClick: (jobUrl: string, title: string, company: string) => void;
  onExcludeCompany?: (company: string) => void;
  onCartToggle?: (job: Job) => void;
  isInCart?: boolean;
}

export default function JobCard({ job, index, applyRecord, onApplyClick, onExcludeCompany }: Props) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const color = avatarColor(co);
  const isApplied = Boolean(applyRecord);
  const t = tier(score);

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

  return (
    <div
      className="job-tile"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(160deg, ${t.bgHover} 0%, #fff 55%)`
          : `linear-gradient(160deg, ${t.bg} 0%, #fff 55%)`,
        borderRadius: 12,
        border: `1px solid ${hovered ? t.solid + "44" : "rgba(0,0,0,0.07)"}`,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.18s ease",
        boxShadow: hovered
          ? `0 8px 24px ${t.glow}, 0 2px 8px rgba(0,0,0,0.06)`
          : "0 1px 4px rgba(0,0,0,0.05)",
        transform: hovered ? "translateY(-2px)" : "none",
        overflow: "hidden",
        cursor: "default",
        minWidth: 0,
        position: "relative",
      }}
    >
      <div className="job-tile-top">
        <div className="job-tile-lead">
          {index !== undefined && (
            <span className="job-tile-rank">#{index}</span>
          )}
          <div className="job-tile-avatar" style={{ background: color }}>
            {co.charAt(0).toUpperCase()}
          </div>
        </div>

        <div className="job-tile-score-group">
          {onExcludeCompany && (
            <button
              className="job-tile-exclude"
              onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
              title={`Block "${co}"`}
            >⊘</button>
          )}
          <div
            className="job-tile-score"
            style={{
            background: t.gradient,
            boxShadow: hovered ? `0 3px 10px ${t.glow}` : `0 1px 4px ${t.glow}`,
            }}
          >
            ★{score}
          </div>
        </div>
      </div>

      <div className="job-tile-title">
        {title}
      </div>

      <div className="job-tile-company" style={{ color }}>
        {co}
      </div>

      <div className="job-tile-meta">
        🕐 {dateLabel}{locationShort ? ` · ${locationShort}` : ""}
      </div>

      {isApplied && (
        <div className="job-tile-applied">
          ✓ Applied ×{applyRecord?.clicks}
        </div>
      )}

      <div className="job-tile-divider" />

      <div className="job-tile-actions">
        {!isApplied && job.job_url && (
          <button
            className="job-tile-action job-tile-action--click"
            onClick={(e) => { e.preventDefault(); onApplyClick(job.job_url, title, co); }}
          >Click</button>
        )}
        <button
          className={`job-tile-action job-tile-action--message${msgCopied ? " is-copied" : ""}`}
          onClick={handleMsg}
        >
          {msgCopied ? "✓ Copied" : "Msg"}
        </button>
        {job.job_url ? (
          <a
            className={`job-tile-action job-tile-action--apply${isApplied ? " is-applied" : ""}`}
            href={job.job_url}
            target="_blank"
            rel="noopener"
            onClick={() => onApplyClick(job.job_url, title, co)}
            style={{
              background: isApplied ? "linear-gradient(135deg,#16a34a,#059669)" : t.gradient,
              color: "#fff",
              boxShadow: hovered ? `0 3px 10px ${t.glow}` : "none",
            }}
          >
            {isApplied ? "Applied ✓" : "Apply ↗"}
          </a>
        ) : (
          <span className="job-tile-action job-tile-action--empty">—</span>
        )}
      </div>
    </div>
  );
}
