import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  Search,
  ArrowUpRight,
  Target,
  Zap,
  CircleCheck,
  CircleAlert,
  ChevronRight,
  Dumbbell,
  Flame,
  Clock,
  FileText,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/skills")({
  head: () => ({ meta: [{ title: "Arsenal — Atriveo" }] }),
  component: SkillsPage,
});

type Loadout = {
  name: string;
  category: string;
  proficiency: number; // 0-100
  level: "Mastered" | "Strong" | "Working" | "Rusty";
  lastUsed: string;
  proof: { label: string; href: string }[];
  tone: "emerald" | "primary" | "amber" | "rose";
};

const LOADOUTS: Loadout[] = [
  {
    name: "Python",
    category: "Languages",
    proficiency: 92,
    level: "Mastered",
    lastUsed: "today",
    tone: "emerald",
    proof: [
      { label: "evidence-compiler", href: "#" },
      { label: "atriveo-tailor", href: "#" },
    ],
  },
  {
    name: "TypeScript",
    category: "Languages",
    proficiency: 88,
    level: "Mastered",
    lastUsed: "today",
    tone: "emerald",
    proof: [
      { label: "Signal feed UI", href: "#" },
      { label: "tailor diff engine", href: "#" },
    ],
  },
  {
    name: "React",
    category: "Frameworks",
    proficiency: 84,
    level: "Strong",
    lastUsed: "this week",
    tone: "primary",
    proof: [{ label: "Atriveo dashboard", href: "#" }],
  },
  {
    name: "AWS",
    category: "Cloud",
    proficiency: 76,
    level: "Strong",
    lastUsed: "2 wk ago",
    tone: "primary",
    proof: [
      { label: "Heron ingestion stack", href: "#" },
      { label: "Lambda pipelines", href: "#" },
    ],
  },
  {
    name: "Postgres",
    category: "Data",
    proficiency: 72,
    level: "Strong",
    lastUsed: "this week",
    tone: "primary",
    proof: [{ label: "scoring schema", href: "#" }],
  },
  {
    name: "LLM / Agents",
    category: "AI / ML",
    proficiency: 70,
    level: "Strong",
    lastUsed: "today",
    tone: "primary",
    proof: [
      { label: "JD parser", href: "#" },
      { label: "tailor agent", href: "#" },
    ],
  },
  {
    name: "Kubernetes",
    category: "DevOps",
    proficiency: 48,
    level: "Working",
    lastUsed: "3 mo ago",
    tone: "amber",
    proof: [{ label: "Misste platform pod", href: "#" }],
  },
  {
    name: "Go",
    category: "Languages",
    proficiency: 32,
    level: "Rusty",
    lastUsed: "1 yr ago",
    tone: "rose",
    proof: [{ label: "Atriveo CLI prototype", href: "#" }],
  },
];

const TONE_MAP = {
  emerald: { ring: "ring-emerald-500/30", bar: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: "text-emerald-300" },
  primary: { ring: "ring-primary/30", bar: "bg-primary", chip: "bg-primary/15 text-primary border-primary/30", icon: "text-primary" },
  amber: { ring: "ring-amber-500/30", bar: "bg-amber-500", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: "text-amber-300" },
  rose: { ring: "ring-rose-500/30", bar: "bg-rose-500", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: "text-rose-300" },
} as const;

type Skill = { name: string; count: number; pct: number; onResume?: boolean };
type Category = { name: string; color: string; skills: Skill[] };

const TOP20: Skill[] = [
  { name: "Python", count: 20099, pct: 57 },
  { name: "Scalability", count: 13364, pct: 38 },
  { name: "Machine Learning", count: 10445, pct: 30 },
  { name: "Java", count: 10008, pct: 29 },
  { name: "AWS", count: 9629, pct: 27 },
  { name: "SQL", count: 8976, pct: 26 },
  { name: "Cross-Functional", count: 8734, pct: 25 },
  { name: "React", count: 6916, pct: 17 },
  { name: "Code Review", count: 6787, pct: 19 },
  { name: "Agents", count: 6683, pct: 19 },
  { name: "LLM", count: 6591, pct: 19 },
  { name: "JavaScript", count: 6433, pct: 18 },
  { name: "Mentorship", count: 6401, pct: 18 },
  { name: "Spark", count: 5887, pct: 6 },
  { name: "Agile/Scrum", count: 5525, pct: 15 },
  { name: "TypeScript", count: 5349, pct: 15 },
  { name: "Agile Systems", count: 5267, pct: 15 },
  { name: "CI/CD", count: 4966, pct: 20 },
  { name: "REST API", count: 4940, pct: 14 },
  { name: "Distributed Systems", count: 4915, pct: 14 },
];

const CATEGORIES: Category[] = [
  {
    name: "Languages",
    color: "violet",
    skills: [
      { name: "Python", count: 20099, pct: 57, onResume: true },
      { name: "Java", count: 10008, pct: 29 },
      { name: "SQL", count: 8976, pct: 26, onResume: true },
      { name: "JavaScript", count: 6433, pct: 18, onResume: true },
      { name: "TypeScript", count: 5349, pct: 15, onResume: true },
      { name: "Go", count: 911, pct: 3 },
      { name: "Rust", count: 1280, pct: 4 },
      { name: "Kotlin", count: 1624, pct: 5 },
    ],
  },
  {
    name: "Frameworks",
    color: "sky",
    skills: [
      { name: "React", count: 5887, pct: 17, onResume: true },
      { name: "PyTorch", count: 3488, pct: 10 },
      { name: "TensorFlow", count: 2739, pct: 8 },
      { name: "Node.js", count: 2076, pct: 6, onResume: true },
      { name: "LangChain", count: 1631, pct: 5 },
      { name: "Spring", count: 1543, pct: 5 },
      { name: "Pandas", count: 1606, pct: 5 },
      { name: "Flask", count: 718, pct: 2 },
    ],
  },
  {
    name: "Cloud",
    color: "emerald",
    skills: [
      { name: "AWS", count: 9629, pct: 27, onResume: true },
      { name: "Azure", count: 5525, pct: 16 },
      { name: "GCP", count: 4885, pct: 14 },
      { name: "S3", count: 1074, pct: 3, onResume: true },
      { name: "Lambda", count: 945, pct: 3 },
      { name: "DynamoDB", count: 571, pct: 2 },
      { name: "EKS", count: 341, pct: 1 },
      { name: "API Gateway", count: 423, pct: 1 },
    ],
  },
  {
    name: "Backend",
    color: "amber",
    skills: [
      { name: "Scalability", count: 13364, pct: 38, onResume: true },
      { name: "REST API", count: 4940, pct: 14, onResume: true },
      { name: "Distributed Systems", count: 4915, pct: 14 },
      { name: "Microservices", count: 2890, pct: 8, onResume: true },
      { name: "System Design", count: 2752, pct: 8 },
      { name: "Kafka", count: 1556, pct: 4 },
      { name: "gRPC", count: 813, pct: 1 },
      { name: "Caching", count: 854, pct: 2 },
    ],
  },
  {
    name: "DevOps",
    color: "rose",
    skills: [
      { name: "CI/CD", count: 6916, pct: 20, onResume: true },
      { name: "Kubernetes", count: 4280, pct: 12 },
      { name: "Docker", count: 4100, pct: 12, onResume: true },
      { name: "Git", count: 3848, pct: 11, onResume: true },
      { name: "Linux", count: 3047, pct: 9 },
      { name: "Terraform", count: 1807, pct: 5 },
      { name: "GitHub Actions", count: 681, pct: 2, onResume: true },
      { name: "Grafana", count: 479, pct: 1 },
    ],
  },
  {
    name: "Data",
    color: "cyan",
    skills: [
      { name: "ETL/ELT", count: 4993, pct: 14 },
      { name: "PostgreSQL", count: 2566, pct: 7, onResume: true },
      { name: "Spark", count: 2310, pct: 6 },
      { name: "Vector DB", count: 1740, pct: 5 },
      { name: "Snowflake", count: 1036, pct: 3 },
      { name: "MongoDB", count: 1007, pct: 3 },
      { name: "Airflow", count: 913, pct: 3 },
      { name: "Redis", count: 840, pct: 2, onResume: true },
    ],
  },
  {
    name: "AI / ML",
    color: "fuchsia",
    skills: [
      { name: "Machine Learning", count: 10445, pct: 30 },
      { name: "Agents", count: 6683, pct: 19 },
      { name: "LLM", count: 6591, pct: 19, onResume: true },
      { name: "GenAI", count: 4684, pct: 13, onResume: true },
      { name: "PyTorch", count: 3488, pct: 10 },
      { name: "RAG", count: 3064, pct: 9, onResume: true },
    ],
  },
  {
    name: "Security",
    color: "orange",
    skills: [
      { name: "OAuth/OIDC", count: 488, pct: 1 },
      { name: "Encryption", count: 430, pct: 1 },
      { name: "GDPR", count: 380, pct: 1 },
      { name: "IAM", count: 343, pct: 1 },
      { name: "JWT", count: 326, pct: 1, onResume: true },
      { name: "SOC 2", count: 311, pct: 1 },
    ],
  },
];

const COLOR_MAP: Record<string, { dot: string; bar: string; soft: string; ring: string; text: string }> = {
  violet: { dot: "bg-violet-400", bar: "bg-violet-500", soft: "bg-violet-500/10", ring: "ring-violet-500/30", text: "text-violet-300" },
  sky: { dot: "bg-sky-400", bar: "bg-sky-500", soft: "bg-sky-500/10", ring: "ring-sky-500/30", text: "text-sky-300" },
  emerald: { dot: "bg-emerald-400", bar: "bg-emerald-500", soft: "bg-emerald-500/10", ring: "ring-emerald-500/30", text: "text-emerald-300" },
  amber: { dot: "bg-amber-400", bar: "bg-amber-500", soft: "bg-amber-500/10", ring: "ring-amber-500/30", text: "text-amber-300" },
  rose: { dot: "bg-rose-400", bar: "bg-rose-500", soft: "bg-rose-500/10", ring: "ring-rose-500/30", text: "text-rose-300" },
  cyan: { dot: "bg-cyan-400", bar: "bg-cyan-500", soft: "bg-cyan-500/10", ring: "ring-cyan-500/30", text: "text-cyan-300" },
  fuchsia: { dot: "bg-fuchsia-400", bar: "bg-fuchsia-500", soft: "bg-fuchsia-500/10", ring: "ring-fuchsia-500/30", text: "text-fuchsia-300" },
  orange: { dot: "bg-orange-400", bar: "bg-orange-500", soft: "bg-orange-500/10", ring: "ring-orange-500/30", text: "text-orange-300" },
};

function SkillsPage() {
  const [tab, setTab] = useState<"market" | "gap">("market");
  const [query, setQuery] = useState("");

  const allSkills = useMemo(() => CATEGORIES.flatMap((c) => c.skills), []);
  const totals = useMemo(() => {
    const covered = allSkills.filter((s) => s.onResume).length;
    const missing = TOP20.filter((s) => !allSkills.find((x) => x.name === s.name && x.onResume)).length;
    const coverage = Math.round((covered / allSkills.length) * 100);
    return { analyzed: 35016, covered, missing, coverage, total: allSkills.length };
  }, [allSkills]);

  const filteredCats = useMemo(() => {
    if (!query) return CATEGORIES;
    const q = query.toLowerCase();
    return CATEGORIES.map((c) => ({
      ...c,
      skills: c.skills.filter((s) => s.name.toLowerCase().includes(q)),
    })).filter((c) => c.skills.length);
  }, [query]);

  const top10 = TOP20.slice(0, 10);
  const max = Math.max(...top10.map((s) => s.count));
  const gapList = TOP20.filter(
    (s) => !allSkills.find((x) => x.name === s.name && x.onResume),
  ).slice(0, 6);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/3 h-[520px] w-[520px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute top-1/4 right-0 h-[420px] w-[420px] rounded-full bg-blue-500/10 blur-[140px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
      </div>

      <TopNav />

      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Hero strip */}
        <section className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[10px] font-bold tracking-[0.22em] text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              ARSENAL · SKILLS INTELLIGENCE
            </div>

            <h1 className="mt-4 font-mono text-[44px] font-bold leading-[1.05] tracking-tight">
              Market signal,
              <br />
              <span className="bg-gradient-to-r from-primary via-blue-400 to-sky-300 bg-clip-text text-transparent">
                resume reality.
              </span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">
              {totals.analyzed.toLocaleString()} live job descriptions · pattern-matched against your resume ·
              <span className="text-foreground/80"> updated 6/23/2026</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 96 skills…"
                className="w-64 rounded-lg border border-border bg-card/60 py-2.5 pl-9 pr-3 text-xs font-medium text-foreground backdrop-blur placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3.5 py-2.5 text-xs font-semibold text-foreground backdrop-blur hover:border-primary/40 hover:bg-card">
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-primary to-blue-500 px-3.5 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110">
              <Target size={13} /> Tailor resume
            </button>
          </div>
        </section>

        {/* LOADED ARSENAL — proven skills with proficiency, last used, and evidence */}
        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                <Dumbbell size={11} className="text-primary" /> LOADED ARSENAL · {LOADOUTS.length} SKILLS
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                What you've actually shipped — proficiency, last used, and where you proved it.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Legend swatch="bg-emerald-500" label="Mastered" />
              <Legend swatch="bg-primary" label="Strong" />
              <Legend swatch="bg-amber-500" label="Working" />
              <Legend swatch="bg-rose-500" label="Rusty" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {LOADOUTS.map((l) => (
              <LoadoutCard key={l.name} loadout={l} />
            ))}
          </div>
        </section>



        {/* BENTO GRID */}
        <div className="mt-8 grid grid-cols-12 gap-4">
          {/* Coverage gauge — large feature tile */}
          <Tile className="col-span-12 row-span-2 md:col-span-5">
            <div className="flex h-full flex-col">
              <TileLabel icon={<Target size={11} />}>RESUME COVERAGE</TileLabel>
              <div className="mt-6 flex items-center justify-center">
                <Donut value={totals.coverage} />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-2 border-t border-border/60 pt-4">
                <DonutLegend swatch="bg-primary" label="Covered" value={totals.covered} />
                <DonutLegend swatch="bg-rose-400" label="Missing" value={totals.missing} />
                <DonutLegend swatch="bg-muted-foreground/40" label="Tracked" value={totals.total} />
              </div>
            </div>
          </Tile>

          {/* Top 10 demand viz */}
          <Tile className="col-span-12 row-span-2 md:col-span-7">
            <div className="flex items-start justify-between">
              <div>
                <TileLabel icon={<TrendingUp size={11} />}>TOP 10 · MARKET DEMAND</TileLabel>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Frequency across {totals.analyzed.toLocaleString()} JDs · gradient = on your resume
                </p>
              </div>
              <div className="flex gap-1 rounded-lg border border-border bg-background/60 p-0.5">
                {([
                  ["market", "Demand"],
                  ["gap", "Gap"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                      tab === k ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {top10.map((s, i) => {
                const on = allSkills.some((x) => x.name === s.name && x.onResume);
                const width = (s.count / max) * 100;
                return (
                  <div key={s.name} className="group grid grid-cols-[20px_120px_1fr] items-center gap-3 text-xs">
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate font-medium text-foreground">{s.name}</span>
                    <div className="relative h-7 overflow-hidden rounded-md bg-muted/30 ring-1 ring-inset ring-border/40">
                      <div
                        className={`h-full ${
                          on
                            ? "bg-gradient-to-r from-primary via-blue-500 to-sky-400"
                            : "bg-gradient-to-r from-muted-foreground/30 to-muted-foreground/20"
                        }`}
                        style={{ width: `${width}%` }}
                      />
                      <div className="absolute inset-y-0 right-2 flex items-center gap-2 font-mono text-[10px] font-semibold">
                        {on ? (
                          <CircleCheck size={11} className="text-emerald-300" />
                        ) : (
                          <CircleAlert size={11} className="text-rose-300" />
                        )}
                        <span className="tabular-nums text-foreground/90">{s.count.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Tile>

          {/* KPI tiles */}
          <Tile className="col-span-6 md:col-span-3">
            <Kpi
              label="JDs ANALYZED"
              value={totals.analyzed.toLocaleString()}
              delta="+1,204 wk"
              accent="text-foreground"
            />
          </Tile>
          <Tile className="col-span-6 md:col-span-3">
            <Kpi
              label="COVERAGE"
              value={`${totals.coverage}%`}
              delta={`${totals.covered} of ${totals.total}`}
              accent="text-emerald-300"
            />
          </Tile>
          <Tile className="col-span-6 md:col-span-3">
            <Kpi
              label="HIGH-DEMAND GAPS"
              value={String(totals.missing)}
              delta="In top 20"
              accent="text-rose-300"
            />
          </Tile>
          <Tile className="col-span-6 md:col-span-3">
            <Kpi label="MATCH SCORE" value="78" delta="+6 this month" accent="text-primary" />
          </Tile>

          {/* Gap radar */}
          <Tile className="col-span-12 md:col-span-5">
            <TileLabel icon={<CircleAlert size={11} />}>HIGH-LEVERAGE GAPS</TileLabel>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Top-20 keywords missing from your resume — biggest interview impact first.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {gapList.map((s) => (
                <div
                  key={s.name}
                  className="group flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 transition hover:border-rose-400/40 hover:bg-rose-500/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{s.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {s.count.toLocaleString()} · {s.pct}%
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground transition group-hover:text-rose-300" />
                </div>
              ))}
            </div>
          </Tile>

          {/* Trending insights */}
          <Tile className="col-span-12 md:col-span-7">
            <TileLabel icon={<Zap size={11} />}>SIGNAL FEED</TileLabel>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <SignalCard
                tone="emerald"
                tag="GROWING"
                title="LLM / Agents"
                delta="+312% YoY"
                blurb="Fastest-growing keyword cluster across the last 90 days."
              />
              <SignalCard
                tone="amber"
                tag="GAP"
                title="Kubernetes"
                delta="12% of postings"
                blurb="High demand, not on your resume. Strong tailoring candidate."
              />
              <SignalCard
                tone="primary"
                tag="STRENGTH"
                title="Python · SQL · React"
                delta="Top 1% match"
                blurb="Your core stack lands you in elite recall for backend roles."
              />
            </div>
          </Tile>

          {/* Category bento */}
          <div className="col-span-12 mt-2">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                  CATEGORIES · 8 CLUSTERS
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drill into any cluster to see ranked skills and recommended resume edits.
                </p>
              </div>
              <button className="text-xs font-semibold text-primary hover:underline">
                View all skills →
              </button>
            </div>

            <div className="grid grid-cols-12 gap-4">
              {filteredCats.map((cat, idx) => {
                const c = COLOR_MAP[cat.color];
                const catMax = Math.max(...cat.skills.map((s) => s.count));
                const onResume = cat.skills.filter((s) => s.onResume).length;
                const coverage = Math.round((onResume / cat.skills.length) * 100);
                // varied spans to make a real bento
                const span =
                  idx === 0
                    ? "md:col-span-6"
                    : idx === 1
                    ? "md:col-span-6"
                    : idx === 2
                    ? "md:col-span-4"
                    : idx === 3
                    ? "md:col-span-4"
                    : idx === 4
                    ? "md:col-span-4"
                    : idx === 5
                    ? "md:col-span-5"
                    : idx === 6
                    ? "md:col-span-4"
                    : "md:col-span-3";
                return (
                  <Tile key={cat.name} className={`col-span-12 ${span} group`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${c.dot} shadow-[0_0_12px] shadow-current ${c.text}`} />
                        <h3 className="font-mono text-sm font-bold tracking-tight text-foreground">
                          {cat.name}
                        </h3>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold ${c.soft} ${c.text}`}>
                        {coverage}% MATCH
                      </span>
                    </div>

                    <div className="mt-3 font-mono text-[10px] text-muted-foreground">
                      {cat.skills.length} skills · {onResume} on resume
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {cat.skills.slice(0, 6).map((s) => {
                        const w = (s.count / catMax) * 100;
                        return (
                          <div key={s.name} className="grid grid-cols-[1fr_64px_28px] items-center gap-2 text-xs">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {s.onResume ? (
                                <CircleCheck size={10} className="shrink-0 text-emerald-400" />
                              ) : (
                                <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                              )}
                              <span className={`truncate ${s.onResume ? "text-foreground" : "text-muted-foreground"}`}>
                                {s.name}
                              </span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-muted/40">
                              <div
                                className={`h-full rounded-full ${s.onResume ? c.bar : "bg-muted-foreground/30"}`}
                                style={{ width: `${w}%` }}
                              />
                            </div>
                            <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                              {s.pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <button className={`mt-4 inline-flex items-center gap-1 text-[11px] font-semibold ${c.text} hover:underline`}>
                      Drill in <ArrowUpRight size={11} />
                    </button>
                  </Tile>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- primitives ---------- */

function Tile({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-xl transition hover:border-primary/30 hover:bg-card/80 ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      {children}
    </div>
  );
}

function TileLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
      {icon ? <span className="text-primary">{icon}</span> : null}
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  accent,
}: {
  label: string;
  value: string;
  delta: string;
  accent: string;
}) {
  return (
    <div className="flex h-full flex-col justify-between">
      <TileLabel>{label}</TileLabel>
      <div className="mt-4">
        <div className={`font-mono text-3xl font-bold tabular-nums tracking-tight ${accent}`}>{value}</div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{delta}</div>
      </div>
    </div>
  );
}

function Donut({ value }: { value: number }) {
  const r = 78;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative">
      <svg width={200} height={200} className="-rotate-90">
        <defs>
          <linearGradient id="donut" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="oklch(0.66 0.19 255)" />
            <stop offset="100%" stopColor="oklch(0.78 0.16 240)" />
          </linearGradient>
        </defs>
        <circle cx={100} cy={100} r={r} stroke="oklch(0.28 0.02 260)" strokeWidth={14} fill="none" />
        <circle
          cx={100}
          cy={100}
          r={r}
          stroke="url(#donut)"
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ filter: "drop-shadow(0 0 12px oklch(0.66 0.19 255 / 0.5))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">SCORE</div>
        <div className="font-mono text-5xl font-bold tabular-nums tracking-tight text-foreground">
          {value}
          <span className="text-2xl text-muted-foreground">%</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">vs. top-20 demand</div>
      </div>
    </div>
  );
}

function DonutLegend({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-sm ${swatch}`} />
        <span className="font-mono text-[9px] font-bold tracking-[0.18em] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function SignalCard({
  tone,
  tag,
  title,
  delta,
  blurb,
}: {
  tone: "emerald" | "amber" | "primary";
  tag: string;
  title: string;
  delta: string;
  blurb: string;
}) {
  const tones = {
    emerald: { ring: "ring-emerald-400/30", text: "text-emerald-300", soft: "bg-emerald-500/10" },
    amber: { ring: "ring-amber-400/30", text: "text-amber-300", soft: "bg-amber-500/10" },
    primary: { ring: "ring-primary/40", text: "text-primary", soft: "bg-primary/10" },
  } as const;
  const t = tones[tone];
  return (
    <div className={`rounded-xl border border-border bg-background/40 p-4 ring-1 ring-inset ${t.ring}`}>
      <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.18em] ${t.soft} ${t.text}`}>
        {tag}
      </span>
      <div className="mt-2 text-sm font-bold text-foreground">{title}</div>
      <div className={`font-mono text-[11px] font-semibold ${t.text}`}>{delta}</div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{blurb}</p>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2 py-1 font-mono text-[10px] font-bold tracking-wider text-muted-foreground">
      <span className={`h-2 w-2 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function LoadoutCard({ loadout }: { loadout: Loadout }) {
  const t = TONE_MAP[loadout.tone];
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-xl ring-1 ring-inset ${t.ring} transition hover:border-primary/40`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
            {loadout.category.toUpperCase()}
          </div>
          <div className="mt-1 truncate text-base font-bold text-foreground">{loadout.name}</div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${t.chip}`}>
          <Flame size={10} /> {loadout.level.toUpperCase()}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>PROFICIENCY</span>
          <span className="text-foreground">{loadout.proficiency}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/40">
          <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${loadout.proficiency}%` }} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock size={11} className={t.icon} />
        <span>Last used <span className="text-foreground">{loadout.lastUsed}</span></span>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">PROVED IN</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {loadout.proof.map((p) => (
            <a
              key={p.label}
              href={p.href}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/80 transition hover:border-primary/40 hover:text-primary"
            >
              <FileText size={9} /> {p.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

