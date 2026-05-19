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

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreBg(s: number) {
  if (s >= 150) return { bg: "linear-gradient(135deg,#7c3aed,#6d28d9)", text: "#fff" };
  if (s >= 100) return { bg: "linear-gradient(135deg,#0ea5e9,#2563eb)", text: "#fff" };
  if (s >= 70)  return { bg: "linear-gradient(135deg,#059669,#16a34a)", text: "#fff" };
  return { bg: "linear-gradient(135deg,#64748b,#475569)", text: "#fff" };
}

function atsBar(pct: number) {
  if (pct >= 60) return "#16a34a";
  if (pct >= 35) return "#0891b2";
  return "#ea580c";
}

function levelColors(l: string): { bg: string; color: string; border: string } {
  if (l === "New Grad") return { bg: "rgba(22,163,74,0.1)", color: "#16a34a", border: "rgba(22,163,74,0.25)" };
  if (l === "Mid")      return { bg: "rgba(234,88,12,0.1)", color: "#ea580c", border: "rgba(234,88,12,0.25)" };
  return { bg: "rgba(37,99,235,0.1)", color: "#2563eb", border: "rgba(37,99,235,0.25)" };
}

function locationColors(loc: string): { bg: string; color: string; border: string } {
  const l = loc.toLowerCase();
  if (l.includes("new york") || / ny[,\s]/.test(l) || l.endsWith(", ny") || l === "ny")
    return { bg: "rgba(22,163,74,0.1)", color: "#16a34a", border: "rgba(22,163,74,0.3)" };
  if (l.includes("north carolina") || / nc[,\s]/.test(l) || l.endsWith(", nc") || l === "nc")
    return { bg: "rgba(124,58,237,0.1)", color: "#7c3aed", border: "rgba(124,58,237,0.3)" };
  if (l.includes("seattle") || / wa[,\s]/.test(l) || l.endsWith(", wa") || l === "wa")
    return { bg: "rgba(8,145,178,0.1)", color: "#0891b2", border: "rgba(8,145,178,0.3)" };
  if (l.includes("remote"))
    return { bg: "rgba(100,116,139,0.08)", color: "#475569", border: "rgba(100,116,139,0.2)" };
  return { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" };
}

interface Props {
  job: Job;
  applyRecord: ApplyRecord | null;
  onApplyClick: (jobUrl: string, title: string, company: string) => void;
  onExcludeCompany?: (company: string) => void;
  onCartToggle?: (job: Job) => void;
  isInCart?: boolean;
}

export default function JobCard({ job, applyRecord, onApplyClick, onExcludeCompany, onCartToggle, isInCart }: Props) {
  const [msgCopied, setMsgCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const ats = finiteOrNull(job.ats_score ?? job.score_pct);
  const fit = finiteOrNull(job.fit_score);
  const lvl = job.level || "Entry";
  const color = avatarColor(co);
  const isTopCo = isTop500(co);
  const isApplied = Boolean(applyRecord);
  const sc = scoreBg(score);
  const lc = levelColors(lvl);

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
        background: "#fff",
        border: `1px solid ${isApplied ? "rgba(22,163,74,0.4)" : hovered ? "rgba(37,99,235,0.3)" : "#e2e8f0"}`,
        borderRadius: 12,
        padding: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        boxShadow: hovered
          ? "0 8px 24px rgba(37,99,235,0.1), 0 2px 8px rgba(0,0,0,0.06)"
          : "0 1px 4px rgba(0,0,0,0.06)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "all 0.18s ease",
        cursor: "default",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top accent line based on score */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: sc.bg, borderRadius: "16px 16px 0 0",
      }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 2 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 12, boxShadow: `0 3px 7px ${color}44`,
        }}>
          {co.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 11.5, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {co}
            </span>
            {isTopCo && (
              <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)", flexShrink: 0 }}>
                T500
              </span>
            )}
            {onExcludeCompany && (
              <button onClick={(e) => { e.preventDefault(); onExcludeCompany(co); }}
                style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}
                title={`Block "${co}"`}>⊘</button>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.location || "Remote"}</div>
        </div>
        {/* Score bubble */}
        <div style={{
          flexShrink: 0,
          background: sc.bg,
          color: sc.text,
          borderRadius: 7,
          padding: "3px 7px",
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: "-0.3px",
          boxShadow: `0 2px 6px ${score >= 100 ? "rgba(37,99,235,0.25)" : "rgba(0,0,0,0.1)"}`,
        }}>
          ★{score}
        </div>
      </div>

      {/* Title */}
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#1e293b", lineHeight: 1.35 }}>
        {title}
      </div>

      {/* Tags row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        <span style={{ fontSize: 9.5, fontWeight: 600, padding: "2px 5px", borderRadius: 99, background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}>
          🕐 {dateLabel}
        </span>
        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 5px", borderRadius: 99, background: lc.bg, color: lc.color, border: `1px solid ${lc.border}` }}>
          {lvl}
        </span>
        {isApplied && (
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 5px", borderRadius: 99, background: "rgba(22,163,74,0.1)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.25)" }}>
            ✓ Applied ×{applyRecord?.clicks}
          </span>
        )}
      </div>

      {/* ATS / Fit bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {ats !== null && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: "#94a3b8" }}>ATS</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: atsBar(ats) }}>{ats}%</span>
            </div>
            <div style={{ height: 4, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(ats, 100)}%`, background: atsBar(ats), borderRadius: 99, transition: "width 0.4s ease" }} />
            </div>
          </div>
        )}
        {fit !== null && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: "#94a3b8" }}>Fit</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: atsBar(fit) }}>{fit}%</span>
            </div>
            <div style={{ height: 4, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(fit, 100)}%`, background: atsBar(fit), borderRadius: 99, transition: "width 0.4s ease" }} />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, paddingTop: 4, borderTop: "1px solid #f1f5f9", marginTop: "auto" }}>
        {onCartToggle && (
          <button
            onClick={(e) => { e.preventDefault(); onCartToggle(job); }}
            title={isInCart ? "Remove from cart" : "Save to cart"}
            style={{
              flexShrink: 0, padding: "5px 6px", borderRadius: 6,
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
              padding: "5px 7px", borderRadius: 6, flexShrink: 0,
              border: "1px solid #e2e8f0", background: "#f8fafc",
              color: "#64748b", cursor: "pointer", fontSize: 10, fontWeight: 700,
              transition: "all 0.15s",
            }}
          >Click</button>
        )}
        <button
          onClick={handleMsg}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 6,
            border: "1px solid rgba(99,102,241,0.3)",
            background: msgCopied ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.06)",
            color: "#6366f1", fontSize: 10, fontWeight: 700,
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
              flex: 1.5, padding: "5px 0", borderRadius: 6, textAlign: "center",
              background: isApplied
                ? "linear-gradient(135deg,#16a34a,#059669)"
                : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", fontSize: 10, fontWeight: 700,
              textDecoration: "none", transition: "all 0.15s",
              boxShadow: isApplied
                ? "0 2px 6px rgba(22,163,74,0.3)"
                : "0 2px 6px rgba(37,99,235,0.3)",
            }}
          >
            {isApplied ? "Applied ✓" : "Apply ↗"}
          </a>
        ) : (
          <span style={{ flex: 1, fontSize: 10, color: "#94a3b8", textAlign: "center", padding: "5px 0" }}>—</span>
        )}
      </div>
    </div>
  );
}
