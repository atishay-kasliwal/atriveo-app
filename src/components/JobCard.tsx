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

function scoreTier(s: number): { gradient: string; solid: string; label: string } {
  if (s >= 150) return { gradient: "linear-gradient(135deg,#7c3aed,#6d28d9)", solid: "#7c3aed", label: "S" };
  if (s >= 100) return { gradient: "linear-gradient(135deg,#0ea5e9,#2563eb)", solid: "#2563eb", label: "A" };
  if (s >= 70)  return { gradient: "linear-gradient(135deg,#059669,#16a34a)", solid: "#16a34a", label: "B" };
  if (s >= 40)  return { gradient: "linear-gradient(135deg,#d97706,#ea580c)", solid: "#d97706", label: "C" };
  return { gradient: "linear-gradient(135deg,#94a3b8,#64748b)", solid: "#94a3b8", label: "D" };
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
  const tier = scoreTier(score);

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#f8faff" : "#fff",
        borderRadius: 10,
        border: `1px solid ${isApplied ? "rgba(22,163,74,0.4)" : hovered ? "rgba(37,99,235,0.2)" : "#e8edf3"}`,
        borderLeft: `3px solid ${isApplied ? "#16a34a" : tier.solid}`,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.15s ease",
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.07)" : "0 1px 3px rgba(0,0,0,0.04)",
        transform: hovered ? "translateY(-1px)" : "none",
        overflow: "hidden",
        cursor: "default",
        minWidth: 0,
      }}
    >
      {/* Header: rank + avatar + score */}
      <div style={{
        padding: "9px 10px 0 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {index !== undefined && (
            <span style={{
              fontSize: 10, fontWeight: 800, color: "#94a3b8",
              minWidth: 14, flexShrink: 0,
            }}>#{index}</span>
          )}
          <div style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: color, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 12,
          }}>
            {co.charAt(0).toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onExcludeCompany && (
            <button
              onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
              style={{ border: "none", background: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
              title={`Block "${co}"`}
            >⊘</button>
          )}
          <div style={{
            background: tier.gradient,
            color: "#fff",
            borderRadius: 6,
            padding: "3px 7px",
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: "-0.3px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            ★{score}
          </div>
        </div>
      </div>

      {/* Company name — full, wraps to 2 lines */}
      <div style={{
        padding: "5px 10px 0 10px",
        fontSize: 10.5,
        fontWeight: 700,
        color: "#64748b",
        lineHeight: 1.3,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      } as React.CSSProperties}>
        {co}
      </div>

      {/* Job title — hero element */}
      <div style={{
        padding: "5px 10px 0 10px",
        fontSize: 12.5,
        fontWeight: 700,
        color: "#0f172a",
        lineHeight: 1.4,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        flex: 1,
      } as React.CSSProperties}>
        {title}
      </div>

      {/* Meta: date · location */}
      <div style={{
        padding: "5px 10px 0 10px",
        fontSize: 10,
        color: "#94a3b8",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        🕐 {dateLabel}{locationShort ? ` · ${locationShort}` : ""}
      </div>

      {isApplied && (
        <div style={{
          margin: "5px 10px 0",
          fontSize: 10, fontWeight: 700, color: "#16a34a",
          background: "rgba(22,163,74,0.08)",
          border: "1px solid rgba(22,163,74,0.2)",
          borderRadius: 5, padding: "2px 6px", textAlign: "center",
        }}>
          ✓ Applied ×{applyRecord?.clicks}
        </div>
      )}

      {/* Action bar */}
      <div style={{ padding: "8px 8px 8px", display: "flex", gap: 4, marginTop: "auto" }}>
        {onCartToggle && (
          <button
            onClick={(e) => { e.preventDefault(); onCartToggle(job); }}
            title={isInCart ? "Remove from cart" : "Save"}
            style={{
              flexShrink: 0, width: 26, height: 26, borderRadius: 6,
              border: isInCart ? "1px solid rgba(234,88,12,0.4)" : "1px solid #e2e8f0",
              background: isInCart ? "rgba(234,88,12,0.08)" : "#f8fafc",
              color: isInCart ? "#ea580c" : "#94a3b8",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            {isInCart
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            }
          </button>
        )}
        {!isApplied && job.job_url && (
          <button
            onClick={(e) => { e.preventDefault(); onApplyClick(job.job_url, title, co); }}
            style={{
              height: 26, padding: "0 7px", borderRadius: 6, flexShrink: 0,
              border: "1px solid #e2e8f0", background: "#f8fafc",
              color: "#475569", cursor: "pointer", fontSize: 10.5, fontWeight: 700,
              transition: "all 0.15s",
            }}
          >Click</button>
        )}
        <button
          onClick={handleMsg}
          style={{
            flex: 1, height: 26, borderRadius: 6,
            border: "1px solid rgba(99,102,241,0.25)",
            background: msgCopied ? "rgba(99,102,241,0.1)" : "transparent",
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
              flex: 2, height: 26, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isApplied ? "linear-gradient(135deg,#16a34a,#059669)" : tier.gradient,
              color: "#fff", fontSize: 10.5, fontWeight: 700,
              textDecoration: "none", transition: "all 0.15s",
            }}
          >
            {isApplied ? "Applied ✓" : "Apply ↗"}
          </a>
        ) : (
          <span style={{ flex: 2, fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center" }}>—</span>
        )}
      </div>
    </div>
  );
}
