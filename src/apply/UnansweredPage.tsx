import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const [draftModes, setDraftModes] = useState<Record<string, Record<string, "edited" | "replaced">>>({});
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

  const server = useMemo(() => [...(data?.unanswered ?? []), ...(data?.reviewComplete ?? [])], [data]);
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
    if (!q.questionFamily && plainQuestion(q)) setShared((cur) => ({ ...cur, [q.fingerprint]: { v, from: app.id } }));
  };

  const answersOf = (app: UnansweredApp) => app.questions
    .filter((q) => questionKind(q) !== "file" && !q.questionFamily)
    .map((q) => ({ q, v: entry(app, q)?.v.trim() ?? "" }))
    .filter((x) => x.v);

  const reviewQuestion = async (app: UnansweredApp, q: PendingQ, operation: string, answer?: string) => {
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const review: Record<string, unknown> = { operation };
    if (answer !== undefined) review.answer = answer;
    if (["accept_suggestion", "approve_edited_answer", "approve_replacement"].includes(operation)) review.scope = scopeOf(app, q);
    const result = await postAction({
      action: "question_review",
      applicationId: app.id,
      expectedUpdatedAt: app.updatedAt,
      fieldKey: q.fieldKey,
      review,
    });
    setBusy(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [app.id]: result.error ?? "Couldn't save this question review" }));
      return;
    }
    setDraftModes((current) => {
      const byQuestion = { ...current[app.id] };
      delete byQuestion[q.fingerprint];
      return { ...current, [app.id]: byQuestion };
    });
    setSaved((n) => n + 1);
    setNotice(operation === "reject_suggestion" ? "Suggestion rejected. The question is still waiting for an answer."
      : operation === "edit_suggestion" || operation === "replace_answer" ? "Draft saved. Approve it explicitly to resolve the question."
      : "Answer approved for this question. The application has not been submitted.");
    await refreshUnanswered();
  };

  const continueApplication = async (app: UnansweredApp) => {
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const result = await postAction({ action: "continue_application", applicationId: app.id, expectedUpdatedAt: app.updatedAt });
    setBusy(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [app.id]: result.error ?? "Couldn't continue this application" }));
      return;
    }
    setDone((current) => ({ ...current, [app.id]: app.updatedAt }));
    setOrder((current) => [...current.filter((id) => id !== app.id), app.id]);
    adjustCounts({ reviewComplete: -1 });
    setNotice(`Continuing ${app.company} for a review-only refill and validation. It will not be submitted.`);
    await refreshUnanswered();
  };

  const refreshSuggestions = async (app: UnansweredApp) => {
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const result = await postAction({ action: "refresh_suggestions", applicationId: app.id, expectedUpdatedAt: app.updatedAt });
    setBusy(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [app.id]: result.error ?? "Couldn't refresh suggestions" }));
      return;
    }
    setNotice(
      result.suggestions
        ? `Refreshed suggestions for ${app.company}: ${result.suggestions} new suggestion${result.suggestions === 1 ? "" : "s"}. Nothing was submitted.`
        : result.refreshed
          ? `Rechecked ${result.refreshed} question${result.refreshed === 1 ? "" : "s"} for ${app.company}: no new suggestion available.`
          : `No questions needed refreshing for ${app.company}.`
    );
    await refreshUnanswered();
  };

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

  return (
    <div className="rv-page">
      {header}
      <div className="rv-bar">
        <div className="rv-bar-title">
          <h1>Unanswered questions</h1>
          {data && <span className="apps-muted">{data.counts.unanswered} application{data.counts.unanswered === 1 ? "" : "s"} · {data.counts.questions} question{data.counts.questions === 1 ? "" : "s"}{data.counts.reviewComplete ? ` · ${data.counts.reviewComplete} ready to continue` : ""}{saved ? ` · ${saved} reviewed here` : ""}</span>}
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
            {data.counts.reviewComplete > 0 && <span>{data.counts.reviewComplete} application{data.counts.reviewComplete === 1 ? " is" : "s are"} ready to continue.</span>}
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
            const answerable = app.questions.filter((q) => questionKind(q) !== "file" && !q.questionFamily).length;
            const hasOpenEnded = app.questions.some((q) => q.questionFamily);
            const questionValue = (q: PendingQ) => q.questionFamily
              ? values[app.id]?.[q.fingerprint] ?? q.userDraft ?? (draftModes[app.id]?.[q.fingerprint] === "replaced" ? "" : q.suggestedAnswer ?? "")
              : entry(app, q)?.v ?? "";
            const openEndedControls = (q: PendingQ) => {
              if (!q.questionFamily) return null;
              const mode = draftModes[app.id]?.[q.fingerprint];
              const draftAction = q.userDraftAction ?? mode;
              const currentAnswer = questionValue(q).trim();
              const hasDraft = q.reviewStatus === "draft";
              return (
                <div className="apps-open-actions" aria-label="Suggested answer actions">
                  {q.suggestedAnswer && q.reviewStatus !== "rejected" && !hasDraft && !mode && (
                    <button className="rv-primary" disabled={busy !== null} onClick={() => void reviewQuestion(app, q, "accept_suggestion")}>Accept suggestion</button>
                  )}
                  {mode && (
                    <button className="rv-primary" disabled={busy !== null || !currentAnswer} onClick={() => void reviewQuestion(app, q, mode === "edited" ? "edit_suggestion" : "replace_answer", currentAnswer)}>
                      {mode === "edited" ? "Save edit draft" : "Save replacement draft"}
                    </button>
                  )}
                  {hasDraft && draftAction && (
                    <>
                      <button className="rv-primary" disabled={busy !== null} onClick={() => void reviewQuestion(app, q, draftAction === "edited" ? "approve_edited_answer" : "approve_replacement")}>
                        {draftAction === "edited" ? "Approve edited answer" : "Approve replacement"}
                      </button>
                      <button className="apps-btn" disabled={busy !== null || !currentAnswer} onClick={() => void reviewQuestion(app, q, draftAction === "edited" ? "edit_suggestion" : "replace_answer", currentAnswer)}>Save draft changes</button>
                    </>
                  )}
                  {!mode && q.suggestedAnswer && <button className="apps-btn" disabled={busy !== null || hasDraft} onClick={() => setDraftModes((current) => ({ ...current, [app.id]: { ...current[app.id], [q.fingerprint]: "edited" } }))}>Edit</button>}
                  {!mode && <button className="apps-btn" disabled={busy !== null || hasDraft} onClick={() => { setDraftModes((current) => ({ ...current, [app.id]: { ...current[app.id], [q.fingerprint]: "replaced" } })); setValue(app, q, ""); }}>Replace</button>}
                  {q.suggestedAnswer && q.reviewStatus !== "rejected" && <button className="apps-link danger" disabled={busy !== null} onClick={() => void reviewQuestion(app, q, "reject_suggestion")}>Reject suggestion</button>}
                  {q.reviewStatus === "rejected" && <span className="apps-q-note">Suggestion rejected. The question is still unresolved.</span>}
                </div>
              );
            };
            return (
              <article key={app.id} data-id={app.id} className="rv-card" aria-label={`${app.company}: ${app.questions.length} question${app.questions.length === 1 ? "" : "s"}`}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(app); } }}>
                <header className="rv-card-head">
                  <CompanyLogo company={app.company} size="sm" />
                  <div className="rv-card-id">
                    <strong title={app.company}>{app.company}</strong>
                    <span title={app.title}>{app.title}</span>
                    <small>{app.questionReviewStatus === "complete" ? "Question review complete" : `${app.questions.length} question${app.questions.length === 1 ? "" : "s"}`}{app.ats ? ` · ${app.ats}` : ""}{app.priority ? ` · match ${app.priority}` : ""}</small>
                  </div>
                </header>
                <div className="rv-card-body">
                  {app.questions.map((q) => {
                    const e = q.questionFamily ? undefined : entry(app, q);
                    const from = e?.from ? cards[e.from]?.company : null;
                    return (
                      <Fragment key={q.fingerprint}>
                        <QuestionField q={q} appId={app.id} company={app.company}
                          value={questionValue(q)} onValue={(v) => setValue(app, q, v)}
                          scope={scopeOf(app, q)} onScope={(sc) => setScopes((cur) => ({ ...cur, [app.id]: { ...cur[app.id], [q.fingerprint]: sc } }))}
                          note={from && e?.v ? `Filled from your ${from} answer. Check it before saving.` : null} />
                        {openEndedControls(q)}
                      </Fragment>
                    );
                  })}
                </div>
                <footer className="rv-card-foot">
                  {errors[app.id] && <p className="apps-q-note warn" role="alert">{errors[app.id]}</p>}
                  {app.questionReviewStatus === "complete" ? (
                    <button className="rv-primary" disabled={busy !== null} onClick={() => void continueApplication(app)} title="Refills and validates this application in review-only mode. It will not submit.">
                      {busy === app.id ? "Continuing…" : "Continue Application"}
                    </button>
                  ) : answerable > 0 ? (
                    <button className="rv-primary" disabled={!answers.length || busy !== null} onClick={() => void save(app)}
                      title="Saves factual answers and refills in review-only mode. It will not submit.">
                      {busy === app.id ? "Saving…" : answers.length === 0 ? "Answer to save" : answers.length < answerable ? `Save ${answers.length} of ${answerable}` : "Save and refill for review"}
                    </button>
                  ) : null}
                  {hasOpenEnded && (
                    <button className="apps-btn" disabled={busy !== null} onClick={() => void refreshSuggestions(app)}
                      title="Recompute suggestions with the current answer logic and saved job info. Review-only; nothing is submitted.">
                      {busy === app.id ? "Refreshing…" : "Refresh suggestions"}
                    </button>
                  )}
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
