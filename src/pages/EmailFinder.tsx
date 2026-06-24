import { useState, useEffect, useCallback } from "react";
import AppHeader from "../components/AppHeader";

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

interface BulkRow {
  name: string;
  email: string;
  basis: "verified-pattern" | "guessed-pattern" | "error";
}
interface BulkResult {
  domain: string;
  mxValid: boolean;
  pattern: string;
  patternBasis: "verified" | "default";
  verifiedSample: { name: string; email: string; provider: string } | null;
  rows: BulkRow[];
  note: string;
}

interface Template {
  id: number;
  title: string;
  body: string;
  created_at: string;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="recon-field">
      <div className="recon-field-head">
        <span className="recon-field-label">{label.toUpperCase()}</span>
        {hint && <span className="recon-field-hint">{hint}</span>}
      </div>
      <div className="recon-field-body">{children}</div>
    </label>
  );
}

export default function EmailFinder() {
  const [mode, setMode] = useState<"single" | "bulk" | "templates">("single");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [result, setResult] = useState<FindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [savedFilter, setSavedFilter] = useState("");
  // Bulk mode
  const [bulkNames, setBulkNames] = useState("");
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplTitle, setTplTitle] = useState("");
  const [tplBody, setTplBody] = useState("");

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = (await res.json()) as { templates: Template[] };
        setTemplates(data.templates ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data = (await res.json()) as { contacts: Contact[] };
        setContacts(data.contacts ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  async function saveTemplate() {
    if (!tplBody.trim()) return;
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: tplTitle, body: tplBody }),
      });
      if (res.ok) { setTplTitle(""); setTplBody(""); loadTemplates(); }
    } catch { /* ignore */ }
  }

  async function removeTemplate(id: number) {
    try {
      const res = await fetch(`/api/templates?id=${id}`, { method: "DELETE" });
      if (res.ok) setTemplates((ts) => ts.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  }

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    if (!(name.trim() && company.trim()) && !linkedinUrl.trim()) return;
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
      if (!res.ok) setError(data.error || "Lookup failed");
      else setResult(data);
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
    } catch { /* ignore */ }
  }

  async function save(contactEmail: string, score: number, source: string) {
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_email: contactEmail,
          name, company,
          domain: result?.domain ?? "",
          linkedin_url: linkedinUrl,
          source, score,
        }),
      });
      if (res.ok) { setSaved((s) => new Set(s).add(contactEmail)); loadContacts(); }
    } catch { /* ignore */ }
  }

  async function removeContact(id: number) {
    try {
      const res = await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
      if (res.ok) setContacts((cs) => cs.filter((c) => c.id !== id));
    } catch { /* ignore */ }
  }

  function composeHref(contactEmail: string): string {
    const firstName = name.trim().split(/\s+/)[0] || "there";
    const co = company.trim() || "your team";
    const subject = `Exploring opportunities at ${co}`;
    const body = `Hi ${firstName},\n\nI came across ${co} while researching teams working on scalable systems and data-driven products, and your profile stood out.\n\nI'm a software engineer / data scientist currently exploring relevant roles where I can contribute. If you're the right person, I'd value a quick chat — and if not, I'd be grateful for a pointer to the right contact.\n\nThanks for your time,\n`;
    return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    const names = bulkNames.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!bulkCompany.trim() || names.length === 0) return;
    setLoading(true);
    setError("");
    setBulkResult(null);
    try {
      const res = await fetch("/api/emailfinder-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, company: bulkCompany }),
      });
      const data = (await res.json()) as BulkResult & { error?: string };
      if (!res.ok) setError(data.error || "Bulk lookup failed");
      else setBulkResult(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function copyAllBulk() {
    if (!bulkResult) return;
    copy(bulkResult.rows.filter((r) => r.email).map((r) => r.email).join(", "));
  }

  function downloadBulkCsv() {
    if (!bulkResult) return;
    const header = "name,email,basis\n";
    const lines = bulkResult.rows.map((r) => `"${r.name}",${r.email},${r.basis}`).join("\n");
    const blob = new Blob([header + lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `emails-${bulkResult.domain}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const filteredContacts = contacts.filter((c) => {
    if (!savedFilter) return true;
    const q = savedFilter.toLowerCase();
    return c.name?.toLowerCase().includes(q) || c.contact_email.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q);
  });

  return (
    <div className="recon-page">
      <AppHeader />

      <div className="recon-body">
        {/* Hero card */}
        <section className="recon-hero">
          <div className="recon-hero-grid-overlay" />
          <div className="recon-hero-content">
            <div className="recon-hero-copy">
              <div className="recon-eyebrow">RECON · OUTREACH</div>
              <h1 className="recon-title">
                Triangulate a{" "}
                <span className="recon-title-accent">recruiter's email.</span>
              </h1>
              <p className="recon-subtitle">
                Rank likely patterns, verify domain delivery, and queue saved contacts by company so outreach is one click away.
              </p>
            </div>
            <div className="recon-mode-tabs">
              {([
                { id: "single", label: "One person" },
                { id: "bulk", label: "Bulk" },
                { id: "templates", label: "Templates" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMode(t.id)}
                  className={`recon-mode-tab${mode === t.id ? " active" : ""}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Single person mode */}
        {mode === "single" && (
          <div className="recon-layout">
            {/* Left: form */}
            <aside className="recon-aside">
              <div className="recon-tile">
                <div className="recon-tile-eyebrow" style={{ color: "var(--primary)" }}>QUERY</div>
                <h2 className="recon-tile-h2">Recipient details</h2>
                <form onSubmit={handleFind} className="recon-form">
                  <Field label="Full name">
                    <input className="recon-input" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Company name or domain">
                    <input className="recon-input" placeholder="acme.com" value={company} onChange={(e) => setCompany(e.target.value)} />
                  </Field>
                  <Field label="LinkedIn URL" hint="optional · QuickEnrich exact match">
                    <input className="recon-input" placeholder="https://linkedin.com/in/janedoe" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
                  </Field>
                  <button
                    type="submit"
                    className="recon-btn-primary"
                    disabled={loading || (!(name.trim() && company.trim()) && !linkedinUrl.trim())}
                  >
                    {loading ? "Finding…" : "⌕ Run recon"}
                  </button>
                </form>
              </div>

              {result && (
                <div className="recon-tile recon-domain-tile">
                  <div className="recon-tile-eyebrow">DOMAIN STATUS</div>
                  <div className="recon-domain-row">
                    <span className={`recon-domain-icon${result.mxValid ? " ok" : " bad"}`}>
                      {result.mxValid ? "✓" : "✗"}
                    </span>
                    <div>
                      <div className="recon-domain-name">{result.domain}</div>
                      <div className="recon-domain-sub">
                        {result.mxValid ? "MX valid" : "No MX"} · {result.freeProvider ? "free provider" : "corporate"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <p className="recon-disclaimer">Email patterns are educated guesses. Always verify before sending.</p>
            </aside>

            {/* Right: results + saved */}
            <main className="recon-main">
              {error && <div className="recon-error">{error}</div>}

              <div className="recon-tile">
                <div className="recon-tile-eyebrow">PREDICTED EMAILS</div>
                <h2 className="recon-tile-h2">
                  {result ? `${result.candidates.length} candidates` : "Run recon to see candidates"}
                </h2>

                {!result && !loading && (
                  <div className="recon-empty-state">
                    <div className="recon-empty-icon">✉</div>
                    <p className="recon-empty-title">Nothing here yet</p>
                    <p className="recon-empty-sub">Fill in a name and company, then click <strong>Run recon</strong>.</p>
                  </div>
                )}

                {result?.freeProvider && (
                  <div className="recon-warn-banner">⚠ Free email provider — {result.note}</div>
                )}

                {result?.verified && (
                  <div className="recon-verified-row">
                    <span className="recon-verified-badge">VERIFIED</span>
                    <span className="recon-email-mono">{result.verified.email}</span>
                    <span className="recon-conf">{result.verified.score}% · {result.verified.provider}</span>
                    {result.verifiedIsRole && <span className="recon-role-tag">role address</span>}
                    <div className="recon-row-actions">
                      <button className="recon-btn-ghost" onClick={() => copy(result.verified!.email)}>
                        {copied === result.verified.email ? "Copied ✓" : "Copy"}
                      </button>
                      <a className="recon-btn-ghost" href={composeHref(result.verified.email)}>Compose</a>
                      <button className="recon-btn-ghost" onClick={() => save(result.verified!.email, result.verified!.score, result.verified!.provider)} disabled={saved.has(result.verified.email)}>
                        {saved.has(result.verified.email) ? "Saved ✓" : "Save"}
                      </button>
                    </div>
                  </div>
                )}

                {result && result.candidates.length > 0 && (
                  <div className="recon-candidates">
                    {result.candidates.map((c, i) => (
                      <div key={c.email} className={`recon-candidate-row${i === 0 ? " is-top" : ""}`}>
                        <span className="recon-num">{i + 1}</span>
                        <div className="recon-candidate-info">
                          <div className="recon-email-mono">{c.email}</div>
                          <div className="recon-candidate-meta">
                            <span className="recon-pattern">{c.pattern}</span>
                            <div className="recon-conf-bar">
                              <div className="recon-conf-fill" style={{ width: `${c.confidence * 100}%` }} />
                            </div>
                            <span className={`recon-conf${c.confidence > 0.7 ? " ok" : c.confidence > 0.4 ? " mid" : ""}`}>
                              {Math.round(c.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                        <div className="recon-row-actions">
                          <button className="recon-btn-ghost" onClick={() => copy(c.email)}>{copied === c.email ? "Copied ✓" : "Copy"}</button>
                          <a className="recon-btn-ghost" href={composeHref(c.email)}>Compose</a>
                          <button className="recon-btn-ghost" onClick={() => save(c.email, Math.round(c.confidence * 100), "guess")} disabled={saved.has(c.email)}>
                            {saved.has(c.email) ? "Saved ✓" : "Save"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Saved contacts */}
              <div className="recon-tile">
                <div className="recon-tile-top">
                  <div>
                    <div className="recon-tile-eyebrow">SAVED CONTACTS · {contacts.length}</div>
                    <h2 className="recon-tile-h2">Recruiter book</h2>
                  </div>
                  <div className="recon-search-wrap">
                    <span className="recon-search-icon">⌕</span>
                    <input
                      className="recon-search"
                      placeholder="Filter contacts…"
                      value={savedFilter}
                      onChange={(e) => setSavedFilter(e.target.value)}
                    />
                  </div>
                </div>

                {filteredContacts.length === 0 ? (
                  <div className="recon-empty-state" style={{ paddingBlock: "32px" }}>
                    <p className="recon-empty-sub">{savedFilter ? `No contacts match "${savedFilter}"` : "No saved contacts yet."}</p>
                  </div>
                ) : (
                  <div className="recon-contacts">
                    {filteredContacts.map((c) => (
                      <div key={c.id} className="recon-contact-row">
                        <div className="recon-contact-avatar">
                          {(c.name || c.contact_email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="recon-contact-info">
                          <div className="recon-contact-name">{c.name || c.company || c.domain}</div>
                          <div className="recon-contact-email">{c.contact_email}{c.score ? ` · ${c.score}%` : ""} · {c.source}</div>
                        </div>
                        <div className="recon-row-actions">
                          <button className="recon-btn-ghost" onClick={() => copy(c.contact_email)}>{copied === c.contact_email ? "Copied ✓" : "Copy"}</button>
                          <a className="recon-btn-ghost" href={`mailto:${c.contact_email}?subject=${encodeURIComponent(`Exploring opportunities at ${c.company || "your team"}`)}`}>Compose</a>
                          <button className="recon-btn-ghost recon-btn-danger" onClick={() => removeContact(c.id)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </main>
          </div>
        )}

        {/* Bulk mode */}
        {mode === "bulk" && (
          <div className="recon-tile" style={{ maxWidth: 960 }}>
            <div className="recon-tile-eyebrow" style={{ color: "var(--primary)" }}>BULK RECON</div>
            <h2 className="recon-tile-h2">Many people · one domain</h2>
            <p className="recon-tile-sub">Paste names one per line — pattern is verified against a sample before applying to all.</p>

            <form onSubmit={handleBulk} className="recon-form recon-form--bulk">
              <Field label="Company name or domain">
                <input className="recon-input" placeholder="Nvidia · or · nvidia.com" value={bulkCompany} onChange={(e) => setBulkCompany(e.target.value)} />
              </Field>
              <Field label="Names — one per line">
                <textarea
                  className="recon-input recon-textarea"
                  placeholder={"Jane Doe\nJohn Smith\nMaria Garcia"}
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  rows={10}
                />
              </Field>
              <button type="submit" className="recon-btn-primary" disabled={loading || !bulkCompany.trim() || !bulkNames.trim()}>
                {loading ? "Finding…" : "Find all emails"}
              </button>
            </form>

            {error && <div className="recon-error">{error}</div>}

            {bulkResult && (
              <div style={{ marginTop: 20 }}>
                <div className="recon-bulk-meta">
                  <span className={`recon-verified-badge${bulkResult.patternBasis !== "verified" ? " warn" : ""}`}>
                    {bulkResult.patternBasis === "verified" ? "VERIFIED ✓" : "UNVERIFIED"}
                  </span>
                  <span className="recon-pattern">{bulkResult.rows.length} emails · pattern: {bulkResult.pattern}</span>
                </div>
                <p className="recon-tile-sub">{bulkResult.note}</p>
                <div className="recon-row-actions" style={{ marginBottom: 12 }}>
                  <button className="recon-btn-ghost" onClick={copyAllBulk}>Copy all</button>
                  <button className="recon-btn-ghost" onClick={downloadBulkCsv}>Download CSV</button>
                </div>
                <div className="recon-bulk-list">
                  {bulkResult.rows.map((r) => (
                    <div key={r.name + r.email} className="recon-bulk-row">
                      <span className="recon-contact-name">{r.name}</span>
                      <span className="recon-email-mono">{r.email || `(couldn't parse)`}</span>
                      {r.email && (
                        <div className="recon-row-actions">
                          <button className="recon-btn-ghost" onClick={() => copy(r.email)}>{copied === r.email ? "Copied ✓" : "Copy"}</button>
                          <a className="recon-btn-ghost" href={`mailto:${r.email}`}>Compose</a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Templates mode */}
        {mode === "templates" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="recon-tile">
              <div className="recon-tile-eyebrow">NEW TEMPLATE</div>
              <div className="recon-form">
                <Field label="Title" hint="optional">
                  <input className="recon-input" placeholder="e.g. Direct intro with metric" value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} />
                </Field>
                <Field label="Template body">
                  <textarea className="recon-input recon-textarea" placeholder="Paste your outreach email here…" value={tplBody} onChange={(e) => setTplBody(e.target.value)} rows={8} />
                </Field>
                <button className="recon-btn-primary" onClick={saveTemplate} disabled={!tplBody.trim()}>Save template</button>
              </div>
            </div>

            {templates.length > 0 && (
              <div className="recon-tile">
                <div className="recon-tile-eyebrow">SAVED TEMPLATES · {templates.length}</div>
                <div className="recon-template-list">
                  {templates.map((t) => (
                    <div key={t.id} className="recon-template-card">
                      <div className="recon-template-head">
                        <span className="recon-contact-name">{t.title || "Untitled"}</span>
                        <div className="recon-row-actions">
                          <button className="recon-btn-ghost" onClick={() => copy(t.body)}>{copied === t.body ? "Copied ✓" : "Copy"}</button>
                          <button className="recon-btn-ghost recon-btn-danger" onClick={() => removeTemplate(t.id)}>Remove</button>
                        </div>
                      </div>
                      <pre className="recon-template-body">{t.body}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
