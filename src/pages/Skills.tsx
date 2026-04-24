import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import type { Job } from "../types";

type Period = "today" | "yesterday" | "both";

const SKILL_CATEGORIES: Record<string, { skills: string[]; color: string }> = {
  "Languages": {
    color: "#3b82f6",
    skills: ["java", "python", "javascript", "typescript", "golang", "go", "scala", "kotlin", "c#", ".net", "ruby", "rust", "c++"],
  },
  "Frameworks": {
    color: "#8b5cf6",
    skills: ["spring boot", "spring", "fastapi", "django", "flask", "express", "nestjs", "react", "next.js", "node.js", "pydantic", "rails"],
  },
  "Cloud": {
    color: "#f59e0b",
    skills: ["aws", "lambda", "ecs", "sqs", "sns", "api gateway", "s3", "gcp", "google cloud", "azure", "cloudflare", "ec2", "rds"],
  },
  "Backend": {
    color: "#0ea5e9",
    skills: ["microservices", "rest api", "rest", "grpc", "graphql", "distributed systems", "event-driven", "message queue", "api design", "backend"],
  },
  "DevOps": {
    color: "#10b981",
    skills: ["docker", "kubernetes", "terraform", "jenkins", "ci/cd", "github actions", "helm", "ansible", "datadog", "prometheus"],
  },
  "Data & Storage": {
    color: "#f43f5e",
    skills: ["postgresql", "postgres", "mysql", "mongodb", "redis", "kafka", "airflow", "spark", "elasticsearch", "dynamodb", "cassandra", "bigquery", "snowflake", "pandas"],
  },
};

function countSkills(jobs: Job[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const texts = jobs.map((j) =>
    `${j.title || ""} ${(j as Job & { description?: string }).description || ""}`.toLowerCase()
  );
  for (const { skills } of Object.values(SKILL_CATEGORIES)) {
    for (const skill of skills) {
      const count = texts.filter((t) => t.includes(skill)).length;
      if (count > 0) counts[skill] = count;
    }
  }
  return counts;
}

export default function Skills() {
  const { user, logout } = useAuth();
  const [todayJobs, setTodayJobs] = useState<Job[]>([]);
  const [yesterdayJobs, setYesterdayJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [today, yesterday] = await Promise.all([
        fetch("/api/jobs?type=today").then((r) => r.json()).catch(() => []),
        fetch("/api/jobs?type=yesterday").then((r) => r.json()).catch(() => []),
      ]);
      setTodayJobs(today);
      setYesterdayJobs(yesterday);
      setLoading(false);
    }
    load();
  }, []);

  const jobs = useMemo(() => {
    if (period === "today") return todayJobs;
    if (period === "yesterday") return yesterdayJobs;
    const seen = new Set<string>();
    return [...todayJobs, ...yesterdayJobs].filter((j) => {
      const key = j.job_url || `${j.title}__${j.company}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [period, todayJobs, yesterdayJobs]);

  const counts = useMemo(() => countSkills(jobs), [jobs]);

  const topSkills = useMemo(() => {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [counts]);

  const total = jobs.length || 1;

  return (
    <div>
      <header>
        <div className="wrapper header-inner">
          <div className="logo">
            <div className="logo-icon">A</div>
            <div>
              <div className="logo-name">Atriveo</div>
              <div className="logo-sub">Job Feed</div>
            </div>
          </div>
          <div className="header-right">
            <nav className="nav-tabs">
              <a href="/" className="nav-tab">Live Feed</a>
              <a href="/weekly" className="nav-tab">Weekly</a>
              <a href="/skills" className="nav-tab active">Skills</a>
              <a href="/settings" className="nav-tab">Settings</a>
            </nav>
            <span className="header-user">Hi, {user?.name}</span>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrapper" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {/* Page title + period toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)" }}>
              Skills Heatmap
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {loading ? "Loading…" : `Analyzed ${jobs.length} job descriptions`}
            </div>
          </div>
          <div className="period-tabs">
            {(["today", "yesterday", "both"] as Period[]).map((p) => (
              <button
                key={p}
                className={`period-tab${period === p ? " active" : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p === "both" ? "Both Days" : p.charAt(0).toUpperCase() + p.slice(1)}
                <span className="count">
                  {p === "today" ? todayJobs.length : p === "yesterday" ? yesterdayJobs.length : todayJobs.length + yesterdayJobs.length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="state-msg"><div className="spin" style={{ margin: "0 auto" }} /></div>
        ) : (
          <>
            {/* Top 10 summary */}
            <div className="skills-top-card">
              <div className="skills-section-title">Top Skills Across All Jobs</div>
              <div className="skills-top-grid">
                {topSkills.map(([skill, count], i) => (
                  <div key={skill} className="skills-top-chip">
                    <span className="skills-top-rank">#{i + 1}</span>
                    <span className="skills-top-name">{skill}</span>
                    <span className="skills-top-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Category cards */}
            <div className="skills-grid">
              {Object.entries(SKILL_CATEGORIES).map(([category, { skills, color }]) => {
                const catSkills = skills
                  .map((s) => ({ skill: s, count: counts[s] ?? 0 }))
                  .filter((s) => s.count > 0)
                  .sort((a, b) => b.count - a.count);

                if (catSkills.length === 0) return null;
                const maxCount = catSkills[0].count;

                return (
                  <div key={category} className="skills-cat-card">
                    <div className="skills-cat-header">
                      <span className="skills-cat-dot" style={{ background: color }} />
                      <span className="skills-cat-title">{category}</span>
                      <span className="skills-cat-count">{catSkills.length} skills</span>
                    </div>
                    <div className="skills-bars">
                      {catSkills.map(({ skill, count }) => (
                        <div key={skill} className="skills-bar-row">
                          <span className="skills-bar-label">{skill}</span>
                          <div className="skills-bar-track">
                            <div
                              className="skills-bar-fill"
                              style={{
                                width: `${(count / maxCount) * 100}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <span className="skills-bar-val">{count}</span>
                          <span className="skills-bar-pct">{Math.round((count / total) * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo Job Pipeline &nbsp;·&nbsp; Runs hourly 12 AM – 11 PM
        </div>
      </footer>
    </div>
  );
}
