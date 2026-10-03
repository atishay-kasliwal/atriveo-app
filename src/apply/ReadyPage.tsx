import DiscardApplications from "./DiscardApplications";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import ApplicationDetail from "./ApplicationDetail";
import { loadDetail } from "./detail";
import { humanize, postAction, when } from "./engine";
import { adjustCounts, refreshReady, useReadyQueue, type ApprovedApp, type ReadyApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";

// Applications the engine filled completely and checked, waiting only for your approval.
// The list on the left, the selected one's full record on the right, no page scrolling.
// Approving queues one attempt: the worker reopens the form, refills it, checks the answers
// and resume against what you reviewed, and submits; anything different comes back to review.

const IN_FLIGHT = new Set(["READY_TO_APPLY", "APPLYING", "SUBMITTING"]);

function approvedState(a: ApprovedApp): { label: string; tone: "" | "good" | "warn" | "bad"; active: boolean } {
  switch (a.status) {
    case "READY_TO_APPLY": return { label: "Waiting for the worker", tone: "", active: true };
    case "APPLYING": return { label: "Refilling the form", tone: "", active: true };
    case "SUBMITTING": return { label: "Submitting", tone: "", active: true };
    case "APPLIED": return { label: `Submitted${a.submittedAt ? ` ${when(a.submittedAt)}` : ""}`, tone: "good", active: false };
    case "NEEDS_REVIEW": return { label: `Back in review: ${humanize(a.reviewReason ?? "needs review")}`, tone: "warn", active: false };
    case "FAILED": return { label: `Failed: ${humanize(a.failureCode ?? "error")}`, tone: "bad", active: false };
    default: return { label: humanize(a.status), tone: "", active: false };
  }
}

/**
 * Why each ready job is left out of Approve all (one application per company per day).
 * The best match at a company goes first, unless that company already had one today
 * or one of its jobs is approved and on its way.
 */
function holdReasons(ready: ReadyApp[], approved: ApprovedApp[]): Map<string, string> {
  const onItsWay = new Set(approved.filter((a) => IN_FLIGHT.has(a.status)).map((a) => a.companyKey));
  const first = new Set<string | null>();
  const why = new Map<string, string>();
  for (const r of ready) {
    if (r.companySubmittedToday) why.set(r.id, `Already applied to ${r.company} today. Approve it tomorrow.`);
    else if (onItsWay.has(r.companyKey)) why.set(r.id, `A ${r.company} job is already approved today. One application per company per day.`);
    else if (first.has(r.companyKey)) why.set(r.id, `Another ${r.company} job is ahead of it (better match). One application per company per day; this one would wait until tomorrow.`);
    else first.add(r.companyKey);
  }
  return why;
}

export default function ReadyPage({ header }: { header?: React.ReactNode }) {
  const [fast, setFast] = useState(false);
  const [discardSelected, setDiscardSelected] = useState<string[]>([]);
  const { data, error, loading } = useReadyQueue(fast ? 15_000 : 60_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  // Approved here and not yet visible in the server's list.
  const [local, setLocal] = useState<ApprovedApp[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulk, setBulk] = useState<{ total: number; n: number; failed: Array<{ company: string; error: string }> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false); // phones: the record opens over the list

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const ready = useMemo(() => (data?.ready ?? []).filter((r) => !(done[r.id] && done[r.id] >= r.updatedAt)), [data, done]);
  const approved = useMemo(() => {
    const server = data?.approved ?? [];
    const seen = new Set(server.map((a) => a.id));
    return [...local.filter((a) => !seen.has(a.id)), ...server];
  }, [data, local]);
  const inFlight = approved.some((a) => IN_FLIGHT.has(a.status));
  if (inFlight !== fast) setFast(inFlight);

  const held = useMemo(() => holdReasons(ready, approved), [ready, approved]);
  const bulkable = ready.filter((r) => !held.has(r.id));

  const selected = ready.find((r) => r.id === selectedId) ?? ready[0] ?? null;
  const index = selected ? ready.indexOf(selected) : -1;
  const blocked = Boolean(data?.killSwitch && !data.killSwitch.enabled);

  // Fetch the next record while you read this one.
  const next = index >= 0 ? ready[index + 1] : undefined;
  useEffect(() => { if (next) void loadDetail(next.id, next.updatedAt).catch(() => {}); }, [next]);

  const select = (r: ReadyApp | undefined) => {
    if (!r) return;
    setSelectedId(r.id);
    setActionError(null);
    setConfirmSkip(false);
    setShowDetail(true);
  };

  /** Keyboard: ↑/↓ (or k/j) move through the list when you're not typing. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey || confirmAll) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); select(ready[index + 1]); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); select(ready[index - 1]); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const markApproved = (r: ReadyApp) => {
    setDone((d) => ({ ...d, [r.id]: r.updatedAt }));
    setLocal((l) => [{ ...r, status: "READY_TO_APPLY", reviewReason: null, reviewDetail: null, failureCode: null, submittedAt: null, approvedAt: new Date().toISOString() }, ...l]);
    adjustCounts({ ready: -1 });
  };

  const approve = async (r: ReadyApp) => {
    setBusy(true);
    setActionError(null);
    const res = await postAction({ action: "approve_submit", applicationId: r.id, expectedUpdatedAt: r.updatedAt });
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error ?? "Couldn't approve");
      if (/changed since/i.test(res.error ?? "")) void refreshReady();
      return;
    }
    markApproved(r);
    setSelectedId(ready[index + 1]?.id ?? ready[index - 1]?.id ?? null);
    setNotice(`Approved ${r.company}. The worker refills it, checks it again, and submits.`);
    setTimeout(() => void refreshReady(), 1500);
  };

  const skip = async (r: ReadyApp) => {
    setBusy(true);
    setActionError(null);
    const res = await postAction({ action: "skip", applicationId: r.id, note: "skipped on the Ready page" });
    setBusy(false);
    setConfirmSkip(false);
    if (!res.ok) {
      setActionError(res.error ?? "Couldn't skip");
      return;
    }
    setDone((d) => ({ ...d, [r.id]: r.updatedAt }));
    adjustCounts({ ready: -1 });
    setSelectedId(ready[index + 1]?.id ?? ready[index - 1]?.id ?? null);
    setNotice(`Skipped ${r.company}.`);
  };

  const approveAll = async () => {
    const list = bulkable;
    setConfirmAll(false);
    setBusy(true);
    setBulk({ total: list.length, n: 0, failed: [] });
    const failed: Array<{ company: string; error: string }> = [];
    for (const [i, r] of list.entries()) {
      const res = await postAction({ action: "approve_submit", applicationId: r.id, expectedUpdatedAt: r.updatedAt });
      if (res.ok) markApproved(r);
      else failed.push({ company: r.company, error: res.error ?? "Couldn't approve" });
      setBulk({ total: list.length, n: i + 1, failed: [...failed] });
    }
    setBusy(false);
    setNotice(`Approved ${list.length - failed.length} of ${list.length}.${failed.length ? " Some were refused; see the list." : " The worker submits them one by one."}`);
    void refreshReady();
  };

  const heldSelected = selected ? held.get(selected.id) ?? null : null;

  return (
    <div className="rv-page">
      {header}
      <div className="rv-bar">
        <div className="rv-bar-title">
          <h1>Ready to submit</h1>
          {data && <span className="apps-muted">{ready.length} application{ready.length === 1 ? "" : "s"} · every question answered · every check passed</span>}
        </div>
        <div className="rv-bar-actions">
          {data?.worker && !data.worker.online && <span className="apps-state bad" title={`Last seen ${when(data.worker.updatedAt)}`}><i aria-hidden />Worker offline: approvals wait</span>}
          {blocked && <span className="apps-state bad" title={data?.killSwitch?.reason ?? undefined}><i aria-hidden />Submissions blocked{data?.killSwitch?.reason ? `: ${data.killSwitch.reason}` : ""}</span>}
          <button className="apps-refresh" onClick={() => void refreshReady()} disabled={loading}>{loading ? "Refreshing…" : data ? `Updated ${when(data.generatedAt)} ↻` : ""}</button>
          <button className="rv-primary" disabled={!bulkable.length || blocked || busy || Boolean(bulk && bulk.n < bulk.total)} onClick={() => setConfirmAll(true)}>
            {bulk && bulk.n < bulk.total ? `Approving ${bulk.n + 1} of ${bulk.total}…` : `Approve all (${bulkable.length})`}
          </button>
        </div>
      </div>

      <main className="rv-main">
        <DiscardApplications selected={discardSelected} disabled={busy} onDone={async () => { setDiscardSelected([]); await refreshReady(); }} />
        {error && !data && <p className="apps-error">Couldn't load: {error}. The Mac sidecar must be running (npm run tailor:restart).</p>}
        {!data && !error && <p className="apps-muted rv-wait">Loading the applications ready to submit…</p>}
        {data && (
          <div className={`rv-split ${showDetail && selected ? "is-detail" : ""}`}>
            <aside className="rv-list" aria-label="Ready to submit">
              {ready.length === 0 && (
                <div className="rv-empty">
                  <strong>Nothing is waiting for your approval.</strong>
                  {data.counts.unanswered > 0 && <Link to="/unanswered">{data.counts.unanswered} application{data.counts.unanswered === 1 ? " needs" : "s need"} answers →</Link>}
                </div>
              )}
              <ul className="rv-rows">
                {ready.map((r) => {
                  const why = held.get(r.id);
                  return (
                    <li key={r.id}>
                      <label className="discard-select"><input type="checkbox" checked={discardSelected.includes(r.id)} disabled={busy} onChange={e => setDiscardSelected(ids => e.target.checked ? [...ids, r.id].slice(0, 200) : ids.filter(id => id !== r.id))} /> Select {r.company}</label>
                      <button className={`rv-row ${selected?.id === r.id ? "is-on" : ""}`} onClick={() => select(r)} aria-current={selected?.id === r.id}>
                        <CompanyLogo company={r.company} size="sm" />
                        <span className="rv-row-id">
                          <strong>{r.company}</strong>
                          <span>{r.title}</span>
                          <small>{r.answered} answers · filled {when(r.filledAt)}{r.priority ? ` · match ${r.priority}` : ""}</small>
                        </span>
                        {why && <span className="apps-tag warn" title={why}>{r.companySubmittedToday ? "Tomorrow" : "Not first"}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {(approved.length > 0 || (bulk?.failed.length ?? 0) > 0) && (
                <section className="rv-approved" aria-label="Approved">
                  <h2>Approved {inFlight && <span className="apps-pulse" aria-hidden />}</h2>
                  <ul>
                    {bulk?.failed.map((f) => <li key={`f-${f.company}`}><strong>{f.company}</strong><span className="apps-tag bad" title={f.error}>Refused: {f.error}</span></li>)}
                    {approved.map((a) => {
                      const st = approvedState(a);
                      return (
                        <li key={a.id} title={a.reviewDetail ?? undefined}>
                          <strong>{a.company}</strong>
                          <span className={`apps-tag ${st.tone} ${st.active ? "active" : ""}`}>{st.active && <span className="apps-pulse" aria-hidden />}{st.tone === "good" ? "✓ " : ""}{st.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </aside>

            {selected && (
              <section className="rv-detail" aria-label={`${selected.company}: review`}>
                <div className="rv-detail-head">
                  <button className="apps-link rv-back" onClick={() => setShowDetail(false)}>‹ All ready</button>
                  <CompanyLogo company={selected.company} size="md" />
                  <div className="apps-drawer-title">
                    <strong>{selected.company}</strong>
                    <span>{selected.title}{selected.location ? ` · ${selected.location}` : ""}{selected.ats ? ` · ${selected.ats}` : ""}</span>
                  </div>
                  <a className="apps-link" href={selected.url} target="_blank" rel="noreferrer">Open form ↗</a>
                </div>
                <div className="rv-detail-body apps-full-body">
                  <ApplicationDetail key={selected.id} id={selected.id} version={selected.updatedAt} />
                </div>
                <div className="rv-actions">
                  {actionError && <p className="apps-q-note warn" role="alert">{actionError}</p>}
                  {heldSelected && <p className="apps-q-note warn">{heldSelected}</p>}
                  <div className="rv-actions-row">
                    <button className="rv-primary" disabled={busy || blocked || Boolean(heldSelected)} onClick={() => void approve(selected)}>
                      {busy ? "Working…" : "Approve and submit"}
                    </button>
                    {confirmSkip
                      ? <span className="rv-confirm">Skip this job? <button className="apps-btn" onClick={() => void skip(selected)} disabled={busy}>Skip</button> <button className="apps-link" onClick={() => setConfirmSkip(false)}>Keep</button></span>
                      : <button className="apps-btn" onClick={() => setConfirmSkip(true)} disabled={busy}>Skip job</button>}
                    <span className="rv-nav">
                      <button className="apps-btn" onClick={() => select(ready[index - 1])} disabled={index <= 0} aria-label="Previous">‹</button>
                      <span className="apps-muted">{index + 1} of {ready.length}</span>
                      <button className="apps-btn" onClick={() => select(ready[index + 1])} disabled={index >= ready.length - 1} aria-label="Next">›</button>
                    </span>
                  </div>
                  <p className="apps-muted rv-how">The worker reopens the form, refills it, checks the answers and resume against what you see here, then submits. Anything different comes back to you.</p>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {confirmAll && (
        <div className="apps-drawer-wrap rv-modal-wrap">
          <div className="apps-scrim" onClick={() => setConfirmAll(false)} />
          <div className="rv-modal" role="dialog" aria-modal="true" aria-labelledby="rv-all-title">
            <h2 id="rv-all-title">Approve and submit {bulkable.length} application{bulkable.length === 1 ? "" : "s"}?</h2>
            <p className="apps-muted">Each one is refilled and checked again before Submit; anything that changed comes back to you. Submitted applications can't be taken back.</p>
            <ul className="rv-modal-list">
              {bulkable.map((r) => <li key={r.id}><strong>{r.company}</strong> <span className="apps-muted">{r.title}</span></li>)}
            </ul>
            {ready.length > bulkable.length && (
              <>
                <h3>Not included</h3>
                <ul className="rv-modal-list">
                  {ready.filter((r) => held.has(r.id)).map((r) => <li key={r.id}><strong>{r.company}</strong> <span className="apps-muted">{held.get(r.id)}</span></li>)}
                </ul>
              </>
            )}
            <div className="rv-actions-row">
              <button className="rv-primary" onClick={() => void approveAll()}>Approve and submit {bulkable.length}</button>
              <button className="apps-btn" onClick={() => setConfirmAll(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {notice && <p className="apps-toast" role="status">{notice}</p>}
    </div>
  );
}
