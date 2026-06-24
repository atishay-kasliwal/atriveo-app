import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Search,
  Sparkles,
  Clock,
  Flame,
  Snowflake,
  ArrowUpRight,
  X,
  Bell,
  CheckSquare,
  Square,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/unclicked-100")({
  head: () => ({ meta: [{ title: "Backlog — Atriveo" }] }),
  component: BacklogPage,
});

type Job = {
  id: string;
  score: number;
  company: string;
  logo: string;
  logoBg: string;
  logoFg?: string;
  role: string;
  match: "STRONG MATCH" | "GOOD MATCH";
  matchStars: number;
  date: string;
  ageDays: number;
  location: string;
  level: "New Grad" | "Entry" | "Mid";
  raw: string;
  tags?: string[];
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "fresh", label: "Fresh · ≤2d" },
  { id: "warm", label: "Warm · 3-5d" },
  { id: "cold", label: "Cold · 6d+" },
  { id: "newgrad", label: "New Grad" },
  { id: "entry", label: "Entry" },
  { id: "mid", label: "Mid" },
];

const SORTS = [
  { id: "score", label: "Score" },
  { id: "age", label: "Age" },
  { id: "company", label: "Company" },
];

const JOBS: Job[] = [
  { id: "1", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", ageDays: 2, location: "Jericho, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "2", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", ageDays: 2, location: "Rochester, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "3", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", ageDays: 2, location: "Williamsville, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "4", score: 84, company: "COGENT INFOTECH", logo: "◎", logoBg: "bg-zinc-200", logoFg: "text-zinc-900", role: "Software Application Engineer", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", ageDays: 2, location: "New York, United States", level: "Entry", raw: "Raw 250/250" },
  { id: "5", score: 88, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", ageDays: 2, location: "Raleigh, NC", level: "Mid", raw: "Raw 242/250" },
  { id: "6", score: 79, company: "TATA CONSULTANCY SERVICES", logo: "◐", logoBg: "bg-blue-100", logoFg: "text-blue-700", role: "Data Scientist", match: "STRONG MATCH", matchStars: 4, date: "Fri, Jun 19", ageDays: 1, location: "New York, NY", level: "Entry", raw: "Raw 212/250" },
  { id: "7", score: 75, company: "GOOGLE", logo: "G", logoBg: "bg-white", logoFg: "text-blue-600", role: "Software Engineer III — Cloud Bigtable SQL", match: "STRONG MATCH", matchStars: 4, date: "Wed, Jun 17", ageDays: 3, location: "New York, NY", level: "Mid", raw: "Raw 212/250" },
  { id: "8", score: 74, company: "SNAP INC.", logo: "S", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer, Backend, Level 4", match: "GOOD MATCH", matchStars: 3, date: "Sat, Jun 20", ageDays: 0, location: "New York, NY", level: "Entry", raw: "Raw 211/250", tags: ["Backend", "software", "Entry"] },
  { id: "9", score: 75, company: "SNAP INC.", logo: "S", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer, Backend, Level 5", match: "STRONG MATCH", matchStars: 5, date: "Fri, Jun 19", ageDays: 1, location: "New York, United States", level: "Entry", raw: "Raw 211/250" },
  { id: "10", score: 74, company: "OPENAI", logo: "✻", logoBg: "bg-white", logoFg: "text-black", role: "Backend Software Engineer (Evals)", match: "GOOD MATCH", matchStars: 4, date: "Thu, Jun 18", ageDays: 2, location: "Seattle, WA", level: "Entry", raw: "Raw 211/250", tags: ["AI", "Backend", "software"] },
  { id: "11", score: 71, company: "STRIPE", logo: "§", logoBg: "bg-indigo-100", logoFg: "text-indigo-700", role: "Backend Engineer — Payments Reliability", match: "GOOD MATCH", matchStars: 3, date: "Tue, Jun 16", ageDays: 4, location: "Remote, US", level: "Mid", raw: "Raw 198/250" },
  { id: "12", score: 68, company: "DOORDASH", logo: "◇", logoBg: "bg-rose-100", logoFg: "text-rose-700", role: "Software Engineer — Logistics Platform", match: "GOOD MATCH", matchStars: 3, date: "Mon, Jun 15", ageDays: 5, location: "San Francisco, CA", level: "Entry", raw: "Raw 184/250" },
  { id: "13", score: 65, company: "ADOBE", logo: "A.", logoBg: "bg-red-100", logoFg: "text-red-700", role: "Software Engineer — Document Cloud", match: "GOOD MATCH", matchStars: 3, date: "Sun, Jun 14", ageDays: 6, location: "Seattle, WA", level: "Mid", raw: "Raw 176/250" },
  { id: "14", score: 62, company: "ATLASSIAN", logo: "▲", logoBg: "bg-sky-100", logoFg: "text-sky-700", role: "Software Engineer — Jira Platform", match: "GOOD MATCH", matchStars: 2, date: "Sat, Jun 13", ageDays: 7, location: "Mountain View, CA", level: "Mid", raw: "Raw 168/250" },
];

function ageBucket(d: number): "fresh" | "warm" | "cold" {
  if (d <= 2) return "fresh";
  if (d <= 5) return "warm";
  return "cold";
}

function AgePill({ days }: { days: number }) {
  const bucket = ageBucket(days);
  const cfg = {
    fresh: { icon: Flame, cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", label: "FRESH" },
    warm: { icon: Clock, cls: "border-amber-400/30 bg-amber-400/10 text-amber-300", label: "WARM" },
    cold: { icon: Snowflake, cls: "border-sky-400/30 bg-sky-400/10 text-sky-300", label: "COLD" },
  }[bucket];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${cfg.cls}`}>
      <Icon size={10} /> {cfg.label} · {days}d
    </span>
  );
}

function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : score >= 70
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return (
    <div className={`grid h-11 w-11 place-items-center rounded-lg border font-mono text-sm font-bold tabular-nums ${tone}`}>
      {score}
    </div>
  );
}

function BacklogPage() {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("score");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const out = JOBS.filter((j) => {
      if (dismissed.has(j.id) || snoozed.has(j.id)) return false;
      const b = ageBucket(j.ageDays);
      if (filter === "fresh" && b !== "fresh") return false;
      if (filter === "warm" && b !== "warm") return false;
      if (filter === "cold" && b !== "cold") return false;
      if (filter === "newgrad" && j.level !== "New Grad") return false;
      if (filter === "entry" && j.level !== "Entry") return false;
      if (filter === "mid" && j.level !== "Mid") return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !j.role.toLowerCase().includes(q) &&
          !j.company.toLowerCase().includes(q) &&
          !j.location.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sort === "age") return a.ageDays - b.ageDays;
      if (sort === "company") return a.company.localeCompare(b.company);
      return b.score - a.score;
    });
    return out;
  }, [filter, sort, query, dismissed, snoozed]);

  // group by age bucket
  const groups = useMemo(() => {
    const g: Record<"fresh" | "warm" | "cold", Job[]> = { fresh: [], warm: [], cold: [] };
    filtered.forEach((j) => g[ageBucket(j.ageDays)].push(j));
    return g;
  }, [filtered]);

  const allSelected = selected.size === filtered.length && filtered.length > 0;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((j) => j.id)));
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
  };
  const snooze = (id: string) => {
    const next = new Set(snoozed);
    next.add(id);
    setSnoozed(next);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <div className="mx-auto max-w-[1400px] px-6 py-6">
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
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">BACKLOG · UNCLICKED 100+</div>
              <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight">
                High-score jobs{" "}
                <span className="bg-gradient-to-r from-primary to-sky-300 bg-clip-text text-transparent">
                  waiting for a decision.
                </span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Triage by age — clear fresh leads first, snooze warm ones for later, dismiss cold roles that no longer fit. Promote winners straight into Loadout.
              </p>
            </div>
            <div className="flex gap-8 pr-2">
              <HeroStat label="OPEN" value={String(filtered.length)} />
              <HeroStat label="DISMISSED" value={String(dismissed.size)} />
              <HeroStat label="SNOOZED" value={String(snoozed.size)} accent />
            </div>
          </div>
        </section>

        {/* Stat strip */}
        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard accent="bg-emerald-400" value={String(groups.fresh.length)} label="FRESH ≤ 2D" sub="hit these first" />
          <StatCard accent="bg-amber-400" value={String(groups.warm.length)} label="WARM 3–5D" sub="still actionable" />
          <StatCard accent="bg-sky-400" value={String(groups.cold.length)} label="COLD 6D+" sub="decide or drop" />
          <StatCard accent="bg-primary" value={String(JOBS.length)} label="TOTAL BACKLOG" sub="this week" />
        </section>

        {/* Search + filters */}
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5">
          <Search size={15} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search backlog — role, company, location…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filter === f.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
            <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground">SORT</span>
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                  sort === s.id
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Bulk bar */}
        <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground"
            >
              {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
              {allSelected ? "Clear" : "Select all"}
            </button>
            <div className="font-mono text-[11px] tracking-wider text-muted-foreground">
              {selected.size} of {filtered.length} selected
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Bell size={12} /> Snooze
            </button>
            <button
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X size={12} /> Dismiss
            </button>
            <button
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles size={12} /> Analyze
            </button>
            <button
              disabled={selected.size === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Promote to Loadout {selected.size > 0 && `· ${selected.size}`}
            </button>
          </div>
        </section>

        {/* Grouped sections */}
        {filtered.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 p-16 text-center">
            <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">QUEUE CLEAR</div>
            <div className="mt-2 text-lg font-semibold">Backlog empty for this filter.</div>
            <div className="mt-1 text-sm text-muted-foreground">Try a different age bucket, or head back to Signal.</div>
            <Link to="/feed" className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              Go to Signal <ArrowUpRight size={12} />
            </Link>
          </div>
        ) : (
          (["fresh", "warm", "cold"] as const).map((bucket) =>
            groups[bucket].length > 0 ? (
              <BucketGroup
                key={bucket}
                bucket={bucket}
                jobs={groups[bucket]}
                selected={selected}
                onToggle={toggle}
                onDismiss={dismiss}
                onSnooze={snooze}
              />
            ) : null,
          )
        )}
      </div>
    </div>
  );
}

function BucketGroup({
  bucket,
  jobs,
  selected,
  onToggle,
  onDismiss,
  onSnooze,
}: {
  bucket: "fresh" | "warm" | "cold";
  jobs: Job[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const meta = {
    fresh: { label: "FRESH · ≤ 2 DAYS", accent: "bg-emerald-400", desc: "Strike while listings are warm." },
    warm: { label: "WARM · 3–5 DAYS", accent: "bg-amber-400", desc: "Still open, decide soon." },
    cold: { label: "COLD · 6+ DAYS", accent: "bg-sky-400", desc: "Likely stale — promote or dismiss." },
  }[bucket];
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <span className={`h-2 w-2 rounded-full ${meta.accent}`} />
        <h2 className="font-mono text-[11px] font-bold tracking-[0.22em] text-foreground">{meta.label}</h2>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{jobs.length}</span>
        <span className="text-xs text-muted-foreground">· {meta.desc}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            selected={selected.has(j.id)}
            onToggle={() => onToggle(j.id)}
            onDismiss={() => onDismiss(j.id)}
            onSnooze={() => onSnooze(j.id)}
          />
        ))}
      </div>
    </section>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-3xl font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function StatCard({ accent, value, label, sub }: { accent: string; value: string; label: string; sub: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4">
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent}`} />
      <div className="font-mono text-3xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-2 font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function JobCard({
  job,
  selected,
  onToggle,
  onDismiss,
  onSnooze,
}: {
  job: Job;
  selected: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-3.5 transition hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 ${
        selected ? "border-primary/60 ring-2 ring-primary/30" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScoreChip score={job.score} />
          <button
            onClick={onToggle}
            className={`grid h-6 w-6 place-items-center rounded border transition ${
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background/60 text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
            aria-label="Select job"
          >
            {selected ? <CheckSquare size={12} /> : <Square size={12} />}
          </button>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${job.logoBg} ${job.logoFg ?? ""}`}>
          <span className="text-sm font-bold">{job.logo}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <AgePill days={job.ageDays} />
        <span
          className={`font-mono text-[9px] font-bold tracking-[0.18em] ${
            job.match === "STRONG MATCH" ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          {job.match}
        </span>
      </div>

      <div className="mt-2 truncate font-mono text-[11px] font-bold tracking-[0.18em] text-primary">
        {job.company}
      </div>
      <div className="mt-1 line-clamp-2 min-h-[2.6em] text-sm font-semibold leading-snug text-foreground">
        {job.role}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        <span className="truncate">{job.location}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Pill>{job.level}</Pill>
        <Pill muted>{job.raw}</Pill>
        {job.tags?.slice(0, 2).map((t) => (
          <Pill key={t} tone="primary">
            {t}
          </Pill>
        ))}
      </div>

      {/* Action row */}
      <div className="mt-3.5 grid grid-cols-3 gap-1.5 border-t border-border pt-3">
        <button
          onClick={onSnooze}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background/60 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-amber-400/40 hover:text-amber-300"
        >
          <Bell size={11} /> Snooze
        </button>
        <button
          onClick={onDismiss}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background/60 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-rose-400/40 hover:text-rose-300"
        >
          <X size={11} /> Dismiss
        </button>
        <Link
          to="/tailor"
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary py-1.5 text-[11px] font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-110"
        >
          Promote <ArrowUpRight size={11} />
        </Link>
      </div>
    </div>
  );
}

function Pill({
  children,
  muted,
  tone,
}: {
  children: React.ReactNode;
  muted?: boolean;
  tone?: "primary";
}) {
  const cls =
    tone === "primary"
      ? "border-primary/30 bg-primary/10 text-primary"
      : muted
      ? "border-border bg-background/40 text-muted-foreground"
      : "border-border bg-background/60 text-foreground/80";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}
