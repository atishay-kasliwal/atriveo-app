import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import QuestionField from "./QuestionField";
import { answerFor, defaultScope, plainQuestion, postAction, questionKind, when, type PendingQ, type Scope } from "./engine";
import { adjustCounts, loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";

// Show as many applications as fit in the window, up to five columns. Each card
// scrolls its own questions; saving a card pulls the next application into view.
// The page loads the order of every waiting application, and the questions only for
// the cards on screen and the next set.

const MIN_COLUMN = 260;
const MIN_ROW = 260;
const GAP = 10;

/** Number of cards that fit without scrolling the page. */
function useGridSize(ref: React.RefObject<HTMLElement | null>): { cols: number; rows: number } {
  const [size, setSize] = useState({ cols: 5, rows: 1 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const mobile = window.matchMedia("(max-width: 720px)").matches;
      const cols = mobile ? 1 : Math.max(1, Math.min(5, Math.floor((el.clientWidth + GAP) / (MIN_COLUMN + GAP))));
      const rows = mobile ? 1 : Math.max(1, Math.floor((el.clientHeight + GAP) / (MIN_ROW + GAP)));
      setSize((current) => current.cols === cols && current.rows === rows ? current : { cols, rows });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [ref]);
  return size;
}

/** A value you typed, or one copied from the same question on another application (`from`). */
interface Entry { v: string; from?: string }


export default function UnansweredPage({ header }: { header?: React.ReactNode }) {
  const { data, error, loading } = useUnansweredQueue(60_000);
  const { cards, gone, error: cardsError } = useUnansweredCards();
  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, rows } = useGridSize(gridRef);
  const pageSize = cols * rows;

  // Display order (ids). New applications from a refresh are appended after these.
  const [order, setOrder] = useState<string[]>([]);
  // Saved or skipped here: id → the record's updatedAt then. It returns if the engine updates it again.
  const [done, setDone] = useState<Record<string, string>>({});
  // Typed on each card: application id → fingerprint → value.
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  // Your latest answer to each plain question, offered on every other card that asks it.
  const [shared, setShared] = useState<Record<string, Required<Entry>>>({});
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
    const shown = (id: string, version: string) => !(done[id] && done[id] >= version) && !(gone[id] && gone[id] >= version);
    return ids.map((id) => byId.get(id)!).filter((a) => shown(a.id, a.updatedAt));
  }, [server, order, done, gone]);
  const visible = ordered.slice(0, pageSize);
  // The cards on screen and the next set, so "Next" and a saved card's replacement show at once.
  const upcoming = useMemo(() => ordered.slice(0, pageSize * 2), [ordered, pageSize]);
  useEffect(() => { void loadCards(upcoming); }, [upcoming]);

  /** Put the next waiting application in this card's place and send this one to the back. */
  const replace = (id: string) => {
    const ids = ordered.map((a) => a.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    ids.splice(i, 1);
    if (ids.length >= pageSize) {
      const [next] = ids.splice(pageSize - 1, 1);
      ids.splice(i, 0, next!);
    }
    setOrder([...ids, id]);
  };
  const nextSet = () => {
    const ids = ordered.map((a) => a.id);
    setOrder([...ids.slice(pageSize), ...ids.slice(0, pageSize)]);
  };

  const entry = (app: UnansweredApp, q: PendingQ): Entry | undefined => {
    const own = values[app.id]?.[q.fingerprint];
    if (own !== undefined) return { v: own };
    const s = shared[q.fingerprint];
    return s && s.from !== app.id && plainQuestion(q) ? s : undefined;
  };
  const scopeOf = (app: UnansweredApp, q: PendingQ) => scopes[app.id]?.[q.fingerprint] ?? defaultScope(q, app.company);

  /**
   * Your answer, and the same answer offered on every other application with this exact question
   * where you haven't typed one. Sensitive, unreadable and declaration questions are answered one by one.
   */
  const setValue = (app: UnansweredApp, q: PendingQ, v: string) => {
    setValues((cur) => ({ ...cur, [app.id]: { ...cur[app.id], [q.fingerprint]: v } }));
    if (plainQuestion(q)) setShared((cur) => ({ ...cur, [q.fingerprint]: { v, from: app.id } }));
  };

  const answersOf = (app: UnansweredApp) => app.questions
    .filter((q) => questionKind(q) !== "file" && !q.openEndedAssessment?.questionFamily)
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

  const reviewStory = async (app: UnansweredApp, q: PendingQ, operation: string, answer?: string) => {
    if (busy || !q.fieldKey) return;
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const review = answer === undefined ? { operation, scope: "application" } : { operation, answer };
    const result = await postAction({ action: "question_review", applicationId: app.id, expectedUpdatedAt: app.updatedAt, fieldKey: q.fieldKey, review });
    setBusy(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [app.id]: result.error ?? "Couldn't review answer" }));
      return;
    }
    setDone((d) => ({ ...d, [app.id]: app.updatedAt }));
    setNotice(result.questionReviewStatus === "complete" ? `${app.company}: answers reviewed. Continue the application to refill and validate.` : `${app.company}: review saved.`);
    await refreshUnanswered();
  };

  const continueApplication = async (app: UnansweredApp) => {
    if (busy) return;
    setBusy(app.id);
    const result = await postAction({ action: "continue_application", applicationId: app.id, expectedUpdatedAt: app.updatedAt });
    setBusy(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [app.id]: result.error ?? "Couldn't continue application" }));
      return;
    }
    setDone((d) => ({ ...d, [app.id]: app.updatedAt }));
    setNotice(`${app.company}: queued for refill and validation. Submit still needs separate approval.`);
    await refreshUnanswered();
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
  const questionsLeft = ordered.reduce((n, a) => n + a.n, 0);

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
          {remaining > visible.length && <button className="apps-btn" onClick={nextSet}>Next {pageSize} ›</button>}
          <button className="apps-refresh" onClick={() => void refreshUnanswered()} disabled={loading}>{loading ? "Refreshing…" : data ? `Updated ${when(data.generatedAt)} ↻` : ""}</button>
        </div>
      </div>

      <main className="rv-main">
        {error && !data && <p className="apps-error">Couldn't load the questions: {error}. The Mac sidecar must be running (npm run tailor:restart).</p>}
        {!data && !error && <p className="apps-muted rv-wait">Loading the unanswered questions…</p>}
        {data && remaining === 0 && (
          <div className="rv-empty">
            <strong>Nothing is waiting for an answer.</strong>
            {data.counts.ready > 0 && <span><Link to="/ready">{data.counts.ready} application{data.counts.ready === 1 ? " is" : "s are"} ready to submit →</Link></span>}
          </div>
        )}
        <div className="rv-columns" ref={gridRef} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visible.length / cols))}, minmax(0, 1fr))` }}>
          {visible.map((row) => {
            const app = cards[row.id];
            if (!app) {
              return (
                <article key={row.id} className="rv-card rv-card-wait" aria-busy={!cardsError}>
                  <p className={cardsError ? "apps-q-note warn" : "apps-muted"}>{cardsError ? `Couldn't load these questions: ${cardsError}` : "Loading questions…"}</p>
                </article>
              );
            }
            const answers = answersOf(app);
            const answerable = app.questions.filter((q) => questionKind(q) !== "file" && !q.openEndedAssessment?.questionFamily).length;
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
                  {app.questions.length === 0 && app.questionReviewStatus === "complete" && <p className="apps-q-note">All questions have been reviewed. Continue to refill and validate this application. This does not submit it.</p>}
                  {app.questions.map((q) => {
                    const e = entry(app, q);
                    const from = e?.from ? cards[e.from]?.company : null;
                    if (q.openEndedAssessment?.questionFamily) {
                      const draft = q.openEndedUserReview?.status === "draft";
                      const text = e?.v ?? q.openEndedUserReview?.draftAnswer ?? q.openEndedSuggestion?.suggestedAnswer ?? "";
                      return <div key={q.fieldKey ?? q.fingerprint} className="apps-q">
                        <strong className="apps-q-label">{q.label}{q.required ? " *" : ""}</strong>
                        <p className="apps-q-note">Story match: {q.openEndedAssessment.questionFamily.replaceAll("_", " ")} · family {Math.round(q.openEndedAssessment.familyConfidence * 100)}% · story {Math.round(q.openEndedAssessment.storyConfidence * 100)}%{q.openEndedAssessment.selectedStory ? ` · ${q.openEndedAssessment.selectedStory}` : ""}. These scores describe the match, not your chance of getting the job.</p>
                        {q.openEndedSuggestion && <p className="apps-q-note">{q.openEndedSuggestion.confidenceBand === "high" ? "Strong" : "Possible"} suggestion from an approved story. Review every claim before accepting.</p>}
                        {!q.openEndedSuggestion && <p className="apps-q-note">No approved suggestion is available. Write your answer and approve it yourself.</p>}
                        <textarea rows={5} value={text} onChange={(event) => setValue(app, q, event.target.value)} aria-label={`Answer to ${q.label}`} />
                        {draft && <p className="apps-q-note">Your edited draft is saved. Approve it explicitly before continuing.</p>}
                        <div className="rv-card-links">
                          {q.openEndedSuggestion && !draft && <button className="apps-link" disabled={busy !== null} onClick={() => void reviewStory(app, q, "accept_suggestion")}>Accept suggestion</button>}
                          {q.openEndedSuggestion && !draft && <button className="apps-link" disabled={busy !== null} onClick={() => void reviewStory(app, q, "reject_suggestion")}>Reject suggestion</button>}
                          {!draft && <button className="apps-link" disabled={busy !== null || !text.trim()} onClick={() => void reviewStory(app, q, q.openEndedSuggestion ? "edit_suggestion" : "replace_answer", text.trim())}>Save {q.openEndedSuggestion ? "edited" : "replacement"} draft</button>}
                          {draft && <button className="apps-link" disabled={busy !== null} onClick={() => void reviewStory(app, q, q.openEndedUserReview?.action === "edited" ? "approve_edited_answer" : "approve_replacement")}>Approve this answer</button>}
                        </div>
                      </div>;
                    }
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
                  {app.questions.length === 0 && app.questionReviewStatus === "complete" ? <button className="rv-primary" disabled={busy !== null} onClick={() => void continueApplication(app)}>{busy === app.id ? "Continuing…" : "Continue application"}</button> : <button className="rv-primary" disabled={!answers.length || busy !== null} onClick={() => void save(app)}
                    title="Saves your answers and refills this application (Ctrl or ⌘ + Enter)">
                    {busy === app.id ? "Saving…" : answers.length === 0 ? (answerable ? "Answer to save" : "Nothing to answer here")
                      : answers.length < answerable ? `Save ${answers.length} of ${answerable}` : "Save and refill"}
                  </button>}
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
