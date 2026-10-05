import { useEffect, useMemo, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import QuestionField from "./QuestionField";
import { answerFor, postAction, proposalText, reviewCategory, type PendingQ } from "./engine";
import { loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type QueuedApp, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";

// To answer: only the questions nobody has answered yet: no profile answer, no suggestion, no draft. One card
// per application, five at a time. Save remembers your answers for that application (the engine's `answer`
// action) and sends it back to be filled with them; Apply with Atriveo uses them too. Drafted answers are
// not shown here: you check those in the extension's side panel when you Open & Fill.

/** Nothing to start from: no answer, suggestion or draft. Attachments and unreadable fields are left to the page. */
export function needsYourAnswer(q: PendingQ): boolean {
  return reviewCategory(q) === "needs_input" && !proposalText(q).trim() && !q.userDraft?.trim() && !q.openEndedUserReview?.draftAnswer?.trim();
}

function useColumns() {
  const pick = () => window.innerWidth >= 1400 ? 5 : window.innerWidth >= 1100 ? 4 : window.innerWidth >= 760 ? 2 : 1;
  const [n, setN] = useState(pick);
  useEffect(() => { const f = () => setN(pick()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

export default function QuestionsPage({ header }: { header?: React.ReactNode }) {
  const { data, error } = useUnansweredQueue(60_000);
  const { cards, error: cardsError } = useUnansweredCards();
  const columns = useColumns();
  // Opened from a Today card: that application comes first.
  const [first] = useState(() => new URLSearchParams(window.location.search).get("app"));
  const [page, setPage] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSkip, setConfirmSkip] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(t); }, [notice]);

  // Applications with at least one question waiting for you to type, fewest first: quick ones clear fast.
  const rows = useMemo<QueuedApp[]>(() => (data?.unanswered ?? [])
    .filter((q) => (q.needsInput ?? 0) > 0 && done[q.id] !== q.updatedAt)
    .filter((q) => { const c = cards[q.id]; return !c || c.updatedAt < q.updatedAt || c.questions.some(needsYourAnswer); })
    .sort((a, b) => Number(b.id === first) - Number(a.id === first) || Number(later.includes(a.id)) - Number(later.includes(b.id)) || (a.needsInput ?? 0) - (b.needsInput ?? 0)),
  [data, cards, done, later, first]);
  const pages = Math.max(1, Math.ceil(rows.length / columns));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * columns, (current + 1) * columns);
  const shownKey = shown.map((q) => `${q.id}@${q.updatedAt}`).join(",");
  // The next page too, so moving on doesn't wait on the slow link.
  const nextPage = rows.slice((current + 1) * columns, (current + 2) * columns);
  useEffect(() => { void loadCards([...shown, ...nextPage]); }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const questionsLeft = rows.reduce((n, q) => n + (q.needsInput ?? 0), 0);

  const key = (app: UnansweredApp, q: PendingQ) => `${app.id}:${q.fieldKey ?? q.fingerprint}`;
  const save = async (app: UnansweredApp, open: PendingQ[]) => {
    const typed = open.filter((q) => values[key(app, q)]?.trim());
    if (!typed.length) return;
    setBusy(app.id);
    setErrors((e) => ({ ...e, [app.id]: "" }));
    const res = await postAction({ action: "answer", applicationId: app.id, answers: typed.map((q) => answerFor(q, values[key(app, q)]!.trim(), "application")) });
    setBusy(null);
    if (!res.ok) { setErrors((e) => ({ ...e, [app.id]: res.error ?? "Couldn't save" })); return; }
    const row = rows.find((r) => r.id === app.id);
    if (row) setDone((d) => ({ ...d, [app.id]: row.updatedAt }));
    const left = open.length - typed.length;
    setNotice(left ? `Saved ${typed.length} for ${app.company}. ${left} still open: it comes back here.` : `Saved ${app.company}. It's filled again with your answers and shows up on Today.`);
    setTimeout(() => void refreshUnanswered(), 1500);
  };
  const skip = async (app: UnansweredApp) => {
    setConfirmSkip(null);
    setBusy(app.id);
    const res = await postAction({ action: "skip", applicationId: app.id, note: "skipped on To answer" });
    setBusy(null);
    if (!res.ok) { setErrors((e) => ({ ...e, [app.id]: res.error ?? "Couldn't skip" })); return; }
    const row = rows.find((r) => r.id === app.id);
    if (row) setDone((d) => ({ ...d, [app.id]: row.updatedAt }));
    setNotice(`Skipped ${app.company}.`);
  };

  const card = (row: QueuedApp) => {
    const app = cards[row.id];
    if (!app || app.updatedAt < row.updatedAt) {
      return <article key={row.id} className="td-card is-warn" aria-busy="true"><div className="td-head"><CompanyLogo company={row.company ?? ""} size="sm" /><div className="td-id"><strong>{row.company ?? "Loading…"}</strong><span>{row.title ?? ""}</span></div></div><p className="td-note">Loading its questions…</p></article>;
    }
    const open = app.questions.filter(needsYourAnswer);
    const typed = open.filter((q) => values[key(app, q)]?.trim()).length;
    const isBusy = busy === app.id;
    return (
      <article key={row.id} className="td-card is-warn qa-card" aria-label={`${app.company}: ${open.length} to answer`} aria-busy={isBusy}>
        <header className="td-head">
          <CompanyLogo company={app.company} size="sm" />
          <div className="td-id"><strong title={app.company}>{app.company}</strong><span title={app.title}>{app.title}</span></div>
        </header>
        <span className="td-stage is-warn">{open.length} to answer</span>
        <div className="td-body qa-questions">
          {open.map((q) => (
            <QuestionField key={key(app, q)} hideScope q={q} appId={app.id} company={app.company} value={values[key(app, q)] ?? ""} scope="application"
              onValue={(v) => setValues((s) => ({ ...s, [key(app, q)]: v }))} onScope={() => {}} />
          ))}
          {errors[app.id] && <p className="td-error" role="alert">{errors[app.id]}</p>}
        </div>
        <footer className="td-foot">
          <button className="rv-primary" disabled={isBusy || !typed} onClick={() => void save(app, open)}>{isBusy ? "Saving…" : typed ? `Save ${typed} answer${typed === 1 ? "" : "s"}` : "Type an answer"}</button>
          <div className="td-links">
            <button className="apps-link" disabled={isBusy} onClick={() => setLater((l) => [...l.filter((id) => id !== app.id), app.id])}>Later</button>
            {confirmSkip === app.id
              ? <span>Skip this job? <button className="apps-link" onClick={() => void skip(app)}>Skip</button> <button className="apps-link" onClick={() => setConfirmSkip(null)}>Keep</button></span>
              : <button className="apps-link" disabled={isBusy} onClick={() => setConfirmSkip(app.id)}>Skip job</button>}
            <a href={app.url} target="_blank" rel="noreferrer">Job ↗</a>
          </div>
        </footer>
      </article>
    );
  };

  return (
    <div className="rv-page td-page">
      {header}
      <div className="td-bar">
        <div className="td-title"><h1>To answer</h1><span className="apps-muted">{!data ? "Loading…" : rows.length ? `${questionsLeft} question${questionsLeft === 1 ? "" : "s"} in ${rows.length} application${rows.length === 1 ? "" : "s"}. Only ones with no answer yet.` : "Nothing left to answer"}</span></div>
      </div>
      {(error || cardsError) && <p className="ar-error" role="alert">{error || cardsError}</p>}
      <main className="td-grid qa-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {!data && <div className="td-empty">Loading your questions…</div>}
        {data && !rows.length && <div className="td-empty"><strong>Every question has an answer.</strong><span>Go to Today and Open & Fill; you check any drafted answers in the side panel.</span></div>}
        {shown.map(card)}
      </main>
      {rows.length > columns && (
        <nav className="td-pager" aria-label="More applications">
          <button className="apps-btn" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous applications">←</button>
          <span>{current * columns + 1}–{Math.min((current + 1) * columns, rows.length)} of {rows.length}</span>
          <button className="apps-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label="Next applications">→</button>
        </nav>
      )}
      {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
