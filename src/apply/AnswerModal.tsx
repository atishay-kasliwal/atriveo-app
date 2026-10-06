import { useEffect, useState } from "react";
import QuestionField from "./QuestionField";
import { answerFor, postAction, type Scope } from "./engine";
import { blocking } from "./questionGroups";
import type { UnansweredApp } from "./reviewQueue";

// Answer on Today: the questions only you can answer for this one job, in a pop-up. Save sends them with the
// engine's `answer` action (as To answer does): remembered for every future job that asks the same question,
// except sensitive ones, which stay with this application. Nothing is submitted.

export default function AnswerModal({ app, onClose, onSaved }: { app: UnansweredApp; onClose: () => void; onSaved: (answered: number) => void }) {
  const questions = app.questions.filter(blocking);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const filled = questions.filter((q) => (values[q.fingerprint] ?? "").trim());
  const save = async () => {
    if (!filled.length || busy) return;
    setBusy(true); setError("");
    const answers = filled.map((q) => answerFor(q, values[q.fingerprint]!.trim(), scopes[q.fingerprint] ?? (q.sensitive ? "application" : "global")));
    const res = await postAction({ action: "answer", applicationId: app.id, answers }).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Couldn't save"); return; }
    onSaved(filled.length);
  };

  return (
    <div className="td-modal" role="dialog" aria-modal="true" aria-label={`Answer ${app.company}'s questions`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="td-modal-card td-answer">
        <header><div><h2>{app.company}</h2><span className="apps-muted">{app.title}</span></div><button type="button" className="apps-link" onClick={onClose} disabled={busy} aria-label="Close">✕</button></header>
        {questions.length === 0 ? <p className="apps-muted">Nothing left to answer here; it moves up for Open & Fill.</p> : (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {questions.map((q) => (
              <div key={q.fingerprint} className="td-answer-q">
                <QuestionField q={q} appId={app.id} company={app.company} value={values[q.fingerprint] ?? ""} scope={scopes[q.fingerprint] ?? (q.sensitive ? "application" : "global")}
                  onValue={(v) => setValues((s) => ({ ...s, [q.fingerprint]: v }))} onScope={(s) => setScopes((x) => ({ ...x, [q.fingerprint]: s }))}
                  note={q.answerProposal?.answer ? `Suggested: ${q.answerProposal.answer}` : null} />
              </div>
            ))}
            {error && <p className="td-error" role="alert">{error}</p>}
            <div className="td-modal-actions">
              <span className="apps-muted">{filled.length} of {questions.length} answered</span>
              <button type="button" className="apps-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="rv-primary" disabled={!filled.length || busy}>{busy ? "Saving…" : `Save ${filled.length || ""}`.trim()}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
