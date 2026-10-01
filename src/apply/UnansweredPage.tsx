import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import QuestionField from "./QuestionField";
import { answerFor, defaultScope, plainQuestion, postAction, questionKind, when, type PendingQ, type Scope } from "./engine";
import { adjustCounts, refreshReviewQueue, useReviewQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";

// Every application blocked on questions, on one screen: one column per application, as many
// columns as fit (up to 5), no page scrolling. Saving a column refills that application and
// puts the next one in its place.

const MIN_COLUMN = 260;
const GAP = 10;

/** How many columns fit the grid's width (1 to 5). */
function useColumns(ref: React.RefObject<HTMLElement | null>): number {
  const [cols, setCols] = useState(5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setCols(Math.max(1, Math.min(5, Math.floor((el.clientWidth + GAP) / (MIN_COLUMN + GAP)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/** A value you typed, or one copied from the same question on another application (`from`). */
interface Entry { v: string; from?: string }


export default function UnansweredPage({ header }: { header?: React.ReactNode }) {
  const { data, error, loading } = useReviewQueue(60_000);
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useColumns(gridRef);

  // Display order (ids). New applications from a refresh are appended after these.
  const [order, setOrder] = useState<string[]>([]);
  // Saved or skipped here: id → the record's updatedAt then. It returns if the engine updates it again.
  const [done, setDone] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, Record<string, Entry>>>({});
  const [scopes, setScopes] = useState<Record<string, Record<string, Scope>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSkip, setConfirmSkip] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const server = useMemo(() => data?.unanswered ?? [], [data]);
  const ordered = useMemo(() => {
    const byId = new Map(server.map((a) => [a.id, a]));
    const known = new Set(order);
    const ids = [...order.filter((id) => byId.has(id)), ...server.filter((a) => !known.has(a.id)).map((a) => a.id)];
    return ids.map((id) => byId.get(id)!).filter((a) => !(done[a.id] && done[a.id] >= a.updatedAt));
  }, [server, order, done]);
  const visible = ordered.slice(0, cols);

  /** Put the next waiting application in this one's column and send this one to the back. */
  const replace = (id: string) => {
    const ids = ordered.map((a) => a.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    ids.splice(i, 1);
    if (ids.length >= cols) {
      const [next] = ids.splice(cols - 1, 1);
      ids.splice(i, 0, next!);
    }
    setOrder([...ids, id]);
  };
  const nextSet = () => {
    const ids = ordered.map((a) => a.id);
    setOrder([...ids.slice(cols), ...ids.slice(0, cols)]);
  };

  const entry = (app: UnansweredApp, q: PendingQ) => values[app.id]?.[q.fingerprint];
  const scopeOf = (app: UnansweredApp, q: PendingQ) => scopes[app.id]?.[q.fingerprint] ?? defaultScope(q, app.company);

  /** Your answer, and the same answer offered on every other application with this exact question. */
  const setValue = (app: UnansweredApp, q: PendingQ, v: string) => {
    setValues((cur) => {
      const next: Record<string, Record<string, Entry>> = { ...cur, [app.id]: { ...cur[app.id], [q.fingerprint]: { v } } };
      if (!plainQuestion(q)) return next; // sensitive, unreadable and declarations are answered one by one
      for (const other of server) {
        if (other.id === app.id || !other.questions.some((oq) => oq.fingerprint === q.fingerprint)) continue;
        const existing = next[other.id]?.[q.fingerprint];
        if (existing && existing.from !== app.id && existing.v) continue; // keep what you typed there
        next[other.id] = { ...next[other.id], [q.fingerprint]: v ? { v, from: app.id } : { v: "" } };
      }
      return next;
    });
  };

  const answersOf = (app: UnansweredApp) => app.questions
    .filter((q) => questionKind(q) !== "file")
    .map((q) => ({ q, v: entry(app, q)?.v.trim() ?? "" }))
    .filter((x) => x.v);

  const save = async (app: UnansweredApp) => {
    const answers = answersOf(app);
    if (!answers.length || busy) return;
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const r = await postAction({ action: "answer", applicationId: app.id, answers: answers.map(({ q, v }) => answerFor(q, v, scopeOf(app, q))) });
    setBusy(null);
    if (!r.ok) {
      setErrors((e) => ({ ...e, [app.id]: r.error ?? "Couldn't save" }));
      return;
    }
    const left = app.questions.length - answers.length;
    replace(app.id);
    setDone((d) => ({ ...d, [app.id]: app.updatedAt }));
    setSaved((n) => n + 1);
    adjustCounts({ unanswered: -1, questions: -answers.length });
    setNotice(!r.requeued
      ? `Saved ${answers.length} answer${answers.length === 1 ? "" : "s"} for ${app.company}. It wasn't refilled: check it on the overview.`
      : left > 0
        ? `Saved ${answers.length} for ${app.company}. It's being refilled and will come back for the other ${left}.`
        : `Saved ${app.company}. It's being refilled; if every check passes it moves to Ready to submit.`);
  };

  const skip = async (app: UnansweredApp) => {
    setBusy(app.id);
    const r = await postAction({ action: "skip", applicationId: app.id, note: "skipped on the Unanswered page" });
    setBusy(null);
    setConfirmSkip(null);
    if (!r.ok) {
      setErrors((e) => ({ ...e, [app.id]: r.error ?? "Couldn't skip" }));
      return;
    }
    replace(app.id);
    setDone((d) => ({ ...d, [app.id]: app.updatedAt }));
    adjustCounts({ unanswered: -1, questions: -app.questions.length });
    setNotice(`Skipped ${app.company}.`);
  };

  const remaining = ordered.length;
  const questionsLeft = ordered.reduce((n, a) => n + a.questions.length, 0);

  return (
    <div className="rv-page">
      {header}
      <div className="rv-bar">
        <div className="rv-bar-title">
          <h1>Unanswered questions</h1>
          {data && <span className="apps-muted">{remaining} application{remaining === 1 ? "" : "s"} · {questionsLeft} question{questionsLeft === 1 ? "" : "s"}{saved ? ` · ${saved} saved here` : ""}</span>}
        </div>
        <div className="rv-bar-actions">
          {data?.worker && !data.worker.online && <span className="apps-state bad" title={`Last seen ${when(data.worker.updatedAt)}`}><i aria-hidden />Worker offline: saved answers wait</span>}
          {remaining > visible.length && <span className="apps-muted">Showing {visible.length} of {remaining}</span>}
          {remaining > visible.length && <button className="apps-btn" onClick={nextSet}>Next {cols} ›</button>}
          <button className="apps-refresh" onClick={() => void refreshReviewQueue()} disabled={loading}>{loading ? "Refreshing…" : data ? `Updated ${when(data.generatedAt)} ↻` : ""}</button>
        </div>
      </div>

      <main className="rv-main">
        {error && !data && <p className="apps-error">Couldn't load the questions: {error}. The Mac sidecar must be running (npm run tailor:restart).</p>}
        {!data && !error && <p className="apps-muted rv-wait">Loading every unanswered question… this takes a few seconds.</p>}
        {data && remaining === 0 && (
          <div className="rv-empty">
            <strong>Nothing is waiting for an answer.</strong>
            {data.counts.ready > 0 && <span><Link to="/ready">{data.counts.ready} application{data.counts.ready === 1 ? " is" : "s are"} ready to submit →</Link></span>}
          </div>
        )}
        <div className="rv-columns" ref={gridRef} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {visible.map((app) => {
            const answers = answersOf(app);
            const files = app.questions.filter((q) => questionKind(q) === "file").length;
            const answerable = app.questions.length - files;
            return (
              <article key={app.id} data-id={app.id} className="rv-card" aria-label={`${app.company}: ${app.questions.length} question${app.questions.length === 1 ? "" : "s"}`}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(app); } }}>
                <header className="rv-card-head">
                  <CompanyLogo company={app.company} size="sm" />
                  <div className="rv-card-id">
                    <strong title={app.company}>{app.company}</strong>
                    <span title={app.title}>{app.title}</span>
                    <small>{app.questions.length} question{app.questions.length === 1 ? "" : "s"}{app.ats ? ` · ${app.ats}` : ""}{app.priority ? ` · match ${app.priority}` : ""}</small>
                  </div>
                </header>
                <div className="rv-card-body">
                  {app.questions.map((q) => {
                    const e = entry(app, q);
                    const from = e?.from ? server.find((a) => a.id === e.from)?.company : null;
                    return (
                      <QuestionField key={q.fingerprint} q={q} appId={app.id} company={app.company}
                        value={e?.v ?? ""} onValue={(v) => setValue(app, q, v)}
                        scope={scopeOf(app, q)} onScope={(sc) => setScopes((cur) => ({ ...cur, [app.id]: { ...cur[app.id], [q.fingerprint]: sc } }))}
                        note={from && e?.v ? `Filled from your ${from} answer. Check it before saving.` : null} />
                    );
                  })}
                </div>
                <footer className="rv-card-foot">
                  {errors[app.id] && <p className="apps-q-note warn" role="alert">{errors[app.id]}</p>}
                  <button className="rv-primary" disabled={!answers.length || busy !== null} onClick={() => void save(app)}
                    title="Saves your answers and refills this application (Ctrl or ⌘ + Enter)">
                    {busy === app.id ? "Saving…" : answers.length === 0 ? (answerable ? "Answer to save" : "Nothing to answer here")
                      : answers.length < answerable ? `Save ${answers.length} of ${answerable}` : "Save and refill"}
                  </button>
                  <div className="rv-card-links">
                    <button className="apps-link" onClick={() => replace(app.id)} disabled={busy !== null}>Later</button>
                    <a href={app.url} target="_blank" rel="noreferrer">Open form ↗</a>
                    {confirmSkip === app.id
                      ? <span className="rv-confirm">Skip this job? <button className="apps-link danger" onClick={() => void skip(app)} disabled={busy !== null}>Skip</button> <button className="apps-link" onClick={() => setConfirmSkip(null)}>Keep</button></span>
                      : <button className="apps-link" onClick={() => setConfirmSkip(app.id)} disabled={busy !== null}>Skip job</button>}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      </main>
      {notice && <p className="apps-toast" role="status">{notice}</p>}
    </div>
  );
}
