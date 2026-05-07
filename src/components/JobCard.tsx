import { useState } from "react";
import type { Job } from "../types";
import type { ApplyRecord } from "../hooks/useApplyTracker";
import { isTop500 } from "../data/top500";

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

function scorePctClass(p: number) {
  return p >= 60 ? "match-hi" : p >= 35 ? "match-md" : "match-lo";
}

function levelClass(l: string) {
  return l === "New Grad" ? "badge-ng" : l === "Mid" ? "badge-mid" : "badge-entry";
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface Props {
  job: Job;
  applyRecord: ApplyRecord | null;
  onApplyClick: (jobUrl: string, title: string, company: string) => void;
  onExcludeCompany?: (company: string) => void;
}

export default function JobCard({ job, applyRecord, onApplyClick, onExcludeCompany }: Props) {
  const [msgCopied, setMsgCopied] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const ats = finiteOrNull(job.ats_score ?? job.score_pct);
  const fit = finiteOrNull(job.fit_score);
  const lvl = job.level || "Entry";
  const color = avatarColor(co);
  const isTopCo = isTop500(co);
  const isApplied = Boolean(applyRecord);

  const dateLabel = job.scraped_date
    ? scrapedDateLabel(job.scraped_date)
    : fmtDate(job.batch_time || job.date_posted);

  function handleMsg(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(buildReferralMessage(job)).then(() => {
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 1200);
    });
  }

  return (
    <div style={{
      background: "var(--surface-2)",
      border: `1px solid ${isApplied ? "rgba(22,163,74,0.3)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    }}>
      {/* Header: avatar + company + score */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 13,
        }}>
          {co.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {co}
            </span>
            {isTopCo && <span style={{ fontSize: 9, background: "var(--blue-lo)", color: "var(--blue)", borderRadius: 3, padding: "1px 4px", fontWeight: 700, flexShrink: 0 }}>TOP 500</span>}
            {onExcludeCompany && (
              <button
                title={`Block "${co}"`}
                onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
                style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: "0 2px", flexShrink: 0 }}
              >⊘</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{job.location || "Remote"}</div>
        </div>
        <div style={{
          flexShrink: 0, fontWeight: 800, fontSize: 17,
          color: score >= 150 ? "#7c3aed" : score >= 100 ? "#0ea5e9" : "var(--blue)",
          fontVariantNumeric: "tabular-nums",
        }}>
          ★{score}
        </div>
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
        {title}
        {isApplied && (
          <span style={{ marginLeft: 6, fontSize: 9, background: "rgba(22,163,74,0.1)", color: "var(--green)", borderRadius: 3, padding: "1px 5px", fontWeight: 700, verticalAlign: "middle" }}>
            Clicked {applyRecord?.clicks}x
          </span>
        )}
      </div>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Date</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{dateLabel}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Level</span>
          <span className={`badge ${levelClass(lvl)}`}>{lvl}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>ATS</span>
          {ats !== null
            ? <span className={`match-pct ${scorePctClass(ats)}`}>{ats}%</span>
            : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Fit</span>
          {fit !== null
            ? <span className={`match-pct ${scorePctClass(fit)}`}>{fit}%</span>
            : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
        {!isApplied && job.job_url && (
          <button
            className="mark-btn"
            title="Mark as applied without opening"
            onClick={(e) => { e.preventDefault(); onApplyClick(job.job_url, title, co); }}
          >✓</button>
        )}
        <button className="message-btn" style={{ flex: 1 }} onClick={handleMsg}>
          {msgCopied ? "Copied!" : "Message"}
        </button>
        {job.job_url ? (
          <a
            className={`apply-btn${isApplied ? " applied" : ""}`}
            style={{ flex: 1, textAlign: "center", textDecoration: "none" }}
            href={job.job_url}
            target="_blank"
            rel="noopener"
            onClick={() => onApplyClick(job.job_url, title, co)}
          >
            {isApplied ? "Applied ✓" : "Apply ↗"}
          </a>
        ) : (
          <span style={{ flex: 1, fontSize: 11, color: "var(--muted)", textAlign: "center" }}>—</span>
        )}
      </div>
    </div>
  );
}
