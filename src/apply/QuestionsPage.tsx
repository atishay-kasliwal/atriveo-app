import {Link} from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from "react";
import CardActions from "./CardActions";
import QuestionField from "./QuestionField";
import { answerFor, postAction, type PendingQ } from "./engine";
import { blocking, buildGroups, isResumeField, needsYourAnswer, valueFor, type Group } from "./questionGroups";
import { loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";
import "./questions.css";

// Questions with no existing answer are grouped across applications. Local drafts are kept in this tab;
// only an explicit save sends answers to the engine. Existing engine drafts remain in the Fill side panel.

export { needsYourAnswer };

const CHIPS = 8;
const keyOf = (app: UnansweredApp, q: PendingQ) => `${app.id}:${q.fieldKey ?? q.fingerprint}`;

export default function QuestionsPage({ header }: { header?: React.ReactNode }) {
  const { data, error } = useUnansweredQueue(60_000);
  const { cards, error: cardsError } = useUnansweredCards();
  // Opened from a Today card: that application's questions come first.
  const [first] = useState(() => new URLSearchParams(window.location.search).get("app"));
  const [workspace, setWorkspace] = useState<{active: string; drafts: Record<string, string>; later: string[]; optional: boolean}>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem("atriveo-question-workspace") ?? "null");
      if (saved && typeof saved.active === "string" && typeof saved.optional === "boolean" && saved.drafts && Array.isArray(saved.later))
        return { ...saved, drafts: Object.fromEntries(Object.entries(saved.drafts).filter(([, v]) => typeof v === "string")), later: saved.later.filter((v: unknown) => typeof v === "string") };
    } catch { /* Start fresh if browser storage is unavailable. */ }
    return {active: "", drafts: {}, later: [], optional: false};
  });
  const optional = workspace.optional;
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { try { sessionStorage.setItem("atriveo-question-workspace", JSON.stringify(workspace)); } catch { /* Draft remains in memory. */ } }, [workspace]);
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
    all.sort((a, b) => new Set(b.asked.map(x => x.app.id)).size - new Set(a.asked.map(x => x.app.id)).size);
    return first ? [...all].sort((a, b) => Number(b.asked.some((x) => x.app.id === first)) - Number(a.asked.some((x) => x.app.id === first))) : all;
  }, [apps, answered, optional, first]);
  const ordered = useMemo(() => [...groups].sort((a, b) => Number(workspace.later.includes(a.key)) - Number(workspace.later.includes(b.key))), [groups, workspace.later]);
  const current = ordered.find(g => g.key === workspace.active) ?? ordered[0];
  const jump = (key: string) => requestAnimationFrame(() => {
    const row = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].find(el => el.dataset.row === key);
    row?.scrollIntoView({block: "start", behavior: "instant"});
    row?.querySelector<HTMLElement>(".qs-question-title")?.focus({preventScroll: true});
  });
  const select = (key: string) => { setWorkspace(w => ({...w, active: key})); setQueueOpen(false); jump(key); };
  const restored = useRef(false);
  const orderedKey = ordered.map(g => g.key).join("\n");
  useEffect(() => {
    const pane = list.current?.querySelector<HTMLElement>(".qs-question-list");
    if (!pane) return;
    if (!restored.current && ordered.length) { restored.current = true; if (workspace.active) jump(workspace.active); }
    let frame = 0;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = window.matchMedia("(max-width:760px)").matches ? 80 : pane.getBoundingClientRect().top + 80;
        const visibleRows = [...pane.querySelectorAll<HTMLElement>("[data-row]")];
        const row = visibleRows.find(el => el.getBoundingClientRect().bottom > top);
        if (row?.dataset.row) { const key = row.dataset.row; setWorkspace(w => w.active === key ? w : {...w, active: key}); }
      });
    };
    pane.addEventListener("scroll", track); window.addEventListener("scroll", track, true);
    return () => {cancelAnimationFrame(frame); pane.removeEventListener("scroll", track); window.removeEventListener("scroll", track, true);};
  }, [orderedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nav = list.current?.querySelector<HTMLElement>(".qs-queue");
    const item = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !item || !nav.clientHeight) return;
    const box = item.getBoundingClientRect(), bounds = nav.getBoundingClientRect();
    if (box.top < bounds.top || box.bottom > bounds.bottom) nav.scrollTop += box.top - bounds.top;
  }, [workspace.active]);
  const defer = (g: Group) => {
    const next = ordered.find(x => x.key !== g.key && !workspace.later.includes(x.key))?.key ?? ordered.find(x => x.key !== g.key)?.key ?? g.key;
    setWorkspace(w => ({...w, later: [...w.later.filter(k => k !== g.key), g.key], active: ordered.find(x => x.key !== g.key && !w.later.includes(x.key))?.key ?? ordered.find(x => x.key !== g.key)?.key ?? g.key}));
    jump(next);
    setNotice("Left for later. Your applications are unchanged.");
  };
  const open = (a: UnansweredApp) => a.questions.filter((q) => !answered[keyOf(a, q)]);
  const optionalCount = apps.reduce((n, a) => n + open(a).filter((q) => needsYourAnswer(q) && !q.required && !isResumeField(q)).length, 0);
  const resumeCount = apps.reduce((n, a) => n + open(a).filter((q) => needsYourAnswer(q) && isResumeField(q)).length, 0);
  const blocked = apps.filter((a) => open(a).some(blocking)).length;

  const focusNext = (from: string) => {
    const at = ordered.findIndex(g => g.key === from);
    const next = ordered.slice(at + 1).find(g => g.key !== from) ?? ordered.find(g => g.key !== from);
    setWorkspace(w => ({...w, active: next?.key ?? ""}));
    if (next) jump(next.key);
  };

  /** One answer for the whole group: each job gets its own matching option; the rest stay for a different answer. */
  const save = async (g: Group, value: string) => {
    if (busy) return;
    const byApp = new Map<string, { app: UnansweredApp; answers: ReturnType<typeof answerFor>[]; keys: string[] }>();
    let unmatched = 0;
    for (const { app, q } of g.asked) {
      // Long-list QuestionField only emits an exact option from its fetched list.
      const v = g.key.startsWith("long:") && g.asked.length === 1 ? value.trim() : valueFor(q, value);
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
    setCleared((c) => ({ questions: c.questions + done.length, jobs: new Set([...c.jobs, ...jobs.filter(j => j.keys.some(k => done.includes(k))).map((j) => j.app.id)]) }));
    const rest = [unmatched && `${unmatched} need a different choice`, failed && `${failed} couldn't be saved`].filter(Boolean).join(" · ");
    setResults((r) => ({ ...r, [g.key]: { ok: !failed, text: `Saved for ${saved} job${saved === 1 ? "" : "s"}${rest ? ` · ${rest}` : ""}` } }));
    setNotice(`Saved for ${saved} job${saved === 1 ? "" : "s"}${rest ? ` · ${rest}` : ""}`);
    if (!failed && !unmatched) {
      setWorkspace(w => { const drafts = {...w.drafts}; delete drafts[g.key]; return {...w, drafts}; });
      focusNext(g.key);
    }
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
    setNotice(`${done.length} applications discarded${failed ? ` · ${failed} could not be discarded` : ""}.`);
    if (!failed) focusNext(g.key);
    setTimeout(() => void refreshUnanswered(), 2000);
  };
  return (
    <div className="rv-page td-page qs-page">
      {header}
      <div className="td-bar">
        <div className="td-title"><h1>To answer</h1><span className="apps-muted">
          {!data ? "Loading…" : !rows.length ? "Nothing left to answer" : `${groups.length} questions · ${blocked} jobs waiting on you${loading > 0 ? " · loading more…" : ""}`}
        </span></div>
        <div className="td-actions">
          {cleared.questions > 0 && <span className="qs-cleared">✓ {cleared.questions} answered</span>}
          {skippedCount > 0 && <span className="apps-muted">{skippedCount} jobs discarded</span>}
          <label className="qs-toggle"><input type="checkbox" checked={optional} onChange={e => setWorkspace(w => ({...w, optional: e.target.checked}))} /> Optional{optionalCount ? ` (${optionalCount})` : ""}</label>
        </div>
      </div>
      {(error || cardsError) && <p className="ar-error" role="alert">Couldn’t load some questions. <button className="apps-link" onClick={() => {void refreshUnanswered(); void loadCards(rows);}}>Retry</button></p>}
      <p className="qs-notice" role="status" aria-live="polite">{notice}</p>
      <main className="qs-workspace" ref={list}>
        {ordered.length > 0 && <>
          <button className="apps-btn qs-queue-toggle" aria-expanded={queueOpen} onClick={() => setQueueOpen(v => !v)}>Questions ({groups.length}) {queueOpen ? "−" : "+"}</button>
          <nav className={`qs-queue ${queueOpen ? "is-open" : ""}`} aria-label="Question queue">
            <div className="qs-queue-label">Most jobs first</div>
            {ordered.map((g, index) => { const jobs = new Set(g.asked.map(x => x.app.id)).size; return <button key={g.key} className={`qs-queue-item ${current?.key === g.key ? "is-active" : ""}`} aria-current={current?.key === g.key ? "step" : undefined} disabled={!!busy} onClick={() => select(g.key)}>
              <span><b className="qs-number">Q{index + 1}</b> {g.label}</span><small>{jobs} job{jobs === 1 ? "" : "s"}{workspace.later.includes(g.key) ? " · Later" : ""}{workspace.drafts[g.key] ? " · Draft" : ""}</small>
            </button>; })}
          </nav>
          <div className="qs-question-list" aria-label="All questions">
            {ordered.map((g, index) => <GroupRow key={g.key} number={index + 1} g={g} text={workspace.drafts[g.key] ?? ""} onText={text => setWorkspace(w => ({...w, drafts: {...w.drafts, [g.key]: text}}))} busy={busy === g.key} disabled={!!busy && busy !== g.key} result={results[g.key]} onSave={v => void save(g, v)} onSkip={() => void skip(g)} onLater={() => defer(g)} />)}
          </div>
        </>}
        {!ordered.length && <section className="qs-finished">
          <span className="qs-finished-icon" aria-hidden="true">{!data || loading ? "…" : "✓"}</span>
          <h2>{!data || loading ? "Gathering your questions…" : "You're caught up"}</h2>
          <p className="apps-muted">{!data || loading ? "Your questions will appear here as they load." : optionalCount ? "Required answers are done. You can show optional questions above." : "No questions need your answer right now."}</p>
          {data && loading === 0 && <div className="product-empty-actions"><Link className="apps-btn" to="/">Back to Today</Link><Link className="apps-btn" to="/staffing">Find more jobs</Link></div>}
        </section>}
      </main>
      {resumeCount > 0 && <details className="qs-resume-note"><summary>{resumeCount} resume fields handled by Atriveo Fill</summary><p>Work history and education are copied from your resume on the job page.</p></details>}
    </div>
  );
}

/** An explicit save applies the selected answer to the matching applications. */
function GroupRow({ number, g, text, onText, busy, disabled, result, onSave, onSkip, onLater }: { number: number; g: Group; text: string; onText: (value: string) => void; busy: boolean; disabled: boolean; result?: { ok: boolean; text: string }; onSave: (value: string) => void; onSkip: () => void; onLater: () => void }) {
  const [more, setMore] = useState(false);
  const jobs = [...new Map(g.asked.map(({app}) => [app.id, app])).values()];
  const one = g.asked.length === 1 ? g.asked[0]! : null;
  const off = busy || disabled;
  const multiline = g.asked.some(({q}) => q.type === "textarea");
  const submit = () => { if (text.trim() && !off) onSave(text.trim()); };
  let input: React.ReactNode;
  if (g.key.startsWith("long:") && one) {
    input = <fieldset disabled={off} className="qs-field"><QuestionField hideScope q={one.q} appId={one.app.id} company={one.app.company} value={text} scope="application" onValue={onText} onScope={() => {}} /></fieldset>;
  } else if (g.kind === "check" || g.kind === "choice") {
    const choices = g.kind === "check" ? [{value: "true", label: "Check it ✓"}, {value: "false", label: "Leave unchecked"}] : (more ? g.choices : g.choices.slice(0, CHIPS)).map(c => ({value: c, label: c}));
    input = <div className="qs-chips" role="group" aria-label="Your answer">{choices.map(c => <button type="button" key={c.value} className="qs-chip" aria-pressed={text === c.value} disabled={off} onClick={() => onText(c.value)}>{c.label}</button>)}
      {g.kind === "choice" && g.choices.length > CHIPS && <button type="button" className="qs-chip is-more" disabled={off} onClick={() => setMore(!more)}>{more ? "Fewer choices" : `+${g.choices.length - CHIPS} more`}</button>}
    </div>;
  } else {
    input = <div className="qs-field">{multiline ? <textarea aria-label="Your answer" rows={5} value={text} disabled={off} placeholder="Write your answer…" onChange={e => onText(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {e.preventDefault(); submit();}}} /> : <input aria-label="Your answer" value={text} disabled={off} placeholder="Your answer" onChange={e => onText(e.target.value)} />}</div>;
  }
  return <article className="qs-row" data-row={g.key} aria-label={g.label} aria-busy={busy}>
    <div className="qs-question-top"><span className="apps-muted"><b className="qs-number">Q{number}</b> · {g.required ? "Required answer" : "Optional answer"}</span><CardActions><button disabled={off} onClick={onSkip}>Discard {jobs.length === 1 ? "this application" : `all ${jobs.length} applications`}</button><small>Removes these jobs from Today and To answer.</small></CardActions></div>
    <h2 className="qs-question-title" tabIndex={-1}>{g.label}</h2>
    <p className="qs-context">Used by {jobs.length} application{jobs.length === 1 ? "" : "s"}{g.asked.some(x => x.q.sensitive) ? " · Sensitive answers stay with each application" : " · Remembered for future applications"}</p>
    <form onSubmit={e => {e.preventDefault(); submit();}}>
      {input}
      <details className="qs-companies"><summary>View companies ({jobs.length})</summary><ul>{jobs.map(app => <li key={app.id}><strong>{app.company}</strong><span>{app.title}</span><a href={app.url} target="_blank" rel="noreferrer">View job ↗</a></li>)}</ul></details>
      {result && <p className={`qs-result ${result.ok ? "" : "is-bad"}`} role="status">{result.text}</p>}
      <div className="qs-footer"><button className="rv-primary" type="submit" disabled={off || !text.trim()}>{busy ? "Saving…" : "Save answer & next"}</button><button className="apps-link" type="button" disabled={off} onClick={onLater}>Answer later</button></div>
    </form>
  </article>;
}
