import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { useExclusions } from "../hooks/useExclusions";
import { isTop500 } from "../data/top500";
import type { Job } from "../types";

type WeekJob = Job & { scraped_date?: string };

const AVATAR_COLORS = [
  "#7c3aed","#0ea5e9","#059669","#d97706","#db2777","#0891b2","#16a34a","#9333ea",
];

function avatarColor(s: string) {
  const code = [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function extractJobId(url: string | null | undefined): string {
  if (!url) return "";
  const match = url.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : "";
}

function buildReferralMessage(job: WeekJob): string {
  const title = job.title || "this role";
  const company = job.company || "your company";
  const jobId = extractJobId(job.job_url);
  return `Hi Kavish,\nI hope you're doing well! I'm a former SDE2 at Bounteous, currently pursuing my MS in Data Science at Stony Brook. I came across the ${title} role (Job ID: ${jobId}) at ${company}, and would appreciate it if you could review my resume or consider referring me.\nThanks!`;
}

function dayLabel(dateStr?: string): string {
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

interface CardProps {
  job: WeekJob;
  isApplied: boolean;
  onApply: () => void;
}

function JobCard({ job, isApplied, onApply }: CardProps) {
  const [msgCopied, setMsgCopied] = useState(false);
  const co = job.company || "—";
  const title = job.title || "—";
  const score = job.score ?? 0;
  const ats = job.ats_score ?? job.score_pct ?? null;
  const fit = job.fit_score ?? null;
  const lvl = job.level || "Entry";
  const color = avatarColor(co);
  const isTopCo = isTop500(co);

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
      transition: "box-shadow 0.15s",
    }}>
      {/* Header */}
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
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {co}
            {isTopCo && <span style={{ marginLeft: 5, fontSize: 9, background: "var(--blue-lo)", color: "var(--blue)", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>TOP 500</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{job.location || "Remote"}</div>
        </div>
        <div style={{
          flexShrink: 0, fontWeight: 800, fontSize: 18,
          color: score >= 150 ? "#7c3aed" : score >= 120 ? "#0ea5e9" : "var(--blue)",
          fontVariantNumeric: "tabular-nums",
        }}>
          ★{score}
        </div>
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
        {title}
      </div>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Date</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{dayLabel(job.scraped_date)}</span>
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
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 4, borderTop: "1px solid var(--border)" }}>
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
            onClick={onApply}
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

export default function Unclicked100() {
  const { user, logout } = useAuth();
  const { stats, recordClick } = useApplyTracker();
  const { isExcluded } = useExclusions();
  const [weekJobs, setWeekJobs] = useState<WeekJob[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs?type=week")
      .then((r) => r.json())
      .then((data) => {
        setWeekJobs(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const appliedSet = useMemo(() => new Set(Object.keys(stats.appliedJobs)), [stats.appliedJobs]);

  const hundredPlus = useMemo(
    () => weekJobs.filter((j) => (j.score ?? 0) >= 100),
    [weekJobs]
  );

  const unclicked = useMemo(
    () => hundredPlus.filter((j) => !j.job_url || !appliedSet.has(j.job_url)),
    [hundredPlus, appliedSet]
  );

  const filtered = useMemo(() => {
    let jobs = unclicked.filter((j) => !isExcluded(j));
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter((j) =>
        [j.title, j.company, j.location].some((v) => (v || "").toLowerCase().includes(q))
      );
    }
    return [...jobs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [unclicked, query, isExcluded]);

  const topScore = useMemo(
    () => hundredPlus.reduce((m, j) => Math.max(m, j.score ?? 0), 0),
    [hundredPlus]
  );

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">100+ Unclicked</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/unclicked-100" className="nav-tab active">100+ Unclicked</a>
              <a href="/skills" className="nav-tab">Skills</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper">
        <div className="kpi-row">
          <div className="kpi-card blue">
            <div className="kpi-value">{hundredPlus.length}</div>
            <div className="kpi-label">Weekly 100+</div>
            <div className="kpi-sub">score ≥ 100 this week</div>
          </div>
          <div className="kpi-card green">
            <div className="kpi-value">{unclicked.length}</div>
            <div className="kpi-label">Unclicked</div>
            <div className="kpi-sub">not yet applied</div>
          </div>
          <div className="kpi-card orange">
            <div className="kpi-value">{hundredPlus.length - unclicked.length}</div>
            <div className="kpi-label">Clicked</div>
            <div className="kpi-sub">already applied</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{topScore}</div>
            <div className="kpi-label">Top Score</div>
            <div className="kpi-sub">best match this week</div>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Search jobs, companies, locations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="result-meta">
          {filtered.length} job{filtered.length !== 1 ? "s" : ""} · weekly · score ≥ 100 · unclicked
        </div>

        {loading ? (
          <div className="state-msg"><div className="icon">⏳</div>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="state-msg"><div className="icon">🎉</div>No unclicked 100+ jobs</div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
            paddingBottom: 32,
          }}>
            {filtered.map((job, i) => (
              <JobCard
                key={job.job_url || i}
                job={job}
                isApplied={Boolean(job.job_url && appliedSet.has(job.job_url))}
                onApply={() => job.job_url && recordClick(job.job_url, job.title || "", job.company || "")}
              />
            ))}
          </div>
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Weekly · Score ≥ 100 · Not yet applied
        </div>
      </footer>
    </div>
  );
}
