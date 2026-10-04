import { useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import { postAction, when } from "./engine";
import type { InBrowserApp } from "./reviewQueue";

// Applications open in your browser with Apply with Atriveo (playatriveo `owner: "extension"`). The worker
// never touches them and the backend refuses Approve, Fill and verify, Continue and Retry on them, so the
// dashboard offers only what it accepts: Return to worker (only when the sidecar says it is allowed; the
// reason is shown when not) and Skip. Returning approves nothing.

export const IN_BROWSER_LABEL = "Applying in your browser";

/** Return to worker and Skip for one application open in your browser. */
export function InBrowserActions({ app, onDone }: { app: InBrowserApp; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const run = async (body: object, message: string) => {
    setBusy(true);
    setError(null);
    const res = await postAction(body);
    setBusy(false);
    if (res.ok) onDone(message);
    else setError(res.error ?? "Refused");
  };
  return (
    <div className="ib-actions">
      <button className="apps-btn" disabled={busy || !app.canReturn} title={app.returnBlock ?? "The worker takes it over under its usual rules. Nothing is approved or submitted."}
        onClick={() => void run({ action: "return_to_worker", applicationId: app.id, expectedUpdatedAt: app.updatedAt }, `${app.company} is back with the worker. Nothing was approved.`)}>
        Return to worker
      </button>
      {confirmSkip
        ? <span className="rv-confirm">Skip this job? <button className="apps-btn" disabled={busy} onClick={() => void run({ action: "skip", applicationId: app.id, note: "skipped in the dashboard (was open in your browser)" }, `Skipped ${app.company}.`)}>Skip</button> <button className="apps-link" onClick={() => setConfirmSkip(false)}>Keep</button></span>
        : <button className="apps-link" disabled={busy} onClick={() => setConfirmSkip(true)}>Skip</button>}
      {!app.canReturn && app.returnBlock && <p className="apps-muted ib-why">Return to worker: {app.returnBlock}</p>}
      {error && <p className="apps-error" role="alert">{error}</p>}
    </div>
  );
}

/** One line about where it stands in your browser. */
export function inBrowserSummary(app: InBrowserApp): string {
  const parts = [
    app.takenOverFrom ? "taken over from the worker" : "started in your browser",
    app.startedAt ? when(app.startedAt) : null,
    app.filledAt ? `filled ${when(app.filledAt)}${app.filled != null ? ` (${app.filled} fields)` : ""}` : null,
    app.pending ? `${app.pending} for you to answer on the page` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The Ready page's list of applications open in your browser. */
export function InBrowserSection({ rows, onDone }: { rows: InBrowserApp[]; onDone: (message: string) => void }) {
  if (!rows.length) return null;
  return (
    <section className="rv-approved ib-section" aria-label={IN_BROWSER_LABEL}>
      <h2>{IN_BROWSER_LABEL} <span className="apps-muted">Apply with Atriveo · you review and submit on the page</span></h2>
      <ul className="rv-rows">
        {rows.map((r) => (
          <li key={r.id} className="ib-row" data-id={r.id}>
            <div className="rv-row">
              <CompanyLogo company={r.company} size="sm" />
              <span className="rv-row-id">
                <strong>{r.company}</strong>
                <span>{r.title}</span>
                <small>{inBrowserSummary(r)}</small>
              </span>
              <span className="apps-tag" title="The worker never touches it while it is open in your browser">{IN_BROWSER_LABEL}</span>
            </div>
            <InBrowserActions app={r} onDone={onDone} />
          </li>
        ))}
      </ul>
    </section>
  );
}
