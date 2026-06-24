import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Plus, MessageSquare, Sparkles } from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/weekly")({
  head: () => ({ meta: [{ title: "Weekly — Atriveo" }] }),
  component: FeedPage,
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
  location: string;
  level: "New Grad" | "Entry" | "Mid";
  raw: string;
  tags?: string[];
};

const DAYS = [
  { id: "all", label: "All Days", count: 4104, date: null as string | null },
  { id: "today", label: "Today", count: 87, date: "Today" },
  { id: "sat", label: "Sat, Jun 20", count: 603, date: "Sat, Jun 20" },
  { id: "fri", label: "Fri, Jun 19", count: 856, date: "Fri, Jun 19" },
  { id: "thu", label: "Thu, Jun 18", count: 1105, date: "Thu, Jun 18" },
  { id: "wed", label: "Wed, Jun 17", count: 1155, date: "Wed, Jun 17" },
  { id: "tue", label: "Tue, Jun 16", count: 298, date: "Tue, Jun 16" },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "newgrad", label: "New Grad" },
  { id: "entry", label: "Entry" },
  { id: "mid", label: "Mid" },
  { id: "top500", label: "Top 500" },
];

const JOBS: Job[] = [
  { id: "1", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", location: "Jericho, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "2", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", location: "Rochester, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "3", score: 90, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", location: "Williamsville, NY", level: "Mid", raw: "Raw 252/250" },
  { id: "4", score: 84, company: "COGENT INFOTECH", logo: "◎", logoBg: "bg-zinc-200", logoFg: "text-zinc-900", role: "Software Application Engineer", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", location: "New York, United States", level: "Entry", raw: "Raw 250/250" },
  { id: "5", score: 88, company: "DELOITTE", logo: "D.", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer III — Java Full Stack", match: "STRONG MATCH", matchStars: 5, date: "Thu, Jun 18", location: "Raleigh, NC", level: "Mid", raw: "Raw 242/250" },
  { id: "6", score: 79, company: "TATA CONSULTANCY SERVICES", logo: "◐", logoBg: "bg-blue-100", logoFg: "text-blue-700", role: "Data Scientist", match: "STRONG MATCH", matchStars: 4, date: "Fri, Jun 19", location: "New York, NY", level: "Entry", raw: "Raw 212/250" },
  { id: "7", score: 75, company: "GOOGLE", logo: "G", logoBg: "bg-white", logoFg: "text-blue-600", role: "Software Engineer III — Cloud Bigtable SQL", match: "STRONG MATCH", matchStars: 4, date: "Wed, Jun 17", location: "New York, NY", level: "Mid", raw: "Raw 212/250" },
  { id: "8", score: 74, company: "SNAP INC.", logo: "S", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer, Backend, Level 4", match: "GOOD MATCH", matchStars: 3, date: "Sat, Jun 20", location: "New York, NY", level: "Entry", raw: "Raw 211/250", tags: ["Backend", "software", "Entry"] },
  { id: "9", score: 75, company: "SNAP INC.", logo: "S", logoBg: "bg-white", logoFg: "text-black", role: "Software Engineer, Backend, Level 5", match: "STRONG MATCH", matchStars: 5, date: "Fri, Jun 19", location: "New York, United States", level: "Entry", raw: "Raw 211/250" },
  { id: "10", score: 74, company: "OPENAI", logo: "✻", logoBg: "bg-white", logoFg: "text-black", role: "Backend Software Engineer (Evals)", match: "GOOD MATCH", matchStars: 4, date: "Thu, Jun 18", location: "Seattle, WA", level: "Entry", raw: "Raw 211/250", tags: ["AI", "Backend", "software"] },
];




function Stars({ n }: { n: number }) {
  return (
    <span className="font-mono text-[11px] tracking-wider">
      <span className="text-amber-400">{"★".repeat(n)}</span>
      <span className="text-muted-foreground/30">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function FeedPage() {
  const [day, setDay] = useState("all");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return JOBS.filter((j) => {
      if (day !== "all") {
        const d = DAYS.find((x) => x.id === day)?.date;
        if (d && d !== "Today" && j.date !== d) return false;
      }
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
  }, [day, filter, query]);

  const allSelected = selected.size === filtered.length && filtered.length > 0;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((j) => j.id)));
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
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
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">DISPATCH · 7-DAY ARCHIVE</div>
              <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight">
                The week's signal{" "}
                <span className="bg-gradient-to-r from-primary to-sky-300 bg-clip-text text-transparent">
                  in one readable sweep.
                </span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Day chips, score filters, and bulk JD export — applied roles drop to the bottom so fresh leads stay up top.
              </p>
            </div>
            <div className="flex gap-8 pr-2">
              <HeroStat label="THIS WEEK" value="4,104" />
              <HeroStat label="COMPANIES" value="1,357" />
              <HeroStat label="TODAY" value="87" accent />
            </div>
          </div>
        </section>

        {/* Stat cards */}
        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard accent="bg-primary" value="4,104" label="THIS WEEK" sub="unique postings" />
          <StatCard accent="bg-zinc-400" value="1,357" label="COMPANIES" sub="unique employers" />
          <StatCard accent="bg-amber-400" value="252" label="TOP SCORE" sub="best match this week" />
          <StatCard accent="bg-rose-400" value="122" label="NEW GRAD" sub="entry-level roles" />
          <StatCard accent="bg-sky-400" value="87" label="TODAY'S NEW" sub="fresh postings" />
        </section>

        {/* Day chips */}
        <section className="mt-5 flex flex-wrap items-center gap-2">
          {DAYS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDay(d.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                day === d.id
                  ? "border-primary/60 bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                  : "border-border bg-card text-foreground/80 hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {d.label}
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  day === d.id ? "text-primary-foreground/80" : "text-muted-foreground"
                }`}
              >
                {d.count.toLocaleString()}
              </span>
            </button>
          ))}
        </section>

        {/* Search + filters */}
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5">
          <Search size={15} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, companies, locations…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <div className="flex gap-1.5">
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
        </section>

        <div className="mt-3 font-mono text-[11px] tracking-wider text-muted-foreground">
          {filtered.length.toLocaleString()} jobs · 118 New Grad · last 7 days
        </div>

        {/* Bulk copy */}
        <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-3">
          <div>
            <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-primary">BULK COPY</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">Select jobs to copy full JDs</div>
            <div className="text-xs text-muted-foreground">
              Copies title, company, scores, link, tags, and full JD when exported.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={toggleAll}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground"
            >
              {allSelected ? "Clear" : "Select all"}
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 hover:bg-accent hover:text-foreground">
              <Sparkles size={12} /> Analyze JDs
            </button>
            <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110">
              Copy selected {selected.size > 0 && `· ${selected.size}`}
            </button>
          </div>
        </section>

        {/* Job cards grid */}
        <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {filtered.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              selected={selected.has(j.id)}
              onToggle={() => toggle(j.id)}
            />
          ))}
        </section>
      </div>
    </div>
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

function StatCard({
  accent,
  value,
  label,
  sub,
}: {
  accent: string;
  value: string;
  label: string;
  sub: string;
}) {
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
}: {
  job: Job;
  selected: boolean;
  onToggle: () => void;
}) {
  const scoreBg =
    job.score >= 85 ? "bg-primary text-primary-foreground" : "bg-card text-foreground border border-border";
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-3.5 transition hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 ${
        selected ? "border-primary/60 ring-2 ring-primary/30" : "border-border"
      }`}
    >
      {/* top row */}
      <div className="flex items-start justify-between">
        <div
          className={`grid h-10 w-10 place-items-center rounded-lg font-mono text-sm font-bold tabular-nums ${scoreBg} ${
            job.score >= 85 ? "shadow-lg shadow-primary/30" : ""
          }`}
        >
          {job.score}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`grid h-10 w-10 place-items-center rounded-lg ${job.logoBg} ${job.logoFg ?? ""}`}>
            <span className="text-sm font-bold">{job.logo}</span>
          </div>
          <button
            onClick={onToggle}
            className={`grid h-10 w-10 place-items-center rounded-lg border transition ${
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background/60 text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
            aria-label="Select job"
          >
            <Plus size={14} className={selected ? "rotate-45 transition" : "transition"} />
          </button>
        </div>
      </div>

      {/* company */}
      <div className="mt-3.5 truncate font-mono text-[11px] font-bold tracking-[0.18em] text-primary">
        {job.company}
      </div>

      {/* role */}
      <div className="mt-1 line-clamp-2 min-h-[2.6em] text-sm font-semibold leading-snug text-foreground">
        {job.role}
      </div>

      {/* match */}
      <div className="mt-2.5 flex items-center gap-2">
        <Stars n={job.matchStars} />
        <span
          className={`font-mono text-[9px] font-bold tracking-[0.18em] ${
            job.match === "STRONG MATCH" ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          {job.match}
        </span>
      </div>

      {/* date + location */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        <span className="truncate">
          {job.date} · {job.location}
        </span>
      </div>

      {/* tags */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Pill>{job.level}</Pill>
        <Pill muted>{job.raw}</Pill>
        {job.tags?.slice(0, 3).map((t) => (
          <Pill key={t} tone="primary">
            {t}
          </Pill>
        ))}
      </div>

      {/* actions */}
      <div className="mt-3.5 flex flex-col gap-1.5 border-t border-border pt-3">
        <button className="rounded-lg bg-foreground py-2 text-xs font-semibold text-background hover:opacity-90">
          Apply
        </button>
        <button className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background/60 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <MessageSquare size={11} /> Msg
        </button>
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
  const cls = tone === "primary"
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
