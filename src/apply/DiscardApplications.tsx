import { useState } from "react";
import { getTailorServerBase } from "../utils/tailorServer";

type Target = { id: string; updatedAt: string; company: string; title: string; createdAt: string };
export default function DiscardApplications({ selected, disabled, onDone }: { selected: string[]; disabled?: boolean; onDone: () => Promise<void> }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [more, setMore] = useState(false);
  const request = async (body: object) => {
    const response = await fetch(`${getTailorServerBase()}/applications/action`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard_applications", ...body }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not discard applications");
    return result;
  };
  const preview = async (old: boolean) => {
    setBusy(true); setMessage("");
    try {
      const result = await request({ operation: "preview", ...(old ? { olderThan24Hours: true } : { ids: selected }) });
      setTargets(result.targets); setMore(result.moreAvailable);
      if (!result.targets.length) setMessage("No eligible applications. Active, submitted, and unresolved submission attempts are protected.");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!targets?.length) return;
    setBusy(true);
    try {
      const result = await request({ operation: "confirm", targets: targets.map(({ id, updatedAt }) => ({ id, updatedAt })) });
      setMessage(`${result.discarded.length} applications discarded. History retained.${result.errors.length ? ` ${result.errors.length} could not be discarded: ${result.errors.map((e: { error: string }) => e.error).join("; ")}` : ""}`);
      setTargets(null); await onDone();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="review-discard">
    <button className="apps-btn" disabled={disabled || busy || !selected.length} onClick={() => void preview(false)}>Discard selected ({selected.length})</button>
    <button className="apps-btn" disabled={disabled || busy} onClick={() => void preview(true)}>Clear older than 24 hours</button>
    <span className="apps-muted">Uses creation time. Keeps application history.</span>
    {message && <p role="status">{message}</p>}
    {targets && targets.length > 0 && <div className="apps-drawer-wrap rv-modal-wrap"><div className="apps-scrim" />
      <section className="rv-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title">
        <h2 id="discard-title">Discard {targets.length} applications?</h2>
        <p>These applications will be marked skipped and removed from the review queues. Their answers and history are kept. Nothing will be submitted.</p>
        <p>Includes eligible applications awaiting review or failed applications. Active approvals and previous submission attempts are excluded.</p>
        {more && <p>Showing the first 200. You can clear another batch afterward.</p>}
        <ul className="rv-modal-list">{targets.map(t => <li key={t.id}><strong>{t.company}</strong> — {t.title}</li>)}</ul>
        <div className="rv-actions-row"><button className="apps-btn" disabled={busy} onClick={() => setTargets(null)}>Cancel</button><button className="rv-primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Discarding…" : `Discard ${targets.length} applications`}</button></div>
      </section></div>}
  </div>;
}
