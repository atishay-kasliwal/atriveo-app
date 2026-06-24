import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Sparkles,
  AlertCircle,
  ClipboardPaste,
  GitCompare,
  Download,
  Check,
  Loader2,
  FileText,
  Copy,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/tailor")({
  head: () => ({ meta: [{ title: "Loadout — Atriveo" }] }),
  component: TailorPage,
});

type Step = 1 | 2 | 3;

const STEPS: { id: Step; label: string; sub: string; icon: typeof ClipboardPaste }[] = [
  { id: 1, label: "Paste JD", sub: "drop the posting", icon: ClipboardPaste },
  { id: 2, label: "Diff", sub: "review changes", icon: GitCompare },
  { id: 3, label: "Export", sub: "ship the resume", icon: Download },
];

const DIFF_LINES = [
  { type: "ctx" as const, text: "Senior Software Engineer · Atriveo" },
  { type: "del" as const, text: "- Built distributed systems for high-volume data pipelines" },
  { type: "add" as const, text: "+ Built event-driven ingestion handling 12M+ daily records on Kafka + Snowflake" },
  { type: "ctx" as const, text: "  Tech: TypeScript, Go, Postgres, Redis" },
  { type: "del" as const, text: "- Mentored junior engineers" },
  { type: "add" as const, text: "+ Led 3-engineer platform pod; shipped 4 quarter-long initiatives end-to-end" },
  { type: "add" as const, text: "+ Drove on-call rotation reform — MTTR down 38%" },
];

function TailorPage() {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);

  const canParse = jd.trim().length > 40;
  const filled = useMemo(() => {
    const have = [company.trim(), role.trim(), jd.trim()].filter(Boolean).length;
    return Math.round((have / 3) * 100);
  }, [company, role, jd]);

  const runParse = () => {
    if (!canParse) return;
    setRunning(true);
    setTimeout(() => {
      if (!company) setCompany("Heron Labs");
      if (!role) setRole("Senior Platform Engineer");
      setRunning(false);
      setStep(2);
    }, 700);
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
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                LOADOUT · TAILOR ENGINE
              </div>
              <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight">
                Three steps —{" "}
                <span className="bg-gradient-to-r from-primary to-sky-300 bg-clip-text text-transparent">
                  paste, diff, export.
                </span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Drop any job posting and the Mac tailor rewrites bullets to match. Review the diff before exporting so you ship a resume you actually trust.
              </p>
            </div>
            <div className="flex gap-8 pr-2">
              <HeroStat label="QUEUE" value="0" />
              <HeroStat label="DONE TODAY" value="0" />
              <HeroStat label="RESUME" value="Opt" accent />
            </div>
          </div>
        </section>

        {/* Step indicator */}
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-1 items-center gap-2">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const done = step > s.id;
                const active = step === s.id;
                return (
                  <div key={s.id} className="flex flex-1 items-center gap-2">
                    <button
                      onClick={() => setStep(s.id)}
                      className={`group flex flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        active
                          ? "border-primary/50 bg-primary/10"
                          : done
                          ? "border-emerald-400/30 bg-emerald-400/5"
                          : "border-border bg-background/40 hover:border-border/80"
                      }`}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-bold ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : done
                            ? "bg-emerald-400/20 text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <Check size={14} /> : <Icon size={14} />}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">
                          STEP {s.id}
                        </div>
                        <div className="truncate text-sm font-semibold">{s.label}</div>
                      </div>
                    </button>
                    {i < STEPS.length - 1 && (
                      <span
                        className={`hidden h-px flex-1 md:block ${
                          step > s.id ? "bg-emerald-400/40" : "bg-border"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden shrink-0 text-right md:block">
              <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">PROGRESS</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-primary">{filled}%</div>
            </div>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-sky-300 transition-all"
              style={{ width: `${filled}%` }}
            />
          </div>
        </section>

        {/* Daemon status */}
        <section className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertCircle size={13} className="shrink-0 text-destructive" />
          <p className="leading-snug">
            <span className="font-semibold text-destructive">Mac daemon offline</span>
            <span className="text-muted-foreground"> — ensure </span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">com.atriveo.tailor</code>
            <span className="text-muted-foreground"> is running on your laptop.</span>
          </p>
        </section>

        {/* Step body */}
        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <div className="rounded-2xl border border-border bg-card p-5">
            {step === 1 && (
              <PasteStep
                company={company}
                role={role}
                jd={jd}
                setCompany={setCompany}
                setRole={setRole}
                setJd={setJd}
                canParse={canParse}
                running={running}
                onParse={runParse}
              />
            )}
            {step === 2 && <DiffStep company={company} role={role} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
            {step === 3 && <ExportStep company={company} role={role} onBack={() => setStep(2)} />}
          </div>

          {/* Sessions rail */}
          <aside className="flex flex-col gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">TAILOR QUEUE</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">0</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button className="flex-1 rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25">
                  Process
                </button>
                <button className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                  Reset
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">SESSIONS</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">0</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">No tailor runs yet. Drop a JD to start.</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">SHORTCUTS</span>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <li className="flex justify-between"><span>Parse JD</span><kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘ ↵</kbd></li>
                <li className="flex justify-between"><span>Next step</span><kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘ →</kbd></li>
                <li className="flex justify-between"><span>Reset form</span><kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘ ⌫</kbd></li>
              </ul>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function PasteStep({
  company,
  role,
  jd,
  setCompany,
  setRole,
  setJd,
  canParse,
  running,
  onParse,
}: {
  company: string;
  role: string;
  jd: string;
  setCompany: (v: string) => void;
  setRole: (v: string) => void;
  setJd: (v: string) => void;
  canParse: boolean;
  running: boolean;
  onParse: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">Paste the job description</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Title, company, URL, full JD — anything. We'll parse what we need.
          </p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">⌘/Ctrl + Enter to parse</span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="COMPANY">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Heron — auto-detect if blank"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </Field>
        <Field label="ROLE">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Platform Engineer — auto-detect"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </Field>
      </div>

      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onParse();
        }}
        placeholder="Paste the entire job posting here — title, company, URL, requirements, responsibilities…"
        className="mt-3 min-h-[320px] flex-1 w-full resize-none rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
      />

      <div className="mt-3 flex items-center justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {jd.trim().length} chars · ~{Math.max(1, Math.round(jd.trim().split(/\s+/).filter(Boolean).length))} words
        </div>
        <button
          onClick={onParse}
          disabled={!canParse || running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {running ? "Parsing…" : "Parse & continue"}
        </button>
      </div>
    </div>
  );
}

function DiffStep({
  company,
  role,
  onNext,
  onBack,
}: {
  company: string;
  role: string;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">Review diff</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rewrites for <span className="text-foreground">{role || "this role"}</span>
            {company && <> at <span className="text-foreground">{company}</span></>}.
          </p>
        </div>
        <div className="flex gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> added</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> removed</span>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background/40">
        {DIFF_LINES.map((l, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 border-b border-border/60 px-4 py-2 font-mono text-[12px] leading-relaxed last:border-b-0 ${
              l.type === "add"
                ? "bg-emerald-500/5 text-emerald-200"
                : l.type === "del"
                ? "bg-rose-500/5 text-rose-200/80"
                : "text-muted-foreground"
            }`}
          >
            <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground/60">{i + 1}</span>
            <span className="whitespace-pre-wrap">{l.text}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          ← Back to JD
        </button>
        <div className="flex gap-2">
          <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Regenerate
          </button>
          <button
            onClick={onNext}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:brightness-110"
          >
            Looks good · Export →
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportStep({
  company,
  role,
  onBack,
}: {
  company: string;
  role: string;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300">
          <Check size={18} />
        </div>
        <div>
          <h2 className="text-sm font-bold">Resume tailored</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {role || "Role"} {company && <>· {company}</>} — ready to export.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ExportCard icon={Download} label="PDF" sub="ATS-friendly · 1 page" primary />
        <ExportCard icon={FileText} label="DOCX" sub="editable Word doc" />
        <ExportCard icon={Copy} label="Markdown" sub="copy to clipboard" />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-background/40 p-4">
        <div className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">FILENAME</div>
        <code className="mt-1 block font-mono text-sm text-foreground">
          atishay_{(company || "company").toLowerCase().replace(/\s+/g, "_")}_{(role || "role").toLowerCase().replace(/\s+/g, "_")}.pdf
        </code>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          ← Back to diff
        </button>
        <Link
          to="/feed"
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Done · Back to Signal
        </Link>
      </div>
    </div>
  );
}

function ExportCard({
  icon: Icon,
  label,
  sub,
  primary,
}: {
  icon: typeof Download;
  label: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <button
      className={`group flex items-center gap-3 rounded-xl border p-3 text-left transition ${
        primary
          ? "border-primary/40 bg-primary/10 hover:border-primary/60"
          : "border-border bg-background/40 hover:border-primary/30"
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
          primary ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[10px] font-bold tracking-[0.22em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
