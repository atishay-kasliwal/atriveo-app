import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Search,
  Copy,
  Mail,
  Trash2,
  Check,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  ArrowUpDown,
  Building2,
  Upload,
  Star,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/emailfinder")({
  head: () => ({ meta: [{ title: "Recon — Atriveo" }] }),
  component: EmailFinderPage,
});

type Result = {
  email: string;
  pattern: string;
  confidence: number;
  verified: "ok" | "risky" | "unknown";
};

type Contact = {
  id: string;
  email: string;
  name: string;
  confidence: number;
  source: string;
  company: string;
  starred?: boolean;
};

const SAVED: Contact[] = [
  { id: "1", email: "maria.marez@misste.com", name: "Maria Fernandez", confidence: 92, source: "quickenrich", company: "Misste", starred: true },
  { id: "2", email: "jordan.lee@stripe.com", name: "Jordan Lee", confidence: 84, source: "pattern", company: "Stripe" },
  { id: "3", email: "ravi.patel@stripe.com", name: "Ravi Patel", confidence: 71, source: "pattern", company: "Stripe" },
  { id: "4", email: "alex.kim@openai.com", name: "Alex Kim", confidence: 88, source: "verified", company: "OpenAI", starred: true },
  { id: "5", email: "sam.ortiz@openai.com", name: "Sam Ortiz", confidence: 62, source: "pattern", company: "OpenAI" },
];

function buildResults(name: string, company: string): Result[] {
  const parts = name.trim().toLowerCase().split(/\s+/);
  const first = parts[0] || "first";
  const last = parts[parts.length - 1] || "last";
  const domain =
    company.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\s+/g, "") +
    (company.includes(".") ? "" : ".com");
  return [
    { email: `${first}.${last}@${domain}`, pattern: "{first}.{last}", confidence: 86, verified: "ok" },
    { email: `${first}${last}@${domain}`, pattern: "{first}{last}", confidence: 71, verified: "ok" },
    { email: `${first[0]}${last}@${domain}`, pattern: "{f}{last}", confidence: 64, verified: "risky" },
    { email: `${first}@${domain}`, pattern: "{first}", confidence: 41, verified: "unknown" },
    { email: `${first}_${last}@${domain}`, pattern: "{first}_{last}", confidence: 28, verified: "unknown" },
  ];
}

function ConfidenceBar({ value }: { value: number }) {
  const tone = value > 70 ? "bg-emerald-500" : value > 40 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
      <div className={`h-full ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function VerifyBadge({ state }: { state: Result["verified"] }) {
  if (state === "ok")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-emerald-300">
        <ShieldCheck size={10} /> SMTP OK
      </span>
    );
  if (state === "risky")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-300">
        <ShieldAlert size={10} /> RISKY
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-muted-foreground">
      ? UNVERIFIED
    </span>
  );
}

type SortKey = "confidence" | "email" | "pattern";

function EmailFinderPage() {
  const [mode, setMode] = useState<"one" | "bulk" | "templates">("one");
  const [name, setName] = useState("Jane Doe");
  const [company, setCompany] = useState("acme.com");
  const [linkedin, setLinkedin] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkDomain, setBulkDomain] = useState("");
  const [bulkPattern, setBulkPattern] = useState("{first}.{last}");
  const [results, setResults] = useState<Result[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [savedFilter, setSavedFilter] = useState("");

  const find = () => {
    if (!name || !company) return;
    setResults(buildResults(name, company));
  };

  const copy = (email: string) => {
    if (typeof navigator !== "undefined") navigator.clipboard?.writeText(email);
    setCopied(email);
    setTimeout(() => setCopied(null), 1200);
  };

  const sortedResults = useMemo(() => {
    if (!results) return null;
    const out = [...results];
    out.sort((a, b) => {
      if (sortKey === "confidence") return b.confidence - a.confidence;
      if (sortKey === "email") return a.email.localeCompare(b.email);
      return a.pattern.localeCompare(b.pattern);
    });
    return out;
  }, [results, sortKey]);

  const grouped = useMemo(() => {
    const filtered = SAVED.filter((c) => {
      if (!savedFilter) return true;
      const q = savedFilter.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q)
      );
    });
    return filtered.reduce<Record<string, Contact[]>>((acc, c) => {
      (acc[c.company] ||= []).push(c);
      return acc;
    }, {});
  }, [savedFilter]);

  const bulkPreview = useMemo(() => {
    if (!bulk.trim()) return [];
    const domain = bulkDomain.trim() || "acme.com";
    return bulk
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((name) => {
        const parts = name.toLowerCase().split(/\s+/);
        const first = parts[0] || "";
        const last = parts[parts.length - 1] || "";
        const email = bulkPattern
          .replace("{first}", first)
          .replace("{last}", last)
          .replace("{f}", first[0] || "")
          .replace("{l}", last[0] || "");
        return { name, email: `${email}@${domain}` };
      });
  }, [bulk, bulkDomain, bulkPattern]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      {/* Hero */}
      <div className="mx-auto max-w-[1400px] px-6 pt-6">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-7">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">RECON · OUTREACH</div>
              <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
                Triangulate a{" "}
                <span className="bg-gradient-to-r from-primary to-sky-300 bg-clip-text text-transparent">
                  recruiter's email.
                </span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Rank likely patterns, verify domain delivery, and queue saved contacts by company so outreach is one click away.
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-background/60 p-1 backdrop-blur">
              {([
                { id: "one", label: "One person" },
                { id: "bulk", label: "Bulk" },
                { id: "templates", label: "Templates" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMode(t.id)}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                    mode === t.id
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {mode === "one" && (
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[420px_minmax(0,1fr)]">
          {/* Left: form */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-primary">QUERY</div>
              <h2 className="mt-2 text-lg font-bold">Recipient details</h2>

              <div className="mt-5 space-y-4">
                <Field label="Full name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </Field>
                <Field label="Company name or domain">
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="acme.com"
                    className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </Field>
                <Field label="LinkedIn URL" hint="optional · exact match via QuickEnrich">
                  <input
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/in/janedoe"
                    className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </Field>
              </div>

              <button
                onClick={find}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110"
              >
                <Search size={15} /> Run recon
              </button>
            </div>

            {/* Domain status */}
            <div className="mt-4 rounded-2xl border border-border bg-card p-4">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">DOMAIN STATUS</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-500/15 text-emerald-300">
                  <ShieldCheck size={14} />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-semibold">{company || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">MX ok · catch-all: no · disposable: no</div>
                </div>
              </div>
            </div>

            <p className="mt-4 px-1 text-xs text-muted-foreground">
              Email patterns are educated guesses. Always verify before sending.
            </p>
          </aside>

          {/* Right: results + saved */}
          <main className="space-y-6">
            <section className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                    PREDICTED EMAILS
                  </div>
                  <h2 className="mt-2 text-lg font-bold">
                    {sortedResults ? `${sortedResults.length} candidates` : "Run recon to see candidates"}
                  </h2>
                </div>
                {sortedResults && (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground">SORT</span>
                    {(["confidence", "email", "pattern"] as SortKey[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setSortKey(k)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
                          sortKey === k
                            ? "bg-foreground/10 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <ArrowUpDown size={10} /> {k}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {!sortedResults && (
                <div className="mt-6 grid place-items-center rounded-xl border border-dashed border-border bg-background/40 py-16 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
                    <Mail size={20} />
                  </div>
                  <p className="mt-3 text-sm font-semibold">Nothing here yet</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    Fill in a name and company, then click <span className="font-semibold">Run recon</span> to generate ranked candidates.
                  </p>
                </div>
              )}

              {sortedResults && (
                <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {sortedResults.map((r, i) => (
                    <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 bg-background/40 px-4 py-3.5">
                      <span className="grid h-7 w-7 place-items-center rounded-md bg-card font-mono text-[11px] font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-mono text-sm font-semibold text-foreground">{r.email}</div>
                          <VerifyBadge state={r.verified} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-3">
                          <span className="font-mono text-[10px] text-muted-foreground">{r.pattern}</span>
                          <div className="w-28">
                            <ConfidenceBar value={r.confidence} />
                          </div>
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              r.confidence > 70
                                ? "text-emerald-400"
                                : r.confidence > 40
                                ? "text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {r.confidence}%
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground/80 transition hover:border-primary/40 hover:text-foreground">
                          <ShieldCheck size={12} /> Verify
                        </button>
                        <button
                          onClick={() => copy(r.email)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground/80 transition hover:border-primary/40 hover:text-foreground"
                        >
                          {copied === r.email ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          {copied === r.email ? "Copied" : "Copy"}
                        </button>
                        <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
                          <Mail size={12} /> Compose
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Saved — grouped by company */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                    SAVED CONTACTS · {SAVED.length}
                  </div>
                  <h2 className="mt-2 text-lg font-bold">Recruiter book · by company</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5">
                    <Search size={12} className="text-muted-foreground" />
                    <input
                      value={savedFilter}
                      onChange={(e) => setSavedFilter(e.target.value)}
                      placeholder="Filter contacts…"
                      className="w-44 bg-transparent text-xs focus:outline-none"
                    />
                  </div>
                  <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:brightness-110">
                    View all <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-5">
                {Object.entries(grouped).map(([companyName, contacts]) => (
                  <div key={companyName}>
                    <div className="flex items-center gap-2">
                      <Building2 size={12} className="text-muted-foreground" />
                      <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                        {companyName.toUpperCase()}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">· {contacts.length}</span>
                      <div className="ml-2 h-px flex-1 bg-border" />
                    </div>
                    <div className="mt-2 space-y-2">
                      {contacts.map((c) => (
                        <div
                          key={c.id}
                          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-background/40 p-3"
                        >
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
                            {c.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-bold">
                              {c.name}
                              {c.starred && <Star size={11} className="fill-amber-400 text-amber-400" />}
                            </div>
                            <div className="truncate font-mono text-xs text-muted-foreground">
                              {c.email} · {c.confidence}% · {c.source}
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => copy(c.email)}
                              className="rounded-md border border-border bg-card p-2 text-foreground/70 transition hover:border-primary/40 hover:text-foreground"
                            >
                              <Copy size={13} />
                            </button>
                            <button className="rounded-md bg-primary p-2 text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
                              <Mail size={13} />
                            </button>
                            <button className="rounded-md border border-border bg-card p-2 text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-400">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(grouped).length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center text-xs text-muted-foreground">
                    No saved contacts match "{savedFilter}".
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      )}

      {mode === "bulk" && (
        <div className="mx-auto max-w-[1200px] px-6 py-10">
          <div className="rounded-2xl border border-border bg-card p-7">
            <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-primary">BULK RECON</div>
            <h2 className="mt-2 text-xl font-bold">Many people · one domain</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste names (or a CSV with one name per line) and pick a pattern. Preview updates live before you generate.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
              <Field label="Names · one per line (or pasted CSV)">
                <textarea
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  rows={12}
                  placeholder={"Jane Doe\nJohn Smith\nMaria Fernandez"}
                  className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 font-mono text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </Field>
              <div className="space-y-4">
                <Field label="Company domain">
                  <input
                    value={bulkDomain}
                    onChange={(e) => setBulkDomain(e.target.value)}
                    placeholder="acme.com"
                    className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </Field>
                <Field label="Pattern">
                  <select
                    value={bulkPattern}
                    onChange={(e) => setBulkPattern(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="{first}.{last}">{`{first}.{last}@domain`}</option>
                    <option value="{first}{last}">{`{first}{last}@domain`}</option>
                    <option value="{f}{last}">{`{f}{last}@domain`}</option>
                    <option value="{first}">{`{first}@domain`}</option>
                  </select>
                </Field>
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
                  <Upload size={15} /> Generate {bulkPreview.length > 0 && `· ${bulkPreview.length}`}
                </button>
              </div>
            </div>

            {/* Live preview */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                  LIVE PREVIEW {bulkPreview.length > 0 && `· first ${bulkPreview.length}`}
                </span>
                {bulkPreview.length > 0 && (
                  <button
                    onClick={() => copy(bulkPreview.map((p) => p.email).join("\n"))}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground/80 hover:text-foreground"
                  >
                    <Copy size={11} /> Copy all
                  </button>
                )}
              </div>
              {bulkPreview.length === 0 ? (
                <div className="mt-2 rounded-xl border border-dashed border-border bg-background/40 px-4 py-10 text-center text-xs text-muted-foreground">
                  Paste names to preview generated emails here.
                </div>
              ) : (
                <div className="mt-2 overflow-hidden rounded-xl border border-border">
                  {bulkPreview.map((p, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 border-b border-border/60 bg-background/40 px-4 py-2 last:border-b-0"
                    >
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="truncate text-xs text-foreground">{p.name}</span>
                      <span className="truncate font-mono text-xs text-primary">{p.email}</span>
                      <button
                        onClick={() => copy(p.email)}
                        className="rounded-md border border-border bg-card p-1.5 text-foreground/70 hover:text-foreground"
                      >
                        {copied === p.email ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === "templates" && (
        <div className="mx-auto max-w-[1200px] px-6 py-10">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: "Cold intro — referral request", tag: "INTRO", body: "Hi {first}, I came across {role} at {company} and your work caught my eye…" },
              { title: "Follow-up after applying", tag: "FOLLOWUP", body: "Hi {first}, I applied to {role} last week and wanted to flag my application…" },
              { title: "Recruiter outreach", tag: "RECRUITER", body: "Hi {first}, I noticed {company} is hiring for {role} — happy to share evidence of…" },
              { title: "Networking — coffee chat", tag: "NETWORK", body: "Hi {first}, your path into {company} resonated. Could I grab 15 minutes…" },
            ].map((t, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6 transition hover:border-primary/40">
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
                    {t.tag}
                  </span>
                  <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground/80 transition hover:border-primary/40 hover:text-foreground">
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <div className="mt-3 text-base font-bold">{t.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
          {label.toUpperCase()}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
