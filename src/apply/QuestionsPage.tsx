import {Link} from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import QuestionField from "./QuestionField";
import { answerFor, postAction, type PendingQ } from "./engine";
import { blocking, buildGroups, isResumeField, needsYourAnswer, valueFor, type Group } from "./questionGroups";
import { loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";
import "./questions.css";

// To answer: only questions nobody has answered (no profile answer, suggestion or draft), grouped so a question
// several jobs ask is answered once. A choice saves on click, text on Enter; the answer goes to every job that
// asked (each one's own matching option), through the engine's `answer` action, which also remembers it for
// future applications. Drafted answers aren't here: you check those in Atriveo Fill's side panel.

export { needsYourAnswer };

const CHIPS = 8;
const keyOf = (app: UnansweredApp, q: PendingQ) => `${app.id}:${q.fieldKey ?? q.fingerprint}`;

export default function QuestionsPage({ header }: { header?: React.ReactNode }) {
  const { data, error } = useUnansweredQueue(60_000);
  const { cards, error: cardsError } = useUnansweredCards();
  // Opened from a Today card: that application's questions come first.
  const [first] = useState(() => new URLSearchParams(window.location.search).get("app"));
  const [optional, setOptional] = useState(false);
  const [answered, setAnswered] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [cleared, setCleared] = useState({ questions: 0, jobs: new Set<string>() });
  // Jobs you skipped from a question: all their questions leave the page.
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [skippedCount, setSkippedCount] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // Every application with a question waiting for you; their questions load in the background.
  const rows = useMemo(() => (data?.unanswered ?? []).filter((q) => (q.needsInput ?? 0) > 0), [data]);
  const rowsKey = rows.map((r) => `${r.id}@${r.updatedAt}`).join(",");
  useEffect(() => { if (rows.length) void loadCards(rows); }, [rowsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = useMemo(() => rows.flatMap((r) => { const c = cards[r.id]; return c && c.updatedAt >= r.updatedAt ? [c] : []; }), [rows, cards]);
  const loading = rows.length - loaded.length;
  const apps = useMemo(() => loaded.filter((a) => !skipped[a.id]), [loaded, skipped]);

  const groups = useMemo(() => {
    const open = apps.map((a) => ({ ...a, questions: a.questions.filter((q) => !answered[keyOf(a, q)]) }));
    const all = buildGroups(open, optional);
    return first ? [...all].sort((a, b) => Number(b.asked.some((x) => x.app.id === first)) - Number(a.asked.some((x) => x.app.id === first))) : all;
  }, [apps, answered, optional, first]);
  const shared = groups.filter((g) => g.asked.length > 1);
  const single = groups.filter((g) => g.asked.length === 1);
  const open = (a: UnansweredApp) => a.questions.filter((q) => !answered[keyOf(a, q)]);
  const left = groups.reduce((n, g) => n + g.asked.length, 0);
  const optionalCount = apps.reduce((n, a) => n + open(a).filter((q) => needsYourAnswer(q) && !q.required && !isResumeField(q)).length, 0);
  const resumeCount = apps.reduce((n, a) => n + open(a).filter((q) => needsYourAnswer(q) && isResumeField(q)).length, 0);
  const blocked = apps.filter((a) => open(a).some(blocking)).length;

  /** Move to the next row's input once a row is saved (keyboard flow). */
  const focusNext = (from: string) => requestAnimationFrame(() => {
    const rowsEl = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const at = rowsEl.findIndex((r) => r.dataset.row === from);
    const next = rowsEl.slice(Math.max(0, at)).find((r) => r.dataset.row !== from) ?? rowsEl[0];
    next?.querySelector<HTMLElement>("input, textarea, select, button.qs-chip")?.focus();
  });

  /** One answer for the whole group: each job gets its own matching option; the rest stay for a different answer. */
  const save = async (g: Group, value: string) => {
    if (busy) return;
    const byApp = new Map<string, { app: UnansweredApp; answers: ReturnType<typeof answerFor>[]; keys: string[] }>();
    let unmatched = 0;
    for (const { app, q } of g.asked) {
      const v = valueFor(q, value);
      if (v === null) { unmatched += 1; continue; }
      const e = byApp.get(app.id) ?? { app, answers: [], keys: [] };
      // Sensitive answers stay with each application; everything else is remembered for future ones too.
      e.answers.push(answerFor(q, v, q.sensitive ? "application" : "global"));
      e.keys.push(keyOf(app, q));
      byApp.set(app.id, e);
    }
    if (!byApp.size) { setResults((r) => ({ ...r, [g.key]: { ok: false, text: "None of these jobs offers that choice." } })); return; }
    setBusy(g.key);
    const jobs = [...byApp.values()];
    let saved = 0, failed = 0;
    const done: string[] = [];
    // A few at a time: each save runs the engine once for that application.
    for (let i = 0; i < jobs.length; i += 3) {
      await Promise.all(jobs.slice(i, i + 3).map(async (j) => {
        const res = await postAction({ action: "answer", applicationId: j.app.id, answers: j.answers }).catch(() => ({ ok: false }));
        if (res.ok) { saved += 1; done.push(...j.keys); } else failed += 1;
      }));
      setResults((r) => ({ ...r, [g.key]: { ok: true, text: `Saving… ${saved + failed} of ${jobs.length}` } }));
    }
    setBusy(null);
    setAnswered((a) => ({ ...a, ...Object.fromEntries(done.map((k) => [k, true as const])) }));
    setCleared((c) => ({ questions: c.questions + done.length, jobs: new Set([...c.jobs, ...jobs.map((j) => j.app.id)]) }));
    const rest = [unmatched && `${unmatched} need a different choice`, failed && `${failed} couldn't be saved`].filter(Boolean).join(" · ");
    setResults((r) => ({ ...r, [g.key]: { ok: !failed, text: `Saved for ${saved} job${saved === 1 ? "" : "s"}${rest ? ` · ${rest}` : ""}` } }));
    focusNext(g.key);
    setTimeout(() => void refreshUnanswered(), 2000);
  };

  /** Skip every job that asks this question (the engine's `skip`: the job is dropped, nothing is sent to it). */
  const skip = async (g: Group) => {
    if (busy) return;
    const jobs = [...new Map(g.asked.map(({ app }) => [app.id, app])).values()];
    setBusy(g.key);
    const done: string[] = [];
    let failed = 0;
    for (let i = 0; i < jobs.length; i += 3) {
      await Promise.all(jobs.slice(i, i + 3).map(async (app) => {
        const res = await postAction({ action: "skip", applicationId: app.id, note: `skipped on To answer: ${g.label}`.slice(0, 300) }).catch(() => ({ ok: false }));
        if (res.ok) done.push(app.id); else failed += 1;
      }));
    }
    setBusy(null);
    setSkipped((s) => ({ ...s, ...Object.fromEntries(done.map((id) => [id, true as const])) }));
    setSkippedCount((n) => n + done.length);
    if (failed) setResults((r) => ({ ...r, [g.key]: { ok: false, text: `${failed} job${failed === 1 ? "" : "s"} couldn't be skipped` } }));
    focusNext(g.key);
    setTimeout(() => void refreshUnanswered(), 2000);
  };
  const row = (g: Group) => <GroupRow key={g.key} g={g} busy={busy === g.key} disabled={busy !== null && busy !== g.key} result={results[g.key]} onSave={(v) => void save(g, v)} onSkip={() => void skip(g)} />;

  return (
    <div className="rv-page td-page qs-page">
      {header}
      <div className="td-bar">
        <div className="td-title">
          <h1>To answer</h1>
          <span className="apps-muted">
            {!data ? "Loading…" : !rows.length ? "Nothing left to answer"
              : `${left} question${left === 1 ? "" : "s"} · ${blocked} job${blocked === 1 ? "" : "s"} waiting on you${loading > 0 ? ` · loading ${loading} more…` : ""}`}
          </span>
        </div>
        {(cleared.questions > 0 || skippedCount > 0) && <span className="qs-cleared">{cleared.questions > 0 ? `✓ ${cleared.questions} answered for ${cleared.jobs.size} job${cleared.jobs.size === 1 ? "" : "s"} this session` : ""}{cleared.questions > 0 && skippedCount > 0 ? " · " : ""}{skippedCount > 0 ? `${skippedCount} job${skippedCount === 1 ? "" : "s"} skipped` : ""}</span>}
        <div className="td-actions">
          {resumeCount > 0 && <span className="apps-muted" title="Company, title, dates, education: Atriveo Fill copies them from your resume on the job page.">{resumeCount} resume fields left to Atriveo Fill</span>}
          <label className="qs-toggle"><input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> Show optional{optionalCount ? ` (${optionalCount})` : ""}</label>
        </div>
      </div>
      {(error || cardsError) && <p className="ar-error" role="alert">{error || cardsError}</p>}
      {data && !rows.length && <div className="product-empty-actions"><Link className="apps-btn" to="/">Back to Today</Link><Link className="apps-btn" to="/staffing">Find more jobs</Link></div>}
      <main className="qs-columns" ref={list}>
        <section className="qs-col" aria-label="Asked by several jobs">
          <h2>Asked by several jobs <span className="apps-muted">answer once · saved for all of them and remembered</span></h2>
          <div className="qs-list">
            {shared.map(row)}
            {!shared.length && <p className="apps-muted qs-empty">{(data && loading===0) ? "No question is shared by several jobs right now." : "Loading questions…"}</p>}
          </div>
        </section>
        <section className="qs-col" aria-label="Only for one job">
          <h2>Only for one job <span className="apps-muted">{single.length}</span></h2>
          <div className="qs-list">
            {single.map(row)}
            {!single.length && <p className="apps-muted qs-empty">{(data && loading===0) ? "Nothing job-specific left." : "Loading questions…"}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

/** One question (or one question many jobs ask): choices save on click, text on Enter. */
function GroupRow({ g, busy, disabled, result, onSave, onSkip }: { g: Group; busy: boolean; disabled: boolean; result?: { ok: boolean; text: string }; onSave: (value: string) => void; onSkip: () => void }) {
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const one = g.asked.length === 1 ? g.asked[0]! : null;
  const companies = [...new Set(g.asked.map((a) => a.app.company))];
  const long = g.key.startsWith("long:");
  const multiline = g.asked.some(({ q }) => q.type === "textarea");
  const off = busy || disabled;

  let input: React.ReactNode;
  if (long && one) {
    input = <div className="qs-field"><QuestionField hideScope q={one.q} appId={one.app.id} company={one.app.company} value={text} scope="application" onValue={setText} onScope={() => {}} /><button className="rv-primary" disabled={off || !text} onClick={() => onSave(text)}>Save</button></div>;
  } else if (g.kind === "check") {
    input = <div className="qs-chips"><button className="qs-chip" disabled={off} onClick={() => onSave("true")}>Check it ✓</button><button className="qs-chip" disabled={off} onClick={() => onSave("false")}>Leave unchecked</button></div>;
  } else if (g.kind === "choice") {
    const shown = more ? g.choices : g.choices.slice(0, CHIPS);
    input = <div className="qs-chips">
      {shown.map((c) => <button key={c} className="qs-chip" disabled={off} title={c} onClick={() => onSave(c)}>{c}</button>)}
      {g.choices.length > CHIPS && <button className="qs-chip is-more" disabled={off} onClick={() => setMore(!more)}>{more ? "Fewer" : `+${g.choices.length - CHIPS} more`}</button>}
    </div>;
  } else {
    const submit = () => { if (text.trim()) onSave(text.trim()); };
    input = <form className="qs-field" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {multiline
        ? <textarea rows={3} value={text} disabled={off} placeholder="Your answer · ⌘↵ to save" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
        : <input value={text} disabled={off} placeholder="Your answer · ↵ to save" onChange={(e) => setText(e.target.value)} />}
      <button className="rv-primary" type="submit" disabled={off || !text.trim()}>{busy ? "Saving…" : g.asked.length > 1 ? `Save for ${g.asked.length}` : "Save"}</button>
    </form>;
  }

  return (
    <article className={`qs-row ${g.required ? "" : "is-optional"}`} data-row={g.key} aria-label={g.label} aria-busy={busy}>
      <header className="qs-row-head">
        {one ? <CompanyLogo company={one.app.company} size="sm" /> : <span className="qs-count" title={companies.join(", ")}>{g.asked.length}</span>}
        <div className="qs-row-id">
          <strong title={g.label}>{g.label}{g.required ? " *" : ""}</strong>
          <span title={companies.join(", ")}>{one ? <>{one.app.company} · {one.app.title} · <a href={one.app.url} target="_blank" rel="noreferrer">Job ↗</a></> : `${companies.slice(0, 3).join(", ")}${companies.length > 3 ? ` +${companies.length - 3}` : ""}`}</span>
        </div>
        {!g.required && <em className="qs-opt">optional</em>}
        {/* Skips every job that asks this question, in one click. */}
        <button className="apps-link qs-skip" disabled={off} title={`Skip ${one ? "this job" : `all ${companies.length} jobs that ask this`}: they leave Today and To answer`} onClick={onSkip}>{one ? "Skip job" : `Skip all ${companies.length} jobs`}</button>
      </header>
      {input}
      {result && <p className={`qs-result ${result.ok ? "" : "is-bad"}`} role="status">{result.text}</p>}
    </article>
  );
}
