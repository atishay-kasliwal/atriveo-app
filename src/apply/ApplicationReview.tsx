import { useEffect, useRef, useState } from "react";
import { loadDetail, type Detail } from "./detail";
import { getTailorServerBase } from "../utils/tailorServer";

/** Read-only inspection of this application's saved answers and selected attachment. */
export default function ApplicationReview({ application, onClose }: {
  application: { id: string; updatedAt: string; company: string; mode: "answers" | "resume" };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    loadDetail(application.id, application.updatedAt).then(d => {
      if (live) { if (d.ok === false) setError(d.error || "Could not load this application."); else setDetail(d); }
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [application.id, application.updatedAt]);
  const pdf = detail?.resume.path ? `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(detail.resume.path)}` : null;
  return <dialog ref={dialog} className={`td-review-dialog${application.mode === "resume" ? " is-resume" : ""}`} onCancel={onClose} onClose={onClose}>
    <header><h2>{application.company} · Review {application.mode}</h2><button className="apps-btn" onClick={onClose} aria-label="Close review">Close</button></header>
    {error && <p role="alert">{error}</p>}
    {!detail && !error && <p role="status">Loading…</p>}
    {detail && (application.mode === "resume" ? <>
      <p className="apps-muted">The resume selected for this application: {detail.resume.fileName || "No filename recorded"}</p>
      {pdf ? <iframe title={`${application.company} selected resume`} src={`${pdf}#page=1&view=Fit&zoom=page-fit&toolbar=0&navpanes=0`} /> : <p>No resume is recorded for this application.</p>}
    </> : <>
      <p className="apps-muted">Saved answers for this application. Reviewing here does not approve or submit anything.</p>
      {detail.questions.length ? <dl>{detail.questions.map((q, i) => <div key={`${q.step}:${i}`}>
        <dt>{q.label}{q.required ? " *" : ""}</dt>
        <dd>{q.answerKind === "value" ? q.answer || "Left blank" : q.answerKind === "declined" ? "Decline to self-identify" : q.answerKind === "withheld" ? "Sensitive value withheld; review it on the form." : q.answerKind === "blank" ? "Left blank" : "No saved answer"}</dd>
        <small className="apps-muted">{q.verified ? "Verified" : q.resolution === "needs_review" ? "Needs review" : "Not verified"}</small>
      </div>)}</dl> : <p>No questions are recorded yet.</p>}
    </>)}
  </dialog>;
}
