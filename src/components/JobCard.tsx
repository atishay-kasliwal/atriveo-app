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
  if (s >= 150) return { gradient: "linear-gradient(135deg,#7c3aed,#a855f7)", solid: "#7c3aed", glow: "rgba(124,58,237,0.28)", bg: "rgba(124,58,237,0.035)" };
  if (s >= 100) return { gradient: "linear-gradient(135deg,#2563eb,#3b82f6)", solid: "#2563eb", glow: "rgba(37,99,235,0.28)", bg: "rgba(37,99,235,0.035)" };
  if (s >= 70)  return { gradient: "linear-gradient(135deg,#059669,#10b981)", solid: "#059669", glow: "rgba(5,150,105,0.28)", bg: "rgba(5,150,105,0.035)" };
  if (s >= 40)  return { gradient: "linear-gradient(135deg,#d97706,#f59e0b)", solid: "#d97706", glow: "rgba(217,119,6,0.25)", bg: "rgba(217,119,6,0.03)" };
  return { gradient: "linear-gradient(135deg,#64748b,#94a3b8)", solid: "#94a3b8", glow: "rgba(100,116,139,0.2)", bg: "rgba(100,116,139,0.02)" };
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(160deg, ${t.bg.replace("0.035", "0.07")} 0%, #fff 55%)`
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
      {/* Top row: rank + score badge */}
      <div style={{
        padding: "10px 10px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {index !== undefined && (
            <span style={{
              fontSize: 10, fontWeight: 800, color: "#94a3b8",
              letterSpacing: "0.04em",
            }}>#{index}</span>
          )}
          {/* Avatar with color ring */}
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: color, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 12,
            boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${color}55`,
          }}>
            {co.charAt(0).toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onExcludeCompany && (
            <button
              onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
              style={{ border: "none", background: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, opacity: hovered ? 1 : 0, transition: "opacity 0.15s" }}
              title={`Block "${co}"`}
            >⊘</button>
          )}
          {/* Score badge */}
          <div style={{
            background: t.gradient,
            color: "#fff",
            borderRadius: 20,
            padding: "3px 8px",
            fontWeight: 800,
            fontSize: 11.5,
            letterSpacing: "-0.2px",
            whiteSpace: "nowrap",
            boxShadow: hovered ? `0 3px 10px ${t.glow}` : `0 1px 4px ${t.glow}`,
            transition: "box-shadow 0.18s",
          }}>
            ★{score}
          </div>
        </div>
      </div>

      {/* Job title */}
      <div style={{
        padding: "8px 10px 0",
        fontSize: 13,
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

      {/* Company */}
      <div style={{
        padding: "3px 10px 0",
        fontSize: 10.5,
        fontWeight: 600,
        color: color,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        opacity: 0.85,
      }}>
        {co}
      </div>

      {/* Meta */}
      <div style={{
        padding: "4px 10px 0",
        fontSize: 10,
        color: "#94a3b8",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        🕐 {dateLabel}{locationShort ? ` · ${locationShort}` : ""}
      </div>

      {/* Applied badge */}
      {isApplied && (
        <div style={{
          margin: "6px 10px 0",
          fontSize: 10, fontWeight: 700, color: "#16a34a",
          background: "rgba(22,163,74,0.08)",
          border: "1px solid rgba(22,163,74,0.2)",
          borderRadius: 6, padding: "2px 7px", textAlign: "center",
        }}>
          ✓ Applied ×{applyRecord?.clicks}
        </div>
      )}

      {/* Divider */}
      <div style={{ margin: "8px 10px 0", height: 1, background: "rgba(0,0,0,0.05)" }} />

      {/* Action bar */}
      <div style={{ padding: "7px 8px 8px", display: "flex", gap: 4 }}>
        {!isApplied && job.job_url && (
          <button
            onClick={(e) => { e.preventDefault(); onApplyClick(job.job_url, title, co); }}
            style={{
              height: 26, padding: "0 8px", borderRadius: 6, flexShrink: 0,
              border: "1px solid rgba(0,0,0,0.1)",
              background: "rgba(255,255,255,0.8)",
              color: "#475569", cursor: "pointer", fontSize: 10.5, fontWeight: 700,
              backdropFilter: "blur(4px)",
              transition: "all 0.15s",
            }}
          >Click</button>
        )}
        <button
          onClick={handleMsg}
          style={{
            flex: 1, height: 26, borderRadius: 6,
            border: "1px solid rgba(99,102,241,0.2)",
            background: msgCopied ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.05)",
            color: "#6366f1", fontSize: 10.5, fontWeight: 700,
            cursor: "pointer", transition: "all 0.15s",
          }}
        >
          {msgCopied ? "✓ Copied" : "Msg"}
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
              background: isApplied ? "linear-gradient(135deg,#16a34a,#059669)" : t.gradient,
              color: "#fff", fontSize: 10.5, fontWeight: 700,
              textDecoration: "none", transition: "all 0.18s",
              boxShadow: hovered ? `0 3px 10px ${t.glow}` : "none",
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
