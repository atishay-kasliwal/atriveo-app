import ApplicationDetail from "./ApplicationDetail";
import DiscardApplications from "./DiscardApplications";
import { attachmentMessage } from "./attachmentMessage";
import { useEffect, useMemo, useRef, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import PriorityTags from "../components/PriorityTags";
import QuestionField from "./QuestionField";
import { postAction, proposalText, reviewCategory, type PendingQ } from "./engine";
import { loadCards, refreshUnanswered, useUnansweredCards, useUnansweredQueue, type UnansweredApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./application-review.css";

function source(q: PendingQ) {
  if (q.openEndedUserReview?.generatedBy === "muse") return "Muse draft · review before approving";
  if (q.userDraft || q.openEndedUserReview?.status === "draft") return "Your saved draft";
  if (q.openEndedUserReview?.status === "rejected") return "Suggestion rejected · add your answer";
  if (proposalText(q)) {
    if (q.answerProposal?.source === "candidate_profile") return "From your profile";
    const band = q.openEndedSuggestion?.confidenceBand;
    return `Suggested from approved information${band ? ` · ${band} confidence` : ""}`;
  }
  return "Your answer is needed";
}
function useViewport() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => { const update = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }, []);
  return size;
}

export default function UnansweredPage({ header }: { header?: React.ReactNode }) {
  const { data, error, loading } = useUnansweredQueue(60_000);
  const { cards, error: cardsError } = useUnansweredCards();
  const [search, setSearch] = useState("");
  // Opened from a Today card: start on that application.
  const [activeId, setActiveId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("app"));
  const [queuePage, setQueuePage] = useState(0);
  const [questionPage, setQuestionPage] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draftVersions, setDraftVersions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState<"form" | "details">("form");
  const [expanded, setExpanded] = useState<PendingQ | null>(null);
  const [deferred, setDeferred] = useState<string[]>([]);
  const editor = useRef<HTMLDialogElement>(null);
  const viewport = useViewport();
  const queueSize = Math.max(3, Math.min(8, Math.floor((viewport.height - 300) / 65)));
  const perPage = viewport.width < 1050 ? 3 : viewport.height < 730 ? 4 : 6;
  const rows = useMemo(() => {
    const term = search.toLowerCase().trim();
    const candidates = (data?.unanswered ?? []).filter(r => {
      const name = `${r.company ?? cards[r.id]?.company ?? ""} ${r.title ?? cards[r.id]?.title ?? ""}`;
      return !term || name.toLowerCase().includes(term);
    });
    return [...candidates].sort((a, b) => Number(deferred.includes(a.id)) - Number(deferred.includes(b.id)) || (a.company ?? cards[a.id]?.company ?? "").localeCompare(b.company ?? cards[b.id]?.company ?? "") || a.id.localeCompare(b.id));
  }, [data, cards, search, deferred]);
  const page = Math.min(queuePage, Math.max(0, Math.ceil(rows.length / queueSize) - 1));
  const visibleRows = useMemo(() => rows.slice(page * queueSize, (page + 1) * queueSize), [rows, page, queueSize]);
  const activeRow = rows.find(r => r.id === activeId) ?? visibleRows[0];
  const app = activeRow ? cards[activeRow.id] : undefined;
  const appCurrent = app && app.updatedAt >= (activeRow?.updatedAt ?? "");
  const toLoad = useMemo(() => activeRow ? [...visibleRows, activeRow] : visibleRows, [visibleRows, activeRow]);
  useEffect(() => { void loadCards(toLoad); }, [toLoad]);
  useEffect(() => { if (expanded) editor.current?.showModal(); else editor.current?.close(); }, [expanded]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(timer); }, [notice]);
  const keyOf = (a: UnansweredApp, q: PendingQ) => `${a.id}:${draftVersions[a.id] ?? a.updatedAt}:${q.fieldKey ?? q.fingerprint}`;
  const textOf = (a: UnansweredApp, q: PendingQ) => values[keyOf(a, q)] ?? q.userDraft ?? q.openEndedUserReview?.draftAnswer ?? proposalText(q);
  const setText = (a: UnansweredApp, q: PendingQ, text: string) => {
    setDraftVersions(v => ({ ...v, [a.id]: v[a.id] ?? a.updatedAt }));
    setValues(v => ({ ...v, [keyOf(a, q)]: text }));
  };
  const clearEdits = (id: string) => {
    setDraftVersions(v => Object.fromEntries(Object.entries(v).filter(([key]) => key !== id)));
    setValues(v => Object.fromEntries(Object.entries(v).filter(([key]) => !key.startsWith(`${id}:`))));
  };
  const choose = (id: string) => { setActiveId(id); setQuestionPage(0); setActionError(""); setTab("form"); setExpanded(null); };
  const questions = app?.questions ?? [];
  const countPages = Math.max(1, Math.ceil(questions.length / perPage));
  const qPage = Math.min(questionPage, countPages - 1);
  const shown = questions.slice(qPage * perPage, (qPage + 1) * perPage);
  const answerable = questions.filter(q => reviewCategory(q) !== "action_required");
  const complete = app ? answerable.filter(q => textOf(app, q).trim()).length : 0;
  // Optional questions are yours to answer or leave blank; a blank one (or an optional control the page needs,
  // like a cover letter upload) is approved as "leave blank" and never filled.
  const isBlank = (q: PendingQ) => !app || reviewCategory(q) === "action_required" || !textOf(app, q).trim();
  const leaveBlank = app ? questions.filter(q => !q.required && isBlank(q)) : [];
  const optionalCount = questions.filter(q => !q.required).length;
  const blocked = questions.filter(q => q.required && reviewCategory(q) === "action_required").length;
  const requiredLeft = questions.filter(q => q.required && isBlank(q)).length;
  const staleEdits = Boolean(app && draftVersions[app.id] && draftVersions[app.id] !== app.updatedAt);
  const canApprove = Boolean(!staleEdits && appCurrent && questions.length && !requiredLeft && questions.every(q => q.fieldKey));
  const perform = async (body: object, message: string) => {
    if (!app || busy) return;
    setBusy(true); setActionError("");
    try {
      const result = await postAction({ ...body, applicationId: app.id, expectedUpdatedAt: draftVersions[app.id] ?? app.updatedAt });
      if (!result.ok) { setActionError(result.error ?? "Couldn’t save this form."); return; }
      clearEdits(app.id); setNotice(message); await refreshUnanswered();
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const answersOf = (a: UnansweredApp) => answerable.filter(q => textOf(a, q).trim()).map(q => ({ fieldKey: q.fieldKey, answer: textOf(a, q) }));
  const saveDraft = () => { if (app) void perform({ action: "application_review", operation: "save_drafts", answers: answersOf(app) }, "Application draft saved. Your answers still need approval."); };
  /**
   * Approve every answer, then start filling at once: the engine fills and verifies the form (never submits),
   * and it moves to Ready to submit, where you approve the submission itself.
   */
  const approveAndFill = async () => {
    if (!app || busy || !canApprove) return;
    setBusy(true); setActionError("");
    try {
      const approved = await postAction({ action: "application_review", operation: "approve_all", applicationId: app.id, expectedUpdatedAt: draftVersions[app.id] ?? app.updatedAt,
        answers: answersOf(app), ...(leaveBlank.length ? { leaveBlank: leaveBlank.map(q => q.fieldKey) } : {}) });
      if (!approved.ok) { setActionError(approved.error ?? "Couldn’t save this form."); return; }
      clearEdits(app.id);
      const blanks = leaveBlank.length ? `, ${leaveBlank.length} optional left blank` : "";
      const filling = approved.updatedAt ? await postAction({ action: "continue_application", applicationId: app.id, expectedUpdatedAt: approved.updatedAt }) : { ok: false, error: "no version returned" };
      if (!filling.ok) { setNotice(`Answers approved${blanks}. Filling didn't start (${filling.error}); choose Fill and verify.`); return; }
      setNotice(`Answers approved${blanks}. Filling and verifying now; it moves to Ready to submit once checked. Nothing is submitted.`);
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); await refreshUnanswered(); }
  };
  const move = (delta: number) => {
    const index = rows.findIndex(r => r.id === activeRow?.id), next = Math.max(0, Math.min(rows.length - 1, index + delta));
    if (rows[next]) { choose(rows[next]!.id); setQueuePage(Math.floor(next / queueSize)); }
  };
  // Rejecting reloads this form, so it waits until unsaved edits are saved or discarded.
  const unsaved = Boolean(app && draftVersions[app.id]);
  const canReject = (q: PendingQ) => Boolean(q.fieldKey && proposalText(q) && q.reviewStatus !== "rejected" && reviewCategory(q) !== "action_required");
  const reject = (q: PendingQ) => void perform({ action: "question_review", fieldKey: q.fieldKey, review: { operation: "reject_suggestion" } }, "Suggestion rejected. Add your own answer before approving.");
  const field = (q: PendingQ) => app && <QuestionField hideScope q={q} appId={app.id} company={app.company} value={textOf(app, q)} scope="application" onValue={text => setText(app, q, text)} onScope={() => {}} />;

  return <div className="rv-page application-workspace">
    {header}
    <div className="ar-toolbar"><div><span className="ar-eyebrow">APPLICATION REVIEW</span><h1>One company. One complete form.</h1></div><div className="ar-toolbar-actions"><span>{data?.counts.unanswered ?? "…"} applications{data?.counts.reviewComplete ? ` · ${data.counts.reviewComplete} ready to fill and verify` : ""}</span><button className="apps-btn" disabled={loading || busy} onClick={() => void refreshUnanswered()}>{loading ? "Updating…" : "Refresh"}</button><button className="apps-btn" aria-pressed={manage} onClick={() => setManage(!manage)}>Manage queue</button></div></div>
    {(error || cardsError) && <p className="ar-error" role="alert">{error || cardsError}</p>}
    <main className="ar-workspace">
      <aside className="ar-queue" aria-label="Application list">
        <div className="ar-queue-tools"><input aria-label="Find a company or role" placeholder="Find a company or role…" value={search} onChange={e => { setSearch(e.target.value); setQueuePage(0); setActiveId(null); }} /></div>
        <div className="ar-company-list">{visibleRows.map(row => {
          const card = cards[row.id], company = row.company ?? card?.company ?? "Loading company…";
          return <div className={`ar-company-item ${row.id === activeRow?.id ? 'is-active' : ''}`} key={row.id}>
            {manage && <input type="checkbox" aria-label={`Select ${company}`} checked={selected.includes(row.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, row.id].slice(0, 200) : ids.filter(id => id !== row.id))} />}
            <button className="ar-company" aria-current={row.id === activeRow?.id ? 'true' : undefined} onClick={() => choose(row.id)}><CompanyLogo company={company} size="sm" /><span><strong>{company}</strong><small>{row.title ?? card?.title ?? "Loading role…"}</small></span><b title={`${row.n} questions`}>{row.n || '✓'}</b></button>
          </div>;
        })}</div>
        <footer className="ar-queue-footer"><span>{rows.length ? `${page * queueSize + 1}–${Math.min((page + 1) * queueSize, rows.length)} of ${rows.length}` : "No applications"}</span><button aria-label="Previous companies" disabled={!page} onClick={() => { setQueuePage(page - 1); setActiveId(null); }}>←</button><button aria-label="Next companies" disabled={(page + 1) * queueSize >= rows.length} onClick={() => { setQueuePage(page + 1); setActiveId(null); }}>→</button></footer>
      </aside>
      <section className="ar-panel" aria-label="Application form" aria-busy={busy}>
        {!data && <div className="ar-empty">Loading your applications…</div>}
        {data && !rows.length && <div className="ar-empty"><span className="ar-empty-icon">✓</span><h2>No applications to review</h2><p>{search ? "Try another company or role." : "New applications will appear here after their questions are collected."}</p></div>}
        {activeRow && !appCurrent && <div className="ar-empty">Loading the complete application form…</div>}
        {appCurrent && app && <>
          <header className="ar-application-head"><CompanyLogo company={app.company} size="sm" /><div><span className="ar-eyebrow">{app.ats} · APPLICATION</span><h2>{app.company}</h2><p>{app.title}</p><PriorityTags tags={app.priorityTags} /></div><div className="ar-progress"><strong>{questions.length ? `${complete} / ${questions.length}` : '✓'}</strong><span>{questions.length ? `answers ready${optionalCount ? ` · ${optionalCount} optional` : ''}` : 'Answers reviewed'}</span></div></header>
          <div className="ar-form-nav"><div role="tablist" aria-label="Application views"><button role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>Your answers <span>{questions.length}</span></button><button role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Application details</button></div><a href={app.url} target="_blank" rel="noreferrer">Open original form ↗</a></div>
          <select className="ar-mobile-app" aria-label="Choose application" value={activeRow.id} onChange={e => choose(e.target.value)}>{rows.map(r => <option key={r.id} value={r.id}>{r.company ?? cards[r.id]?.company ?? "Loading"} — {r.title ?? cards[r.id]?.title}</option>)}</select>
          {tab === "details" ? <div className="ar-details"><ApplicationDetail id={app.id} version={app.updatedAt} /></div> : <form id="application-answer-form" className="ar-form" onSubmit={e => { e.preventDefault(); void approveAndFill(); }}>
            {!questions.length ? <div className="ar-empty"><span className="ar-empty-icon">✓</span><h3>All answers are reviewed</h3><p>Fill the original form and verify its fields and attachments next.</p><button className="apps-btn" type="button" onClick={() => setTab("details")}>Review the complete answer plan</button></div> : <>
              <div className="ar-question-grid" style={{ gridTemplateColumns: viewport.width >= 1050 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gridTemplateRows: `repeat(${Math.ceil(shown.length / (viewport.width >= 1050 ? 2 : 1))}, minmax(0, 1fr))` }}>
                {shown.map((q, index) => <section className={`ar-question ${reviewCategory(q) === 'action_required' ? 'is-blocked' : ''}`} key={q.fieldKey ?? q.fingerprint} aria-label={q.label}>
                  <div className="ar-question-meta"><span>{String(qPage * perPage + index + 1).padStart(2, '0')} {!q.required && <em className="ar-optional" title="Answer it or leave it blank: your call">Optional</em>}<span>{reviewCategory(q) === 'action_required' ? (q.required ? 'Action needed' : 'Left blank unless you add it on the page') : source(q)}</span></span><span className="ar-question-tools">{canReject(q) && <button type="button" className="is-reject" disabled={busy || unsaved} title={unsaved ? "Save a draft first: rejecting reloads this form" : "Reject this suggestion and answer it yourself"} onClick={() => reject(q)}>Reject</button>}<button type="button" onClick={() => setExpanded(q)} aria-label={`Expand question ${qPage * perPage + index + 1}`}>Expand ↗</button></span></div>
                  {reviewCategory(q) === 'action_required' ? <div className="ar-attachment"><strong>{q.label}</strong><p>{q.type === 'file' ? attachmentMessage(q.reason) : 'Open the original form to inspect this control.'}</p></div> : field(q)}
                  {q.openEndedUserReview?.missingFacts?.length ? <small className="ar-caution" title={q.openEndedUserReview.missingFacts.join('; ')}>Confirm: {q.openEndedUserReview.missingFacts.join('; ')}</small> : null}
                </section>)}
              </div>
              <div className="ar-page-nav"><span>{questions.length <= perPage ? `All ${questions.length} questions in this form` : `Questions ${qPage * perPage + 1}–${Math.min((qPage + 1) * perPage, questions.length)} of ${questions.length}`}</span>{countPages > 1 && <div><button type="button" disabled={!qPage} onClick={() => setQuestionPage(qPage - 1)}>← Previous</button><span>{qPage + 1} / {countPages}</span><button type="button" disabled={qPage + 1 === countPages} onClick={() => setQuestionPage(qPage + 1)}>Next →</button></div>}<small>Answers apply to this application</small></div>
            </>}
          </form>}
          <footer className="ar-actionbar">
            {staleEdits && <p role="alert">This application changed while you were editing. Your edits are still here. <button className="apps-link" onClick={() => { if (window.confirm("Replace your unsaved edits with the latest saved answers?")) clearEdits(app.id); }}>Load latest answers</button></p>}
            {actionError && <p role="alert">{actionError} <button className="apps-link" onClick={() => void refreshUnanswered()}>Load latest version</button></p>}
            <div className="ar-actionrow"><div><button className="apps-btn" disabled={busy} onClick={() => { setDeferred(ids => [...ids.filter(id => id !== app.id), app.id]); move(1); }}>Later</button><button className="apps-link" disabled={busy} onClick={() => void perform({ action: 'refresh_suggestions' }, 'Suggestions refreshed. Review the full form before approving.')}>Refresh suggestions</button></div><div><span className="ar-action-hint">{blocked ? `${blocked} control${blocked > 1 ? 's' : ''} need attention` : requiredLeft ? `${requiredLeft} required answer${requiredLeft > 1 ? 's' : ''} left` : leaveBlank.length ? `${leaveBlank.length} optional left blank` : questions.length ? 'Fills and verifies; never submits' : 'Submission stays a separate step'}</span>{questions.length > 0 && <button className="apps-btn" disabled={busy || staleEdits || !complete} onClick={saveDraft}>Save draft</button>}{questions.length ? <button className="rv-primary" disabled={busy || !canApprove} onClick={() => void approveAndFill()} title="Approves these answers and fills the form to verify it. Nothing is submitted: that's a separate step on Ready to submit.">{busy ? 'Saving…' : leaveBlank.length ? `Approve ${questions.length - leaveBlank.length}, leave ${leaveBlank.length} blank & fill` : `Approve all ${questions.length} & fill`}</button> : app.questionReviewStatus === 'complete' && <button className="rv-primary" disabled={busy} onClick={() => void perform({action:'continue_application'}, 'Queued to fill and verify. Submission requires separate approval.')}>Fill and verify</button>}</div></div>
          </footer>
        </>}
      </section>
    </main>
    {manage && <div className="ar-manage"><DiscardApplications selected={selected} disabled={busy} onDone={async () => { setSelected([]); await refreshUnanswered(); }} /><button className="apps-link" onClick={() => setSelected(visibleRows.map(r => r.id))}>Select visible</button><button className="apps-link" onClick={() => setSelected([])}>Clear selection</button></div>}
    {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    <dialog ref={editor} className="ar-editor" onClose={() => setExpanded(null)}><header><span className="ar-eyebrow">{app?.company} · ANSWER DETAIL</span><button aria-label="Close answer detail" onClick={() => setExpanded(null)}>✕</button></header>{expanded && <><h2>{expanded.label}</h2><p>{source(expanded)}</p>{field(expanded)}<div className="ar-evidence"><strong>Sources and context</strong><p>{expanded.selectedStory ?? expanded.openEndedAssessment?.selectedStory ?? 'Candidate profile / your response'}</p>{expanded.openEndedSuggestion && <p>{expanded.openEndedSuggestion.confidenceBand === "high" ? "High" : "Medium"} confidence{expanded.openEndedSuggestion.matchedSignals?.length ? ` · context: ${expanded.openEndedSuggestion.matchedSignals.map(s => s.replace(/^(?:domain|title_skill|jd_skill):/, "")).join(", ")}` : ""}</p>}<p>{expanded.answerProposal?.caution ?? expanded.detail ?? expanded.answerProposal?.reason}</p>{expanded.openEndedUserReview?.sources?.map(s => <small key={s}>{s}</small>)}{expanded.openEndedUserReview?.missingFacts?.map(s => <p key={s}>Needs confirmation: {s}</p>)}</div><footer><span>Approve every answer together from the application form.</span>{canReject(expanded) && <button className="apps-link danger" disabled={busy || unsaved} title={unsaved ? "Save a draft first: rejecting reloads this form" : undefined} onClick={() => { reject(expanded); setExpanded(null); }}>Reject suggestion</button>}<button className="rv-primary" onClick={() => setExpanded(null)}>Done editing</button></footer></>}</dialog>
  </div>;
}
