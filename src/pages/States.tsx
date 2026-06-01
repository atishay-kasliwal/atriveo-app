import { useState, useEffect, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import { useApplyTracker } from "../hooks/useApplyTracker";
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
  const parts = location.split(",").map(s => s.trim());
  for (const part of parts) {
    if (STATE_NAMES[part.toUpperCase()]) return part.toUpperCase();
  }
  for (const [abbr, name] of Object.entries(STATE_NAMES)) {
    if (location.toLowerCase().includes(name.toLowerCase())) return abbr;
  }
  return null;
}

function scoreBg(s: number) {
  if (s >= 150) return "#4f4f47";
  if (s >= 100) return "#5f5e54";
  if (s >= 70)  return "#69725a";
  if (s >= 40)  return "#9a7653";
  return "#8a8776";
}

function roleLabel(title: string) {
  const t = title.toLowerCase();
  if (t.includes("ml") || t.includes("machine learning")) return "ML";
  if (t.includes("data scientist") || t.includes("data science")) return "Data Science";
  if (t.includes("backend") || t.includes("back-end")) return "Backend";
  if (t.includes("frontend") || t.includes("front-end")) return "Frontend";
  if (t.includes("fullstack") || t.includes("full stack") || t.includes("full-stack")) return "Full Stack";
  if (t.includes("devops") || t.includes("sre")) return "DevOps";
  if (t.includes("ai") || t.includes("genai")) return "AI";
  return "SWE";
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

interface StateRow {
  abbr: string;
  name: string;
  count: number;
  jobs: Job[];
  topCompanies: string[];
  topRoles: string[];
  latestTime: string | null;
  avgScore: number;
}

export default function States() {
  const { recordClick, getRecord } = useApplyTracker();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"count" | "avg" | "name">("count");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
      const stateJobs = (map.get(abbr) || []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const companies = [...new Set(stateJobs.map(j => j.company).filter(Boolean))].slice(0, 3) as string[];
      const roles = [...new Set(stateJobs.map(j => roleLabel(j.title || "")))].slice(0, 3);
      const times = stateJobs.map(j => j.batch_time || j.date_posted).filter(Boolean) as string[];
      const latestTime = times.length ? times.sort().reverse()[0] : null;
      const scores = stateJobs.map(j => j.score ?? 0).filter(s => s > 0);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return { abbr, name: STATE_NAMES[abbr], count: stateJobs.length, jobs: stateJobs, topCompanies: companies, topRoles: roles, latestTime, avgScore };
    });

    const covered = rows.filter(r => r.count > 0);
    const topState = [...covered].sort((a, b) => b.count - a.count)[0] || null;
    const zeroStates = rows.filter(r => r.count === 0).map(r => r.abbr);
    return { rows, totalCovered: covered.length, totalJobs: rows.reduce((a, r) => a + r.count, 0), topState, zeroStates };
  }, [jobs]);

  const sorted = useMemo(() => {
    let r = [...rows];
    if (search) r = r.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.abbr.toLowerCase().includes(search.toLowerCase()));
    if (sort === "count") r.sort((a, b) => b.count - a.count);
    if (sort === "avg")   r.sort((a, b) => b.avgScore - a.avgScore);
    if (sort === "name")  r.sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }, [rows, sort, search]);

  const maxCount = Math.max(...rows.map(r => r.count), 1);

  function toggleExpand(abbr: string, count: number) {
    if (count === 0) return;
    setExpanded(prev => prev === abbr ? null : abbr);
  }

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-wide">
        <PageIntro
          compact
          kicker="State Coverage"
          title="Where jobs are clustering across the country"
          description="A compact map of today’s postings by state, with average score, top companies, and expandable rows when you want more detail."
          stats={[
            { label: "Covered", value: totalCovered, tone: "blue" },
            { label: "Mapped", value: totalJobs, tone: "green" },
            { label: "Top state", value: topState?.abbr || "—", tone: "purple" },
          ]}
        />

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          {[
            { label: "States Covered", value: loading ? "—" : `${totalCovered} / 51`, sub: `${51 - totalCovered} with no jobs`, color: "#5f5e54" },
            { label: "Total Jobs Mapped", value: loading ? "—" : totalJobs.toLocaleString(), sub: "across all states today", color: "#69725a" },
            { label: "Top State", value: loading ? "—" : (topState?.abbr || "—"), sub: topState ? `${topState.count} jobs · ${topState.name}` : "no data", color: "#4f4f47" },
            { label: "Zero-Job States", value: loading ? "—" : zeroStates.length.toString(), sub: zeroStates.slice(0, 6).join(", ") + (zeroStates.length > 6 ? "…" : ""), color: "#9a7653" },
          ].map(card => (
            <div key={card.label} style={{
              background: "var(--bean-milk)", borderRadius: 10, padding: "14px 16px",
              border: `1px solid ${card.color}22`, borderLeft: `3px solid ${card.color}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: card.color, letterSpacing: "-0.5px", lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 5 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search state…"
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, outline: "none", width: 200, background: "var(--surface-2)" }}
          />
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {(["count", "avg", "name"] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border)",
                background: sort === s ? "var(--bean-dark)" : "var(--surface-2)",
                color: sort === s ? "#fff" : "var(--text-2)",
                fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}>
                {s === "count" ? "Job Count" : s === "avg" ? "Avg Score" : "A–Z"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: "var(--bean-milk)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "0 1px 6px rgba(79,79,71,0.08)" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 180px 1fr 160px 160px 70px 70px 24px",
            padding: "10px 16px", gap: 12,
            background: "rgba(237,232,208,0.42)", borderBottom: "1px solid var(--border)",
            fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            <div>#</div><div>State</div><div>Jobs</div>
            <div>Top Companies</div><div>Roles</div>
            <div>Avg ★</div><div>Latest</div><div />
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
              <div className="spin" style={{ margin: "0 auto 12px" }} />Loading…
            </div>
          ) : sorted.map((row, i) => {
            const isOpen = expanded === row.abbr;
            const tierColor = scoreBg(row.avgScore);
            return (
              <div key={row.abbr}>
                {/* State row */}
                <div
                  onClick={() => toggleExpand(row.abbr, row.count)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 180px 1fr 160px 160px 70px 70px 24px",
                    padding: "11px 16px", gap: 12,
                    alignItems: "center",
                    borderBottom: isOpen ? "none" : "1px solid rgba(119,118,106,0.14)",
                    background: isOpen ? "rgba(237,232,208,0.72)" : row.count === 0 ? "#f7f3e5" : "var(--bean-milk)",
                    cursor: row.count > 0 ? "pointer" : "default",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => { if (row.count > 0 && !isOpen) (e.currentTarget as HTMLElement).style.background = "#fbf8ec"; }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = row.count === 0 ? "#f7f3e5" : "var(--bean-milk)"; }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--bean-taupe)" }}>{row.count > 0 ? i + 1 : "—"}</div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 32, height: 22, borderRadius: 5, flexShrink: 0,
                      background: row.count > 0 ? `linear-gradient(135deg,${tierColor},${tierColor}aa)` : "var(--bean-cream)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 800, color: row.count > 0 ? "#fff" : "var(--muted)",
                    }}>{row.abbr}</div>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: row.count > 0 ? "var(--text)" : "var(--muted)" }}>{row.name}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: "var(--bean-cream)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${(row.count / maxCount) * 100}%`,
                        background: row.count > 0 ? `linear-gradient(90deg,${tierColor},${tierColor}bb)` : "transparent",
                        borderRadius: 99, transition: "width 0.5s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: row.count > 0 ? tierColor : "var(--bean-taupe)", minWidth: 24, textAlign: "right" }}>
                      {row.count || "0"}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {row.topCompanies.length ? row.topCompanies.map(c => (
                      <span key={c} style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 5px", borderRadius: 4, background: "var(--bean-cream)", color: "var(--text-2)", border: "1px solid var(--border)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{c}</span>
                    )) : <span style={{ fontSize: 11, color: "var(--bean-taupe)" }}>—</span>}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {row.topRoles.length ? row.topRoles.map(r => (
                      <span key={r} style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(79,79,71,0.08)", color: "var(--bean-dark)", border: "1px solid rgba(79,79,71,0.16)" }}>{r}</span>
                    )) : <span style={{ fontSize: 11, color: "var(--bean-taupe)" }}>—</span>}
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: row.avgScore > 0 ? tierColor : "var(--bean-taupe)" }}>
                    {row.avgScore > 0 ? `★${row.avgScore}` : "—"}
                  </div>

                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtTime(row.latestTime)}</div>

                  <div style={{ fontSize: 13, color: row.count > 0 ? "var(--muted)" : "transparent", transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "none" }}>›</div>
                </div>

                {/* Expanded job sub-table */}
                {isOpen && (
                  <div style={{ borderBottom: "1px solid var(--border)", background: "#fbf8ec" }}>
                    {/* Sub-header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "36px 2fr 1fr 1fr 90px 80px 220px",
                      padding: "8px 24px", gap: 16,
                      fontSize: 10.5, fontWeight: 700, color: "var(--muted)",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      borderBottom: "1px solid var(--border)", background: "rgba(237,232,208,0.72)",
                    }}>
                      <div>#</div>
                      <div>Job Title</div>
                      <div>Company</div>
                      <div>Location</div>
                      <div>Score</div>
                      <div>Level</div>
                      <div>Actions</div>
                    </div>

                    {row.jobs.map((job, ji) => {
                      const rec = job.job_url ? getRecord(job.job_url) : null;
                      const isApplied = Boolean(rec);
                      const jScore = job.score ?? 0;
                      const jColor = scoreBg(jScore);
                      return (
                        <div
                          key={job.job_url || ji}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "36px 2fr 1fr 1fr 90px 80px 220px",
                            padding: "11px 24px", gap: 16,
                            alignItems: "center",
                            borderBottom: ji < row.jobs.length - 1 ? "1px solid rgba(119,118,106,0.14)" : "none",
                            background: isApplied ? "rgba(105,114,90,0.06)" : "transparent",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isApplied ? "rgba(105,114,90,0.1)" : "rgba(79,79,71,0.045)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isApplied ? "rgba(105,114,90,0.06)" : "transparent"; }}
                        >
                          {/* Index */}
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--bean-taupe)" }}>{ji + 1}</div>

                          {/* Title */}
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {job.title || "—"}
                          </div>

                          {/* Company */}
                          <div style={{ fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                            {job.company || "—"}
                          </div>

                          {/* Location */}
                          <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📍 {job.location || "—"}
                          </div>

                          {/* Score */}
                          <div style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            background: `${jColor}15`, color: jColor,
                            borderRadius: 7, padding: "3px 10px",
                            fontSize: 12, fontWeight: 800, whiteSpace: "nowrap",
                          }}>★ {jScore}</div>

                          {/* Level */}
                          <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>{job.level || "—"}</div>

                          {/* Actions */}
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {!isApplied && job.job_url && (
                              <button
                                onClick={() => recordClick(job.job_url, job.title || "", job.company || "", { location: job.location || null })}
                                style={{
                                  padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)",
                                  background: "var(--surface-2)", color: "var(--text-2)", fontSize: 11, fontWeight: 700, cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >Add to tracker</button>
                            )}
                            {job.job_url && (
                              <a
                                href={job.job_url}
                                target="_blank"
                                rel="noopener"
                                style={{
                                  padding: "5px 14px", borderRadius: 6,
                                  background: isApplied ? "linear-gradient(135deg,#69725a,#4f4f47)" : `linear-gradient(135deg,${jColor},${jColor}cc)`,
                                  color: "#fff", fontSize: 11, fontWeight: 700,
                                  textDecoration: "none", whiteSpace: "nowrap",
                                }}
                              >{isApplied ? "Open ↗" : "Apply ↗"}</a>
                            )}
                            {isApplied && (
                              <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700 }}>
                                tracked ×{rec?.clicks}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
