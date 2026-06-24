import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { Search, Filter, EyeOff, Share2, ArrowDown, ArrowUp, Bookmark, X } from "lucide-react";

type Job = {
  id: string;
  score: number;
  delta: number;
  role: string;
  company: string;
  logo: string;
  logoBg: string;
  location: string;
  level: string;
  posted: string;
  rating: number;
  fit: "GOOD" | "GREAT";
  sync?: boolean;
};

const COMPANIES: { name: string; logo: string; logoBg: string; domain: string; jobs: Job[] }[] = [
  {
    name: "GARMIN",
    logo: "▲",
    logoBg: "bg-foreground text-background",
    domain: "garmin.com",
    jobs: [
      { id: "18-01", score: 65, delta: 16, role: "Embedded Software Engineer 1", company: "GARMIN", logo: "▲", logoBg: "bg-foreground text-background", location: "Cary, NC", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD" },
    ],
  },
  {
    name: "RUSHDOWN STUDIOS",
    logo: "R",
    logoBg: "bg-emerald-500/90 text-white",
    domain: "rushdownstudios.com",
    jobs: [
      { id: "18-02", score: 62, delta: 13, role: "Backend Engineer (Golang)", company: "RUSHDOWN STUDIOS", logo: "R", logoBg: "bg-emerald-500/90 text-white", location: "Saratoga …", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD" },
    ],
  },
  {
    name: "MOTION RECRUITMENT",
    logo: "M",
    logoBg: "bg-foreground text-background",
    domain: "motionrecruitment.com",
    jobs: [
      { id: "18-03", score: 55, delta: 31, role: "Software Engineer 3", company: "MOTION RECRUITMENT", logo: "M", logoBg: "bg-foreground text-background", location: "Charlotte, …", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD" },
    ],
  },
  {
    name: "CGI",
    logo: "CGI",
    logoBg: "bg-red-600 text-white",
    domain: "cgi.com",
    jobs: [
      { id: "18-04", score: 54, delta: 47, role: "Backend Developer (Golang / Java | Microse…", company: "CGI", logo: "CGI", logoBg: "bg-red-600 text-white", location: "Merrimac…", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD" },
    ],
  },
  {
    name: "OPTOMI",
    logo: "O",
    logoBg: "bg-muted text-foreground",
    domain: "optomi.com",
    jobs: [
      { id: "18-05", score: 51, delta: 48, role: "Jr. Python Developer", company: "OPTOMI", logo: "O", logoBg: "bg-muted text-foreground", location: "Charlotte, …", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD" },
    ],
  },
  {
    name: "EQUIFAX",
    logo: "E",
    logoBg: "bg-red-700 text-white",
    domain: "equifax.com",
    jobs: [
      { id: "18-06", score: 50, delta: 46, role: "Software Engineer (Java Backend)", company: "EQUIFAX", logo: "E", logoBg: "bg-red-700 text-white", location: "Alpharetta…", level: "Entry", posted: "38m ago", rating: 3, fit: "GOOD", sync: true },
    ],
  },
];

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [{ title: "Feed — Atriveo" }],
  }),
  component: FeedPage,
});

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-5 py-4">
      <div className="font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="font-mono text-xs tracking-wider text-amber-400">
      {"★".repeat(n)}<span className="text-muted-foreground/40">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function ScoreChip({ score, delta }: { score: number; delta: number }) {
  const tier =
    score >= 75
      ? { ring: "ring-emerald-500/40", text: "text-emerald-300", bar: "bg-emerald-500" }
      : score >= 55
      ? { ring: "ring-amber-500/40", text: "text-amber-300", bar: "bg-amber-400" }
      : { ring: "ring-rose-500/30", text: "text-rose-300", bar: "bg-rose-500" };
  const down = delta < 0;
  return (
    <div className="flex flex-col gap-1">
      <div className={`inline-flex items-center gap-1 self-start rounded-md bg-background px-1.5 py-0.5 ring-1 ${tier.ring}`}>
        <span className={`font-mono text-sm font-bold tabular-nums ${tier.text}`}>{score}</span>
        <span className={`flex items-center font-mono text-[10px] font-semibold ${down ? "text-rose-400" : "text-emerald-400"}`}>
          {down ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />}
          {Math.abs(delta)}
        </span>
      </div>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-background">
        <div className={`h-full ${tier.bar}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

function SideItem({ label, count, active, onClick }: { label: string; count?: number; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="font-medium">{label}</span>
      {count !== undefined && (
        <span className={`font-mono text-xs tabular-nums ${active ? "text-primary" : "text-muted-foreground/70"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

type SortKey = "score" | "posted" | "company";

function FeedPage() {
  const allJobs = useMemo(() => COMPANIES.flatMap((c) => c.jobs), []);
  const [view, setView] = useState<"all" | "high" | "newgrad">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("score");

  const filtered = useMemo(() => {
    let rows = allJobs;
    if (view === "high") rows = rows.filter((j) => j.score >= 60);
    if (view === "newgrad") rows = rows.filter((j) => j.level === "Entry");
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (j) => j.role.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.location.toLowerCase().includes(q),
      );
    }
    rows = [...rows].sort((a, b) =>
      sort === "score" ? b.score - a.score : sort === "company" ? a.company.localeCompare(b.company) : 0,
    );
    return rows;
  }, [allJobs, view, query, sort]);

  const allChecked = filtered.length > 0 && filtered.every((j) => selected.has(j.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((j) => j.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border bg-card/20 px-3 py-5">
          <div className="mb-5 flex items-center gap-2 px-1">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">A</div>
            <div className="font-mono text-xs font-semibold tracking-[0.18em] text-foreground">OPS CONSOLE</div>
          </div>

          <div className="px-1 font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">FILTERS</div>
          <div className="mt-2 space-y-0.5">
            <SideItem label="All Jobs" count={allJobs.length} active={view === "all"} onClick={() => setView("all")} />
            <SideItem label="High Match" count={allJobs.filter((j) => j.score >= 60).length} active={view === "high"} onClick={() => setView("high")} />
            <SideItem label="New Grad" count={allJobs.filter((j) => j.level === "Entry").length} active={view === "newgrad"} onClick={() => setView("newgrad")} />
            <SideItem label="H1B Ready" count={23} />
            <SideItem label="Top 500" count={14} />
          </div>

          <div className="mt-6 px-1 font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">PIPELINE</div>
          <div className="mt-2 space-y-0.5">
            <SideItem label="This Hour" count={93} />
            <SideItem label="Today" count={93} />
            <SideItem label="Yesterday" count={0} />
            <SideItem label="7 Days" />
            <SideItem label="Clicked" count={0} />
          </div>

          <div className="mt-6 px-1 font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">SESSIONS</div>
          <div className="mt-3 rounded-md border border-border bg-card/60 p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-primary/20 font-mono text-[10px] text-primary">1</span>
              <span className="font-semibold text-foreground">6:06:43 PM</span>
              <span className="ml-auto font-mono text-muted-foreground">93</span>
            </div>
            <div className="mt-1 pl-7 text-[11px] text-muted-foreground">no clicks yet</div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {/* Stats row */}
          <div className="grid grid-cols-2 divide-x divide-border border-b border-border md:grid-cols-6">
            <Stat label="ACTIVE MATCHES" value={String(filtered.length)} sub="in current view" />
            <Stat label="AVG. MATCH SCORE" value="26" sub="CareerOps average" accent />
            <Stat label="STRONG FITS" value={String(allJobs.filter((j) => j.score >= 75).length)} sub={`of ${allJobs.length}`} />
            <Stat label="APPLIED TODAY" value="0" sub="tracker activity" />
            <Stat label="TODAY" value="93 / 0" sub="postings · resumes made" />
            <Stat label="THIS HOUR · 6 PM ET" value="93 / 0" sub="postings · resumes made" />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">VIEW</span>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <EyeOff className="h-3 w-3" /> Hide fields
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <Filter className="h-3 w-3" /> Filter
              </button>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                Grouped by Company <button className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
              </span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground transition hover:border-primary/40 focus:border-ring focus:outline-none"
                >
                  <option value="score">Score</option>
                  <option value="posted">Posted</option>
                  <option value="company">Company</option>
                </select>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search jobs, companies, locations…"
                  className="w-72 rounded-md border border-border bg-input py-1.5 pl-8 pr-12 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground">⌘K</span>
              </div>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90">
                <Share2 className="h-3 w-3" /> Share
              </button>
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center gap-5 border-b border-border bg-primary/10 px-5 py-2 text-xs">
            <span className="font-mono font-semibold text-primary">Compiled</span>
            <span className="text-emerald-400">✓ Buckets fresh (40m)</span>
            <span className="text-amber-400">Sidecar offline</span>
            <span className="text-amber-400">Browser queue</span>
            <span className="text-emerald-400">✓ Today 0</span>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-2.5">
            <span className="text-xs text-muted-foreground">
              {selected.size > 0 ? (
                <span className="font-semibold text-foreground">{selected.size} selected</span>
              ) : (
                "Select jobs to compile full JDs"
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button onClick={toggleAll} className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition hover:bg-accent">
                {allChecked ? "Clear" : "Select all"}
              </button>
              <button disabled={selected.size === 0} className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground transition enabled:hover:text-foreground disabled:opacity-40">
                Analyze JDs
              </button>
              <button disabled={selected.size === 0} className="rounded-md bg-primary/20 px-2.5 py-1 font-semibold text-primary transition enabled:hover:bg-primary/30 disabled:opacity-40">
                Compile selected
              </button>
              <button disabled={selected.size === 0} className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground transition enabled:hover:text-foreground disabled:opacity-40">
                Copy selected
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-card/30 font-mono text-[10px] font-medium tracking-[0.18em] text-muted-foreground">
                  <th className="w-10 px-3 py-2.5 text-left">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
                  </th>
                  <th className="w-12 px-2 py-2.5 text-left">#</th>
                  <th className="w-24 px-2 py-2.5 text-left">SCORE</th>
                  <th className="px-2 py-2.5 text-left">ROLE & COMPANY</th>
                  <th className="w-32 px-2 py-2.5 text-left">RATING</th>
                  <th className="w-36 px-2 py-2.5 text-left">LOCATION</th>
                  <th className="w-20 px-2 py-2.5 text-left">LEVEL</th>
                  <th className="w-24 px-2 py-2.5 text-left">POSTED</th>
                  <th className="px-2 py-2.5 text-left">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-16 text-center text-sm text-muted-foreground">
                      <div className="mx-auto max-w-sm">
                        <div className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">NO MATCHES</div>
                        <div className="mt-1 text-foreground">Nothing in this view yet</div>
                        <div className="mt-1 text-xs">Try clearing your search or switching filters.</div>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((j) => {
                  const isSel = selected.has(j.id);
                  return (
                    <tr
                      key={j.id}
                      onClick={() => toggleOne(j.id)}
                      className={`group cursor-pointer border-b border-border transition ${
                        isSel ? "bg-primary/[0.06]" : "hover:bg-accent/30"
                      }`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(j.id)}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{j.id}</td>
                      <td className="px-2 py-2">
                        <ScoreChip score={j.score} delta={-j.delta} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`grid h-7 w-7 shrink-0 place-items-center rounded text-[10px] font-bold ${j.logoBg}`}>{j.logo}</div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">{j.role}</div>
                            <div className="truncate font-mono text-[10px] tracking-wider text-muted-foreground">{j.company}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <Stars n={j.rating} />
                          <span className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">{j.fit}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{j.location}</td>
                      <td className="px-2 py-2 text-xs text-foreground">{j.level}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{j.posted}</td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 opacity-70 transition group-hover:opacity-100">
                          <button className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110">Apply</button>
                          <button title="Save" className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                            <Bookmark className="h-3.5 w-3.5" />
                          </button>
                          <button title="Hide" className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-400">
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                          <Link to="/tailor" className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/10">
                            Loadout
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

