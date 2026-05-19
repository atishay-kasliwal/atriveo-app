import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import type { Job } from "../types";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington D.C.",
};

const ALL_STATES = Object.keys(STATE_NAMES);

function extractState(location: string): string | null {
  if (!location) return null;
  // "City, ST" or "City, ST, United States"
  const parts = location.split(",").map(s => s.trim());
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (STATE_NAMES[upper]) return upper;
  }
  // full state name fallback
  for (const [abbr, name] of Object.entries(STATE_NAMES)) {
    if (location.toLowerCase().includes(name.toLowerCase())) return abbr;
  }
  return null;
}

interface StateRow {
  abbr: string;
  name: string;
  count: number;
  topCompanies: string[];
  topRoles: string[];
  latestTime: string | null;
  avgScore: number;
}

export default function States() {
  const { user, logout } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"count" | "avg" | "name">("count");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/jobs?type=today")
      .then(r => r.json())
      .then(data => { setJobs(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const { rows, totalCovered, totalJobs, topState, zeroStates } = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      const st = extractState(job.location || "");
      if (!st) continue;
      if (!map.has(st)) map.set(st, []);
      map.get(st)!.push(job);
    }

    const rows: StateRow[] = ALL_STATES.map(abbr => {
      const stateJobs = map.get(abbr) || [];
      const companies = [...new Set(stateJobs.map(j => j.company).filter(Boolean))].slice(0, 3) as string[];
      const roles = [...new Set(stateJobs.map(j => {
        const t = (j.title || "").toLowerCase();
        if (t.includes("ml") || t.includes("machine learning")) return "ML";
        if (t.includes("data scientist") || t.includes("data science")) return "Data Science";
        if (t.includes("backend") || t.includes("back-end")) return "Backend";
        if (t.includes("frontend") || t.includes("front-end")) return "Frontend";
        if (t.includes("fullstack") || t.includes("full stack") || t.includes("full-stack")) return "Full Stack";
        if (t.includes("devops") || t.includes("sre")) return "DevOps";
        if (t.includes("ai") || t.includes("genai")) return "AI";
        return "SWE";
      }))].slice(0, 3);
      const times = stateJobs.map(j => j.batch_time || j.date_posted).filter(Boolean) as string[];
      const latestTime = times.length ? times.sort().reverse()[0] : null;
      const scores = stateJobs.map(j => j.score ?? 0).filter(s => s > 0);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return { abbr, name: STATE_NAMES[abbr], count: stateJobs.length, topCompanies: companies, topRoles: roles, latestTime, avgScore };
    });

    const covered = rows.filter(r => r.count > 0);
    const topState = [...covered].sort((a, b) => b.count - a.count)[0] || null;
    const zeroStates = rows.filter(r => r.count === 0).map(r => r.abbr);
    const totalJobs = rows.reduce((a, r) => a + r.count, 0);

    return { rows, totalCovered: covered.length, totalJobs, topState, zeroStates };
  }, [jobs]);

  const sorted = useMemo(() => {
    let r = [...rows];
    if (search) r = r.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.abbr.toLowerCase().includes(search.toLowerCase()));
    if (sort === "count") r.sort((a, b) => b.count - a.count);
    if (sort === "avg") r.sort((a, b) => b.avgScore - a.avgScore);
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }, [rows, sort, search]);

  const maxCount = Math.max(...rows.map(r => r.count), 1);

  function scoreBg(s: number) {
    if (s >= 150) return "#7c3aed";
    if (s >= 100) return "#2563eb";
    if (s >= 70) return "#059669";
    if (s >= 40) return "#d97706";
    return "#94a3b8";
  }

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        background: "rgba(241,245,249,0.92)",
        borderBottom: "1px solid rgba(148,163,184,0.18)",
      }}>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">States</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/unclicked-100" className="nav-tab">100+ Unclicked</a>
              <a href="/cart" className="nav-tab">Cart</a>
              <a href="/skills" className="nav-tab">Skills</a>
              <a href="/states" className="nav-tab active">States</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper" style={{ paddingTop: 28, paddingBottom: 48 }}>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          {[
            {
              label: "States Covered",
              value: loading ? "—" : `${totalCovered} / 51`,
              sub: `${51 - totalCovered} states with no jobs`,
              color: "#2563eb",
              bg: "rgba(37,99,235,0.06)",
            },
            {
              label: "Total Jobs Mapped",
              value: loading ? "—" : totalJobs.toLocaleString(),
              sub: "across all states today",
              color: "#059669",
              bg: "rgba(5,150,105,0.06)",
            },
            {
              label: "Top State",
              value: loading ? "—" : (topState?.abbr || "—"),
              sub: topState ? `${topState.count} jobs · ${topState.name}` : "no data",
              color: "#7c3aed",
              bg: "rgba(124,58,237,0.06)",
            },
            {
              label: "Zero-Job States",
              value: loading ? "—" : zeroStates.length.toString(),
              sub: zeroStates.slice(0, 5).join(", ") + (zeroStates.length > 5 ? "…" : ""),
              color: "#d97706",
              bg: "rgba(217,119,6,0.06)",
            },
          ].map(card => (
            <div key={card.label} style={{
              background: "#fff",
              border: `1px solid ${card.color}22`,
              borderLeft: `3px solid ${card.color}`,
              borderRadius: 10,
              padding: "14px 16px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: card.color, letterSpacing: "-0.5px", lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 5 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search state..."
            style={{
              padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
              fontSize: 13, outline: "none", width: 200, background: "#fff",
            }}
          />
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {(["count", "avg", "name"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                style={{
                  padding: "6px 12px", borderRadius: 7, border: "1px solid #e2e8f0",
                  background: sort === s ? "#0f172a" : "#fff",
                  color: sort === s ? "#fff" : "#64748b",
                  fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                }}
              >
                {s === "count" ? "Job Count" : s === "avg" ? "Avg Score" : "A–Z"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e8edf3", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "44px 180px 1fr 130px 150px 70px 70px",
            padding: "10px 16px",
            background: "#f8fafc",
            borderBottom: "1px solid #e8edf3",
            fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
            gap: 12,
          }}>
            <div>#</div>
            <div>State</div>
            <div>Jobs</div>
            <div>Top Companies</div>
            <div>Roles</div>
            <div>Avg ★</div>
            <div>Latest</div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              <div className="spin" style={{ margin: "0 auto 12px" }} />
              Loading…
            </div>
          ) : (
            sorted.map((row, i) => (
              <div
                key={row.abbr}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 180px 1fr 130px 150px 70px 70px",
                  padding: "11px 16px",
                  borderBottom: "1px solid #f1f5f9",
                  alignItems: "center",
                  gap: 12,
                  background: row.count === 0 ? "#fafafa" : "#fff",
                  transition: "background 0.12s",
                  cursor: row.count > 0 ? "pointer" : "default",
                }}
                onMouseEnter={e => { if (row.count > 0) (e.currentTarget as HTMLElement).style.background = "#f0f6ff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = row.count === 0 ? "#fafafa" : "#fff"; }}
                onClick={() => { if (row.count > 0) window.location.href = `/?state=${row.abbr}`; }}
              >
                {/* Rank */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1" }}>
                  {row.count > 0 ? i + 1 : "—"}
                </div>

                {/* State */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 32, height: 22, borderRadius: 5,
                    background: row.count > 0 ? `linear-gradient(135deg, ${scoreBg(row.avgScore)}, ${scoreBg(row.avgScore)}aa)` : "#f1f5f9",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 800, color: row.count > 0 ? "#fff" : "#94a3b8",
                    flexShrink: 0,
                  }}>
                    {row.abbr}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: row.count > 0 ? "#0f172a" : "#94a3b8" }}>
                    {row.name}
                  </span>
                </div>

                {/* Bar + count */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${(row.count / maxCount) * 100}%`,
                      background: row.count > 0
                        ? `linear-gradient(90deg, ${scoreBg(row.avgScore)}, ${scoreBg(row.avgScore)}bb)`
                        : "transparent",
                      borderRadius: 99,
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 800,
                    color: row.count > 0 ? scoreBg(row.avgScore) : "#cbd5e1",
                    minWidth: 24, textAlign: "right",
                  }}>
                    {row.count || "0"}
                  </span>
                </div>

                {/* Top companies */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {row.topCompanies.length ? row.topCompanies.map(c => (
                    <span key={c} style={{
                      fontSize: 9.5, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
                      background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90,
                    }}>{c}</span>
                  )) : <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>}
                </div>

                {/* Roles */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {row.topRoles.length ? row.topRoles.map(r => (
                    <span key={r} style={{
                      fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                      background: "rgba(37,99,235,0.07)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.15)",
                    }}>{r}</span>
                  )) : <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>}
                </div>

                {/* Avg score */}
                <div style={{
                  fontSize: 12, fontWeight: 800,
                  color: row.avgScore > 0 ? scoreBg(row.avgScore) : "#cbd5e1",
                }}>
                  {row.avgScore > 0 ? `★${row.avgScore}` : "—"}
                </div>

                {/* Latest */}
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {fmtTime(row.latestTime)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
