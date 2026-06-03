import { useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";

interface Candidate {
  email: string;
  pattern: string;
  confidence: number;
}

interface FindResult {
  domain: string;
  mxValid: boolean;
  verified: { email: string; score: number; provider: string } | null;
  candidates: Candidate[];
  note: string;
}

export default function EmailFinder() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [result, setResult] = useState<FindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !company.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/emailfinder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company }),
      });
      const data = (await res.json()) as FindResult & { error?: string };
      if (!res.ok) {
        setError(data.error || "Lookup failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <AppHeader />

      <div className="wrapper page-shell page-shell-narrow">
        <PageIntro
          kicker="Outreach"
          title="Find a recruiter's email"
          description="Enter the person's name and their company, and we'll generate the most likely email addresses — ranked by how common each pattern is — and confirm the domain can receive mail."
          stats={
            result
              ? [
                  { label: "Domain", value: result.domain, tone: "blue" },
                  {
                    label: "Mail",
                    value: result.mxValid ? "Accepts ✓" : "No MX",
                    tone: result.mxValid ? "green" : "red",
                  },
                  { label: "Guesses", value: result.candidates.length, tone: "purple" },
                ]
              : []
          }
        />

        <form onSubmit={handleFind} className="skills-resume-box" style={{ marginTop: 20 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Full name</label>
              <input
                className="skills-resume-input"
                style={{ minHeight: 0, height: 40 }}
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                Company name or domain
              </label>
              <input
                className="skills-resume-input"
                style={{ minHeight: 0, height: 40 }}
                placeholder="Acme Corp  ·  or  ·  acme.com"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <button className="refresh-btn" type="submit" disabled={loading || !name.trim() || !company.trim()}>
              {loading ? "Finding…" : "Find emails"}
            </button>
          </div>
        </form>

        {error && (
          <div style={{ fontSize: 12, marginTop: 12, color: "var(--red)" }}>{error}</div>
        )}

        {result && (
          <>
            {result.verified && (
              <div className="skills-top-card" style={{ marginTop: 20 }}>
                <div className="skills-section-title" style={{ color: "var(--green)" }}>
                  Verified match
                </div>
                <div className="skills-top-chip" style={{ borderLeft: "3px solid var(--green)" }}>
                  <span className="skills-top-name">{result.verified.email}</span>
                  <span className="skills-top-count">
                    {result.verified.score}% · {result.verified.provider}
                  </span>
                  <button
                    className="refresh-btn"
                    style={{ marginLeft: "auto" }}
                    onClick={() => copy(result.verified!.email)}
                  >
                    {copied === result.verified.email ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            <div className="skills-top-card" style={{ marginTop: 20 }}>
              <div className="skills-section-title">Likely addresses</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
                {result.note}
              </div>
              <div className="skills-top-grid">
                {result.candidates.map((c, i) => (
                  <div
                    key={c.email}
                    className="skills-top-chip"
                    style={{
                      borderLeft: `3px solid ${i === 0 ? "var(--green)" : "var(--muted)"}`,
                    }}
                  >
                    <span className="skills-top-rank">#{i + 1}</span>
                    <span className="skills-top-name">{c.email}</span>
                    <span className="skills-top-count">{Math.round(c.confidence * 100)}%</span>
                    <button
                      className="refresh-btn"
                      style={{ marginLeft: "auto" }}
                      onClick={() => copy(c.email)}
                    >
                      {copied === c.email ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <footer>
        <div className="wrapper">
          Atriveo &nbsp;·&nbsp; Email patterns are educated guesses — verify before sending
        </div>
      </footer>
    </div>
  );
}
