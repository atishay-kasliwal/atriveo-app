import { useState, useEffect, useCallback } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";

interface Candidate {
  email: string;
  pattern: string;
  confidence: number;
}

interface Contact {
  id: number;
  contact_email: string;
  name: string;
  company: string;
  domain: string;
  source: string;
  score: number;
  status: string;
  created_at: string;
}

interface FindResult {
  domain: string;
  mxValid: boolean;
  freeProvider: boolean;
  verified: { email: string; score: number; provider: string } | null;
  verifiedIsRole: boolean;
  candidates: Candidate[];
  note: string;
}

export default function EmailFinder() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [result, setResult] = useState<FindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Contact[]>([]);

  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data = (await res.json()) as { contacts: Contact[] };
        setContacts(data.contacts ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    const hasNameCompany = name.trim() && company.trim();
    if (!hasNameCompany && !linkedinUrl.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/emailfinder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, linkedinUrl }),
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

  // Save a found address to the recruiter contacts list (D1).
  async function save(contactEmail: string, score: number, source: string) {
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_email: contactEmail,
          name,
          company,
          domain: result?.domain ?? "",
          linkedin_url: linkedinUrl,
          source,
          score,
        }),
      });
      if (res.ok) {
        setSaved((s) => new Set(s).add(contactEmail));
        loadContacts();
      }
    } catch {
      /* ignore */
    }
  }

  async function removeContact(id: number) {
    try {
      const res = await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
      if (res.ok) setContacts((cs) => cs.filter((c) => c.id !== id));
    } catch {
      /* ignore */
    }
  }

  // Build a personalized (NOT mass-BCC) outreach mailto for a single contact.
  function composeHref(contactEmail: string): string {
    const firstName = name.trim().split(/\s+/)[0] || "there";
    const co = company.trim() || "your team";
    const subject = `Exploring opportunities at ${co}`;
    const body = `Hi ${firstName},

I came across ${co} while researching teams working on scalable systems and data-driven products, and your profile stood out.

I'm a software engineer / data scientist currently exploring relevant roles where I can contribute. If you're the right person, I'd value a quick chat — and if not, I'd be grateful for a pointer to the right contact.

Thanks for your time,
`;
    return `mailto:${contactEmail}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
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
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                LinkedIn URL <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional — exact match via QuickEnrich)</span>
              </label>
              <input
                className="skills-resume-input"
                style={{ minHeight: 0, height: 40 }}
                placeholder="https://linkedin.com/in/janedoe"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />
            </div>
            <button
              className="refresh-btn"
              type="submit"
              disabled={loading || (!(name.trim() && company.trim()) && !linkedinUrl.trim())}
            >
              {loading ? "Finding…" : "Find emails"}
            </button>
          </div>
        </form>

        {error && (
          <div style={{ fontSize: 12, marginTop: 12, color: "var(--red)" }}>{error}</div>
        )}

        {result && (
          <>
            {result.freeProvider && (
              <div
                className="skills-top-card"
                style={{ marginTop: 20, borderLeft: "3px solid var(--orange, #b8702a)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--orange, #b8702a)" }}>
                  ⚠ Free email provider
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {result.note}
                </div>
              </div>
            )}
            {result.verified && (
              <div className="skills-top-card" style={{ marginTop: 20 }}>
                <div className="skills-section-title" style={{ color: "var(--green)" }}>
                  Verified match
                </div>
                <div className="skills-top-chip" style={{ borderLeft: "3px solid var(--green)" }}>
                  <span className="skills-top-name" style={{ textTransform: "none" }}>{result.verified.email}</span>
                  <span className="skills-top-count">
                    {result.verified.score}% · {result.verified.provider}
                  </span>
                  {result.verifiedIsRole && (
                    <span className="skills-top-count" style={{ color: "var(--orange, #b8702a)" }}>
                      role address
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button className="refresh-btn" onClick={() => copy(result.verified!.email)}>
                      {copied === result.verified.email ? "Copied ✓" : "Copy"}
                    </button>
                    <a className="refresh-btn" href={composeHref(result.verified.email)}>Compose</a>
                    <button
                      className="refresh-btn"
                      onClick={() => save(result.verified!.email, result.verified!.score, result.verified!.provider)}
                      disabled={saved.has(result.verified.email)}
                    >
                      {saved.has(result.verified.email) ? "Saved ✓" : "Save"}
                    </button>
                  </span>
                </div>
              </div>
            )}

            {result.candidates.length > 0 && (
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
                    <span className="skills-top-name" style={{ textTransform: "none" }}>{c.email}</span>
                    <span className="skills-top-count">{Math.round(c.confidence * 100)}%</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button className="refresh-btn" onClick={() => copy(c.email)}>
                        {copied === c.email ? "Copied ✓" : "Copy"}
                      </button>
                      <a className="refresh-btn" href={composeHref(c.email)}>Compose</a>
                      <button
                        className="refresh-btn"
                        onClick={() => save(c.email, Math.round(c.confidence * 100), "guess")}
                        disabled={saved.has(c.email)}
                      >
                        {saved.has(c.email) ? "Saved ✓" : "Save"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            )}
          </>
        )}

        {/* Saved recruiter contacts */}
        {contacts.length > 0 && (
          <div className="skills-top-card" style={{ marginTop: 28 }}>
            <div className="skills-section-title">Saved contacts ({contacts.length})</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
              Your reusable recruiter list. Compose opens a personalized email.
            </div>
            <div className="skills-top-grid">
              {contacts.map((c) => (
                <div key={c.id} className="skills-top-chip" style={{ borderLeft: "3px solid var(--blue)" }}>
                  <span className="skills-top-name" style={{ textTransform: "none" }}>
                    {c.contact_email}
                  </span>
                  <span className="skills-top-count">
                    {c.name || c.company || c.domain}
                    {c.score ? ` · ${c.score}%` : ""} · {c.source}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button className="refresh-btn" onClick={() => copy(c.contact_email)}>
                      {copied === c.contact_email ? "Copied ✓" : "Copy"}
                    </button>
                    <a
                      className="refresh-btn"
                      href={`mailto:${c.contact_email}?subject=${encodeURIComponent(
                        `Exploring opportunities at ${c.company || "your team"}`
                      )}`}
                    >
                      Compose
                    </a>
                    <button className="refresh-btn" onClick={() => removeContact(c.id)}>
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
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
