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


function scoreBg(s: number) {
  if (s >= 150) return { bg: "linear-gradient(135deg,#7c3aed,#6d28d9)", text: "#fff", bar: "#7c3aed" };
  if (s >= 100) return { bg: "linear-gradient(135deg,#0ea5e9,#2563eb)", text: "#fff", bar: "#0ea5e9" };
  if (s >= 70)  return { bg: "linear-gradient(135deg,#059669,#16a34a)", text: "#fff", bar: "#059669" };
  return { bg: "linear-gradient(135deg,#64748b,#475569)", text: "#fff", bar: "#64748b" };
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

export default function JobCard({ job, index, applyRecord, onApplyClick, onExcludeCompany, onCartToggle, isInCart }: Props) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const color = avatarColor(co);
  const isApplied = Boolean(applyRecord);
  const sc = scoreBg(score);

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
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(248,250,255,1)" : "#fff",
        border: `1px solid ${isApplied ? "rgba(22,163,74,0.35)" : hovered ? "rgba(37,99,235,0.25)" : "#e8edf3"}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: hovered
          ? "0 6px 20px rgba(37,99,235,0.09), 0 1px 4px rgba(0,0,0,0.05)"
          : "0 1px 3px rgba(0,0,0,0.05)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "all 0.16s ease",
        cursor: "default",
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Score-colored top stripe */}
      <div style={{
        height: 3,
        background: sc.bg,
        flexShrink: 0,
      }} />

      {/* Card body */}
      <div style={{ padding: "10px 10px 0", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>

        {/* Header: number + avatar + company + score */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          {index !== undefined && (
            <div style={{
              flexShrink: 0, width: 18, height: 18, borderRadius: 5,
              background: "rgba(100,116,139,0.1)", color: "#64748b",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 9.5, marginTop: 1,
            }}>
              {index}
            </div>
          )}
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: color, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 13,
          }}>
            {co.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{
                fontWeight: 700, fontSize: 11.5, color: "#0f172a",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: "100%", display: "block",
              }}
                title={co}>
                {co}
              </span>
              {onExcludeCompany && (
                <button onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
                  style={{ border: "none", background: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}
                  title={`Block "${co}"`}>⊘</button>
              )}
            </div>
          </div>
          <div style={{
            flexShrink: 0,
            background: sc.bg,
            color: "#fff",
            borderRadius: 7,
            padding: "3px 6px",
            fontWeight: 800,
            fontSize: 11.5,
            letterSpacing: "-0.2px",
            whiteSpace: "nowrap",
          }}>
            ★{score}
          </div>
        </div>

        {/* Job title */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "#1e293b", lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        } as React.CSSProperties}>
          {title}
        </div>

        {/* Meta: date + location */}
        <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", flexWrap: "wrap", gap: "2px 6px" }}>
          <span>🕐 {dateLabel}</span>
          {job.location && <span>📍 {job.location}</span>}
        </div>


        {isApplied && (
          <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 6, padding: "3px 7px", textAlign: "center" }}>
            ✓ Applied ×{applyRecord?.clicks}
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div style={{ padding: "8px 10px 10px", display: "flex", gap: 5, marginTop: "auto" }}>
        {onCartToggle && (
          <button
            onClick={(e) => { e.preventDefault(); onCartToggle(job); }}
            title={isInCart ? "Remove from cart" : "Save to cart"}
            style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 7,
              border: isInCart ? "1px solid rgba(234,88,12,0.4)" : "1px solid #e2e8f0",
              background: isInCart ? "rgba(234,88,12,0.08)" : "#f8fafc",
              color: isInCart ? "#ea580c" : "#94a3b8",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            {isInCart ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            )}
          </button>
        )}
        {!isApplied && job.job_url && (
          <button
            onClick={(e) => { e.preventDefault(); onApplyClick(job.job_url, title, co); }}
            title="Mark as clicked"
            style={{
              flexShrink: 0, height: 28, padding: "0 8px", borderRadius: 7,
              border: "1px solid #e2e8f0", background: "#f8fafc",
              color: "#64748b", cursor: "pointer", fontSize: 10.5, fontWeight: 700,
              transition: "all 0.15s",
            }}
          >Click</button>
        )}
        <button
          onClick={handleMsg}
          style={{
            flex: 1, height: 28, borderRadius: 7,
            border: "1px solid rgba(99,102,241,0.3)",
            background: msgCopied ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.06)",
            color: "#6366f1", fontSize: 10.5, fontWeight: 700,
            cursor: "pointer", transition: "all 0.15s",
          }}
        >
          {msgCopied ? "✓" : "Msg"}
        </button>
        {job.job_url ? (
          <a
            href={job.job_url}
            target="_blank"
            rel="noopener"
            onClick={() => onApplyClick(job.job_url, title, co)}
            style={{
              flex: 2, height: 28, borderRadius: 7, textAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isApplied
                ? "linear-gradient(135deg,#16a34a,#059669)"
                : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", fontSize: 10.5, fontWeight: 700,
              textDecoration: "none", transition: "all 0.15s",
            }}
          >
            {isApplied ? "Applied ✓" : "Apply ↗"}
          </a>
        ) : (
          <span style={{ flex: 2, fontSize: 10, color: "#94a3b8", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>—</span>
        )}
      </div>
    </div>
  );
}
