import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  X,
  Activity,
  Ban,
  Filter,
  FileText,
  Check,
  AlertTriangle,
  Search,
  Copy,
  Link2,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Console — Atriveo" }] }),
  component: SettingsPage,
});

const INITIAL_COMPANIES = [
  "sundayy", "tiktok usds joint venture", "tiktok", "jobright.ai",
  "mygwork - lgbtq+ business community", "teksystems", "jobgether",
  "epic", "jobs via efinancialcareers", "hackajob", "fetchjobs.co",
  "tristar skyline medical center", "dataannotation", "accenture poland",
  "chatgpt jobs", "quik hire staffing", "sotalent", "chord specialty dental partners",
];

type SectionId = "compiler" | "companies" | "keywords" | "resume";

const SECTIONS: { id: SectionId; label: string; icon: typeof Activity; desc: string }[] = [
  { id: "compiler", label: "Compiler health", icon: Activity, desc: "Pipeline status & buckets" },
  { id: "companies", label: "Blocked companies", icon: Ban, desc: "Hide jobs by employer" },
  { id: "keywords", label: "Blocked keywords", icon: Filter, desc: "Hide jobs by title" },
  { id: "resume", label: "Resume textarea", icon: FileText, desc: "Legacy skills text" },
];

function ChipInput({
  placeholder,
  items,
  onAdd,
  onRemove,
  empty,
  searchPlaceholder,
}: {
  placeholder: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  empty: string;
  searchPlaceholder: string;
}) {
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState("");
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue("");
  };
  const visible = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((i) => i.toLowerCase().includes(q));
  }, [items, filter]);
  return (
    <>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110"
        >
          Add
        </button>
      </div>

      {items.length > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {visible.length}/{items.length}
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-4 text-sm italic text-muted-foreground">{empty}</p>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-sm italic text-muted-foreground">No matches for "{filter}".</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {visible.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground/85 transition hover:border-primary/40 hover:text-foreground"
            >
              {item}
              <button
                onClick={() => onRemove(item)}
                className="text-muted-foreground transition hover:text-rose-400"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function isSection(v: string): v is SectionId {
  return v === "compiler" || v === "companies" || v === "keywords" || v === "resume";
}

function SettingsPage() {
  const [active, setActive] = useState<SectionId>(() => {
    if (typeof window !== "undefined") {
      const h = window.location.hash.replace("#", "");
      if (isSection(h)) return h;
    }
    return "compiler";
  });
  const [companies, setCompanies] = useState<string[]>(INITIAL_COMPANIES);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // sync active section <-> URL hash
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== `#${active}`) {
      window.history.replaceState(null, "", `#${active}`);
    }
  }, [active]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (isSection(h)) setActive(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const copy = (txt: string, key: string) => {
    if (typeof navigator !== "undefined") navigator.clipboard?.writeText(txt);
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const copySectionLink = (id: SectionId) => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    copy(url, `link-${id}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <div className="mx-auto max-w-[1300px] px-6 pt-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-7">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                CONSOLE · SYSTEM CONTROL
              </div>
              <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
                Compiler &{" "}
                <span className="bg-gradient-to-r from-primary to-sky-300 bg-clip-text text-transparent">
                  feed filters.
                </span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Watch the evidence compiler, prune the firehose, and keep the legacy resume cache. Each section is deep-linkable — share a URL straight to any panel.
              </p>
            </div>
            <div className="flex gap-10 pr-2">
              <div className="text-right">
                <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">BANK</div>
                <div className="mt-1 text-2xl font-bold tracking-tight">v51</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">SIDECAR</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-rose-400">Down</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">TODAY</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-primary">0</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mx-auto grid max-w-[1300px] grid-cols-1 gap-8 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">SECTIONS</div>
          <p className="mt-2 text-sm text-muted-foreground">Jump to any panel — URL syncs to the hash.</p>

          <nav className="mt-5 space-y-1">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                    isActive
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-card"
                  }`}
                >
                  <div
                    className={`mt-0.5 grid h-8 w-8 place-items-center rounded-lg ${
                      isActive ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                    }`}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>
                      {s.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.desc}</div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      copySectionLink(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        copySectionLink(s.id);
                      }
                    }}
                    className="mt-1 grid h-6 w-6 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-background hover:text-foreground"
                    title="Copy deep link"
                  >
                    {copied === `link-${s.id}` ? <Check size={11} className="text-emerald-400 opacity-100" /> : <Link2 size={11} />}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
              SYSTEM
            </div>
            <div className="mt-3 space-y-2.5 text-sm">
              <Row label="Bank" value="v51" tone="ok" />
              <Row label="Sidecar" value="Down" tone="down" />
              <Row label="Today" value="0" />
              <Row label="JD buckets" value="63m ago" tone="ok" />
            </div>
          </div>
        </aside>

        {/* Content */}
        <main>
          {active === "compiler" && (
            <Panel
              title="Evidence compiler"
              subtitle="AC pipeline status — fixed 15-bullet layout. Resumes compile from the AC bank."
              onShare={() => copySectionLink("compiler")}
              shared={copied === "link-compiler"}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Tile icon={<AlertTriangle size={14} />} label="Sidecar" value="Down" tone="down" hint="Worker offline" />
                <Tile icon={<Check size={14} />} label="JD buckets" value="Fresh" tone="ok" hint="Updated 63m ago" />
                <Tile icon={<Check size={14} />} label="Bank" value="v51" tone="ok" hint="Planner v2 · Optimizer v4" />
                <Tile icon={<Check size={14} />} label="Artifacts" value="Collapse" tone="ok" hint="No backlog" />
              </div>

              <div className="mt-6 rounded-xl border border-border bg-card p-5">
                <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">DIAGNOSTICS</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Run any of these on your Mac to inspect the pipeline. Click to copy.
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    "npm run pipeline:status",
                    "npm run buckets:refresh",
                    "tail -f ~/Library/Logs/atriveo/compiler.log",
                  ].map((cmd) => {
                    const isCopied = copied === cmd;
                    return (
                      <button
                        key={cmd}
                        onClick={() => copy(cmd, cmd)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-2.5 font-mono text-sm text-foreground transition hover:border-primary/40 hover:bg-card"
                      >
                        <span className="truncate text-left">$ {cmd}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${
                            isCopied
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-card text-muted-foreground"
                          }`}
                        >
                          {isCopied ? <Check size={10} /> : <Copy size={10} />}
                          {isCopied ? "COPIED" : "COPY"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Panel>
          )}

          {active === "companies" && (
            <Panel
              title="Blocked Companies"
              subtitle="Jobs from these companies are hidden everywhere. Matched as substring, case-insensitive."
              counter={companies.length}
              onShare={() => copySectionLink("companies")}
              shared={copied === "link-companies"}
            >
              <ChipInput
                placeholder="Company name…"
                searchPlaceholder="Filter blocked companies…"
                items={companies}
                onAdd={(v) => setCompanies((c) => [...c, v])}
                onRemove={(v) => setCompanies((c) => c.filter((x) => x !== v))}
                empty="No companies blocked yet."
              />
            </Panel>
          )}

          {active === "keywords" && (
            <Panel
              title="Blocked Title Keywords"
              subtitle="Jobs whose title contains any of these words are hidden."
              counter={keywords.length}
              onShare={() => copySectionLink("keywords")}
              shared={copied === "link-keywords"}
            >
              <ChipInput
                placeholder="e.g. embedded, mobile, ios…"
                searchPlaceholder="Filter blocked keywords…"
                items={keywords}
                onAdd={(v) => setKeywords((c) => [...c, v])}
                onRemove={(v) => setKeywords((c) => c.filter((x) => x !== v))}
                empty="No keywords blocked yet."
              />
            </Panel>
          )}

          {active === "resume" && (
            <Panel
              title="Resume textarea"
              subtitle="Legacy skills-analysis text. Not used by the AC pipeline — kept for fallback only."
              onShare={() => copySectionLink("resume")}
              shared={copied === "link-resume"}
            >
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={14}
                placeholder="Paste raw resume text…"
                className="w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground/80 transition hover:border-primary/40 hover:text-foreground">
                  Clear
                </button>
                <button className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
                  Save
                </button>
              </div>
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "down" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono font-bold ${
          tone === "ok" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "down";
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`grid h-6 w-6 place-items-center rounded-md ${
            tone === "ok" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
          }`}
        >
          {icon}
        </span>
        <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={`mt-3 text-xl font-bold ${tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  counter,
  children,
  onShare,
  shared,
}: {
  title: string;
  subtitle: string;
  counter?: number;
  children: React.ReactNode;
  onShare?: () => void;
  shared?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-7">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {counter !== undefined && (
            <span className="rounded-full bg-primary/15 px-3 py-1 font-mono text-xs font-bold text-primary">
              {counter}
            </span>
          )}
          {onShare && (
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              {shared ? <Check size={11} className="text-emerald-400" /> : <Link2 size={11} />}
              {shared ? "LINK COPIED" : "COPY LINK"}
            </button>
          )}
        </div>
      </div>
      <div className="pt-6">{children}</div>
    </section>
  );
}
