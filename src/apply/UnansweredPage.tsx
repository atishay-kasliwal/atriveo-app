import { attachmentMessage } from "./attachmentMessage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import QuestionField from "./QuestionField";
import { postAction, proposalText, reviewCategory, when, type PendingQ, type ReviewCategory, type Scope } from "./engine";
import { loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";

const FILTERS = { all: "All", ready_for_review: "Ready for review", needs_input: "Needs input", action_required: "Action required" } as const;
type Filter = keyof typeof FILTERS;
const COUNT_KEY = { ready_for_review: "readyForReview", needs_input: "needsInput", action_required: "actionRequired" } as const;
const SOURCE: Record<string, string> = { candidate_profile: "From Candidate Profile", approved_answer: "From an approved answer", approved_story: "From an approved story", none: "Needs your input" };
function explanation(q: PendingQ) {
  const reason = q.answerProposal?.reason ?? q.suggestionReason ?? q.openEndedAssessment?.reason ?? q.reason;
  if (reason.includes("candidate_written")) return "This site asks for your own wording. Write your response here.";
  if (q.answerProposal?.family === "compensation" || q.sensitive === "salary") return "Your compensation expectation hasn’t been established for this question.";
  if (reason.includes("missing_jd")) return "The saved job description is missing, so company details cannot be checked.";
  if (reason.includes("exceeds") || reason.includes("fits_field")) return "The grounded answer does not fit the form’s limit. Please write a shorter response.";
  if (q.openEndedUserReview?.status === "rejected") return "You rejected the proposal. Add a corrected answer when you’re ready.";
  return "There isn’t enough approved information to propose an answer to this question.";
}

export default function UnansweredPage({ header }: { header?: React.ReactNode }) {
  const { data, error, loading } = useUnansweredQueue(60_000);
  const { cards, error: cardsError } = useUnansweredCards();
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  const [filter, setFilter] = useState<Filter>("all");
  const [deferred, setDeferred] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  useLayoutEffect(() => {
    if (!grid.current) return;
    const el = grid.current;
    const resize = () => setColumns(Math.max(1, Math.min(3, Math.floor((el.clientWidth + 18) / 398))));
    resize(); const observer = new ResizeObserver(resize); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(timer); }, [notice]);
  const pageSize = columns * 2;
  const ordered = useMemo(() => {
    const rows = (data?.unanswered ?? []).filter(r => filter === "all" || (r[COUNT_KEY[filter]] ?? 0) > 0);
    return [...rows.filter(r => !deferred.includes(r.id)), ...rows.filter(r => deferred.includes(r.id))];
  }, [data, filter, deferred]);
  const start = ordered.length ? offset % ordered.length : 0;
  const visible = ordered.slice(start, start + pageSize);
  const upcoming = useMemo(() => ordered.slice(start, start + pageSize * 2), [ordered, start, pageSize]);
  useEffect(() => { void loadCards(upcoming); }, [upcoming]);
  const keyOf = (app: UnansweredApp, q: PendingQ) => `${app.id}:${q.fieldKey ?? q.fingerprint}`;
  const textOf = (app: UnansweredApp, q: PendingQ) => values[keyOf(app, q)] ?? q.userDraft ?? q.openEndedUserReview?.draftAnswer ?? proposalText(q);
  const defer = (id: string) => { setDeferred(ids => [...ids.filter(x => x !== id), id]); setNotice("Deferred for this session."); };
  const perform = async (app: UnansweredApp, body: object, message: string) => {
    if (busy) return;
    setBusy(app.id); setErrors(old => ({ ...old, [app.id]: "" }));
    try {
      const result = await postAction({ ...body, applicationId: app.id, expectedUpdatedAt: app.updatedAt });
      if (!result.ok) { setErrors(old => ({ ...old, [app.id]: result.error ?? "Couldn’t save. Please retry." })); return; }
      setNotice(message); await refreshUnanswered();
    } catch (e) { setErrors(old => ({ ...old, [app.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setBusy(null); }
  };
  const approve = (app: UnansweredApp, q: PendingQ) => perform(app, { action: "question_review", fieldKey: q.fieldKey, review: { operation: "approve_answer", answer: textOf(app, q), scope: scopes[keyOf(app, q)] ?? "application" } }, `${app.company}: answer approved. Continue remains a separate action.`);
  const shortcut = (event: React.KeyboardEvent, app: UnansweredApp, q: PendingQ) => {
    const target = event.target as HTMLElement;
    const typing = target.matches("input,textarea,select") || target.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && reviewCategory(q) !== "action_required" && textOf(app, q).trim()) { event.preventDefault(); void approve(app, q); return; }
    if (typing || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key.toLowerCase() === "a" && textOf(app, q).trim() && reviewCategory(q) !== "action_required") { event.preventDefault(); void approve(app, q); }
    if (event.key.toLowerCase() === "e") { event.preventDefault(); event.currentTarget.querySelector<HTMLElement>("textarea,input,select")?.focus(); }
    if (event.key.toLowerCase() === "s") { event.preventDefault(); defer(app.id); }
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key) && target === event.currentTarget) {
      event.preventDefault(); const items = Array.from(grid.current?.querySelectorAll<HTMLElement>(".review-question") ?? []);
      const index = items.indexOf(event.currentTarget as HTMLElement);
      items[(index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
    }
  };
  return <div className="rv-page review-workspace">
    {header}
    <div className="rv-bar"><div className="rv-bar-title"><h1>Review queue</h1><span className="apps-muted">{data?.counts.questions.toLocaleString() ?? "…"} questions · review answers, then continue separately</span></div>
      <button className="apps-refresh" onClick={() => void refreshUnanswered()} disabled={loading}>{loading ? "Updating…" : `Updated ${when(data?.generatedAt ?? null)} ↻`}</button></div>
    <nav className="review-filters" aria-label="Review state">{Object.entries(FILTERS).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value as Filter); setOffset(0); }}>
      {label} <span>{value === "all" ? data?.counts.questions ?? "…" : data?.counts[COUNT_KEY[value as ReviewCategory]] ?? "…"}</span></button>)}
      <details className="review-shortcuts"><summary>Shortcuts</summary><span>Focus a question: A approve · E edit · S later · arrows move. Ctrl/⌘ Enter approves your edit.</span></details></nav>
    <main className="rv-main">
      {(error || cardsError) && <p className="apps-error" role="alert">{error || cardsError} <button className="apps-link" onClick={() => void refreshUnanswered()}>Retry</button></p>}
      {!data && !error && <p className="apps-muted">Loading your review queue…</p>}
      {data && !ordered.length && <div className="rv-empty"><strong>No questions in this view.</strong><span>Choose another review state to keep going.</span></div>}
      <div ref={grid} className="rv-columns" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {visible.map(row => {
          const app = cards[row.id];
          if (!app || app.updatedAt < row.updatedAt) return <article key={row.id} className="rv-card rv-card-wait" aria-busy="true">Loading questions…</article>;
          const questions = app.questions.filter(q => filter === "all" || reviewCategory(q) === filter);
          return <article key={app.id} className="rv-card" aria-label={app.company} aria-busy={busy === app.id}>
            <header className="rv-card-head"><CompanyLogo company={app.company} size="sm" /><div className="rv-card-id"><strong>{app.company}</strong><span>{app.title}</span><small>{app.questions.length} pending · {app.ats}</small></div></header>
            <div className="rv-card-body">{questions.map(q => {
              const category = reviewCategory(q); const key = keyOf(app, q); const text = textOf(app, q);
              const narrative = q.openEndedAssessment?.questionFamily || q.questionFamily === "why_company_role" || q.type === "textarea";
              const canReuse = !narrative && !["demographic", "attachment", "unknown"].includes(q.answerProposal?.family ?? "unknown");
              return <section key={key} className={`review-question is-${category}`} tabIndex={0} onKeyDown={e => shortcut(e, app, q)} aria-label={q.label}>
                <div className="review-state">{FILTERS[category]}</div>
                {category === "action_required" ? <><h2>{q.type === "file" ? "Attachment needs attention" : "Form inspection needed"}</h2><p className="apps-q-note">{q.type === "file" ? attachmentMessage(q.reason) : `${q.label}. Open the form to inspect this control; a text answer cannot resolve it.`}</p><a href={app.url} target="_blank" rel="noreferrer">Open form ↗</a></>
                  : <><p className="review-source">{q.userDraft || q.openEndedUserReview?.status === "draft" ? "Your saved draft" : proposalText(q) ? SOURCE[q.answerProposal?.source ?? "approved_story"] : explanation(q)}</p>
                    {narrative ? <label className="apps-q"><strong className="apps-q-label">{q.label}{q.required ? " *" : ""}</strong><textarea rows={7} value={text} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} placeholder="Your answer" /></label>
                      : <QuestionField hideScope q={q} appId={app.id} company={app.company} value={text} scope={scopes[key] ?? "application"} onValue={value => setValues(v => ({ ...v, [key]: value }))} onScope={scope => setScopes(s => ({ ...s, [key]: scope }))} />}
                    {q.answerProposal?.caution && <p className="apps-q-note">{q.answerProposal.caution}</p>}
                    <div className="review-actions"><button className="rv-primary" disabled={busy !== null || !text.trim() || !q.fieldKey} onClick={() => void approve(app, q)}>{busy === app.id ? "Saving…" : "✓ Approve answer"}</button>
                      <button className="apps-btn" disabled={busy !== null || !text.trim()} onClick={() => void perform(app, { action: "question_review", fieldKey: q.fieldKey, review: { operation: "replace_answer", answer: text } }, "Draft saved. It hasn’t been approved.")}>Save draft</button></div>
                    <details className="review-details"><summary>Sources & answer reuse</summary><p>{q.selectedStory ?? q.openEndedAssessment?.selectedStory ?? "Candidate facts / your own response"}</p><p className="apps-q-note">{q.answerProposal?.reason ?? q.suggestionReason ?? q.detail}</p>
                      {canReuse && <label>Use this approved answer for<select value={scopes[key] ?? "application"} onChange={e => setScopes(s => ({ ...s, [key]: e.target.value as Scope }))}><option value="application">Only this application</option><option value="company">Matching questions at {app.company}</option><option value="global">Similar questions across applications</option></select></label>}
                      {!canReuse && <p className="apps-q-note">This response stays with this application.</p>}
                      <pre>{JSON.stringify(q.answerProposal?.provenance ?? q.openEndedAssessment, null, 2)}</pre>
                      {proposalText(q) && <button className="apps-link" disabled={busy !== null} onClick={() => void perform(app, { action: "question_review", fieldKey: q.fieldKey, review: { operation: "reject_suggestion" } }, "Proposal rejected. Your question remains in review.")}>Reject proposal</button>}
                    </details></>}
              </section>;
            })}</div>
            <footer className="rv-card-foot">{errors[app.id] && <p className="apps-error" role="alert">{errors[app.id]} <button className="apps-link" onClick={() => void refreshUnanswered()}>Load latest version</button></p>}
              {!app.questions.length && app.questionReviewStatus === "complete" && <button className="rv-primary" disabled={busy !== null} onClick={() => void perform(app, { action: "continue_application" }, "Queued for refill and validation. Submission still requires separate approval.")}>Continue application</button>}
              <details className="review-details"><summary>Application actions</summary><div className="rv-card-links"><button className="apps-link" onClick={() => defer(app.id)}>Later</button><a href={app.url} target="_blank" rel="noreferrer">Open form ↗</a><button className="apps-link" disabled={busy !== null} onClick={() => void perform(app, { action: "refresh_suggestions" }, "Proposals refreshed. No answer was approved.")}>Refresh suggestions</button></div>
                <button className="apps-link" disabled={busy !== null} onClick={() => { if (window.confirm(`Skip ${app.company} — ${app.title}?`)) void perform(app, { action: "skip", note: "Skipped in review workspace" }, "Application skipped."); }}>Skip this job</button></details>
            </footer></article>;
        })}
      </div>
      {ordered.length > pageSize && <div className="review-pagination"><span className="apps-muted">{start + 1}–{Math.min(start + pageSize, ordered.length)} of {ordered.length} applications</span><button className="apps-btn" onClick={() => setOffset(current => current + pageSize)}>Next applications →</button></div>}
    </main>{notice && <p className="apps-toast" role="status">{notice}</p>}
  </div>;
}
