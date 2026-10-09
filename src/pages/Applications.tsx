import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ApplyHeatmap from "../components/ApplyHeatmap";
import { IN_BROWSER_LABEL, InBrowserActions, inBrowserSummary } from "../apply/InBrowser";
import type { InBrowserApp } from "../apply/reviewQueue";
import { Link } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import ApplicationDetail from "../apply/ApplicationDetail";
import QuestionField from "../apply/QuestionField";
import { answerFor, defaultScope, humanize, postAction, questionKind, when, type PendingQ, type Scope } from "../apply/engine";
import { getTailorServerBase } from "../utils/tailorServer";
import "../styles/applications.css";
import "../styles/insights.css";

// Application engine analytics (playatriveo): history, outcomes and what needs you.
// Data: GET /tailor/applications/analytics → Mac sidecar → Mongo (read-only).

type Status = "READY_TO_APPLY" | "APPLYING" | "NEEDS_REVIEW" | "SUBMITTING" | "APPLIED" | "FAILED" | "SKIPPED";

interface Day { day: string; queued: number; applied: number; needsReview: number; failed: number; skipped: number }
interface HistoryRow {
  questions: PendingQ[]; submitAttempted: boolean;
  id: string; company: string; title: string; location: string | null; ats: string | null; status: Status;
  reviewReason: string | null; reviewDetail: string | null; pendingCount: number; failureCode: string | null; failureMessage: string | null;
  questionReviewStatus?: "open" | "complete" | null;
  submittedBy: string | null; submittedAt: string | null; attempts: number; domain: string | null; url: string; createdAt: string; updatedAt: string;
  /** What the employer's mail said after you applied (inbox watcher). */
  outcome?: { status: "confirmed" | "rejected"; at: string | null; subject: string | null } | null;
  priority?: number;
  /** "extension": open in your browser (Apply with Atriveo); only Return to worker and Skip apply. */
  owner?: "engine" | "extension";
  inBrowser?: InBrowserApp;
}
interface Analytics {
  ok: boolean;
  generatedAt: string;
  kpis: { total: number; applied: number; needsReview: number; failed: number; skipped: number; inProgress: number; successRate: number | null };
  funnel: Array<{ stage: string; n: number }>;
  daily: Day[];
  byAts: Array<{ ats: string; total: number; APPLIED: number; NEEDS_REVIEW: number; FAILED: number; SKIPPED: number; other: number }>;
  reviewReasons: Array<{ reason: string; n: number }>;
  failureCodes: Array<{ code: string; n: number }>;
  topPendingQuestions: Array<{ label: string; n: number; reason: string }>;
  formTrust: Record<string, number>;
  killSwitch: { enabled: boolean; reason: string | null; updatedAt: string; updatedBy: string } | null;
  discovery: { boards: Array<{ ats: string; boards: number; polled: number; withMatches: number }>; jobsBySite: Array<{ site: string; n: number }> };
  /** The first rows of "Needs your attention"; attentionTotal counts them all (the rest load on "View all"). */
  attention: HistoryRow[];
  attentionTotal: number;
  /** LinkedIn postings (never applied by the engine): marked applied (all, today) and waiting on Today. */
  linkedin?: { applied: number; appliedToday: number; waiting: number | null };
  /** Totals for the chosen date range (the Stats tiles). */
  range?: { from: string; to: string; days: number; discovered: number; matched: number; queued: number; applied: number; needsReview: number; failed: number; skipped: number; linkedinApplied: number };
  queue: HistoryRow[];
  accounts?: AccountRow[];
  byStatus?: Record<string, number>;
  current?: CurrentRow | null;
  lastActivityAt?: string | null;
  lastAt?: { discovered: string | null; matched: string | null; queued: string | null; applied: string | null; needsReview: string | null; failed: string | null; avgApplyMs: number | null };
  worker?: { online: boolean; host: string | null; concurrency: number | null; gmailConnected: boolean; accountsEmail: string | null; updatedAt: string } | null;
  inbox?: InboxSummary;
  queueReport?: QueueReport | null;
}
interface CurrentRow {
  id: string; company: string; title: string; ats: string | null; status: "APPLYING" | "SUBMITTING";
  step: string | null; attempt: number | null; startedAt: string | null; updatedAt: string; url: string;
}
interface AccountRow {
  id: string; ats: string; tenant: string; email: string; password: string;
  status: "created" | "verify_email" | "signed_in"; loginUrl: string | null; createdAt: string; updatedAt: string;
}

// Outcome series use the fixed status palette, always paired with an icon + label.
const OUTCOMES = [
  { key: "applied", label: "Applied", icon: "✓", cls: "st-good" },
  { key: "needsReview", label: "Needs review", icon: "!", cls: "st-warning" },
  { key: "failed", label: "Failed", icon: "✕", cls: "st-critical" },
  { key: "skipped", label: "Skipped", icon: "–", cls: "st-neutral" },
] as const;

const STATUS_META: Record<Status, { label: string; icon: string; cls: string }> = {
  APPLIED: { label: "Applied", icon: "✓", cls: "st-good" },
  NEEDS_REVIEW: { label: "Needs review", icon: "!", cls: "st-warning" },
  FAILED: { label: "Failed", icon: "✕", cls: "st-critical" },
  SKIPPED: { label: "Skipped", icon: "–", cls: "st-neutral" },
  READY_TO_APPLY: { label: "Queued", icon: "…", cls: "st-neutral" },
  APPLYING: { label: "Applying", icon: "…", cls: "st-neutral" },
  SUBMITTING: { label: "Submitting", icon: "…", cls: "st-serious" },
};

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { ...(new Date(iso).toDateString() === new Date().toDateString() ? {} : { month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit" }) : null);

interface InboxMail { id: string; at: string; kind: "applied" | "rejected"; subject: string; company: string | null; title: string | null }
interface InboxSummary {
  days: number;
  confirmed: number;
  rejected: number;
  recent: Array<InboxMail & { recordedIn: Array<"engine" | "tracker" | "feed">; note: string | null }>;
  confirm: Array<InboxMail & { target: "tracker" | "engine"; reason: string; candidates: Array<{ id: string; label: string }> }>;
}
interface QueueReport {
  generatedAt: string;
  autoQueue: boolean;
  resumeReady: number;
  reasons: Array<{ code: string; label: string; n: number; examples: Array<{ company: string; title: string }> }>;
  queued: number;
  waitingForCompanySlot: number;
  /** Jobs on sites the engine can't fill, best score first (engines from before Oct 2026 omit it). */
  youApply?: Array<{ company: string; title: string; applyUrl: string; score: number | null; site: string }>;
}

const RECORDED_IN = { engine: "engine", tracker: "tracker", feed: "job feed" } as const;

function OutcomePill({ outcome }: { outcome: HistoryRow["outcome"] }) {
  if (!outcome) return null;
  const rejected = outcome.status === "rejected";
  return (
    <span className={`apps-pill ${rejected ? "st-critical" : "st-good"}`} title={outcome.subject ? `From: "${outcome.subject}"` : undefined}>
      <span aria-hidden>{rejected ? "✕" : "✓"}</span> {rejected ? "Rejected" : "Confirmed"}
    </span>
  );
}

function InboxConfirmItem({ item, onDone }: { item: InboxSummary["confirm"][number]; onDone: (message: string) => void }) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: object, ok: string) => {
    setBusy(true); setError(null);
    try {
      const result = await postAction(body);
      if (result.ok) onDone(ok);
      else setError(result.error ?? "Couldn't save. Please try again.");
    } catch { setError("Couldn't connect. Please try again."); }
    finally { setBusy(false); }
  };
  return <article className="ins-mail-review" aria-busy={busy}>
    <div className="ins-mail-heading"><CompanyLogo company={item.company} size="md" /><div><h3>{item.company ?? "Unknown company"}</h3><p>{item.title || "Role not named in this email"}</p></div><span className={`apps-tag ${item.kind === "rejected" ? "bad" : "good"}`}>{item.kind === "rejected" ? "Rejection" : "Receipt"}</span></div>
    <div className="ins-mail-subject"><span className="ins-label">Email received · {when(item.at)}</span><p>{item.subject}</p></div>
    <p className="ins-mail-help">We couldn't confidently match this email to an application. Choose the correct application below.</p>
    <details className="ins-explanation"><summary>Why does this need review?</summary><p>{item.reason}</p></details>
    <label className="ins-match-label">Match to an application
      <select className="apps-select" value={pick} disabled={busy} onChange={e => setPick(e.target.value)}>
        <option value="">Choose an application…</option>
        {item.candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </label>
    {!item.candidates.length && <p className="apps-muted">No matching applications are available yet.</p>}
    {error && <p className="apps-error" role="alert">{error}</p>}
    <div className="ins-mail-actions"><button className="apps-btn accent" disabled={!pick || busy} onClick={() => void run({ action: "inbox_confirm", mailId: item.id, target: item.target, id: pick }, item.kind === "rejected" ? "Marked rejected." : "Email linked.")}>{busy ? "Saving…" : item.kind === "rejected" ? "Confirm rejection" : "Link application"}</button><button className="apps-btn" disabled={busy} onClick={() => void run({ action: "inbox_dismiss", mailId: item.id }, "Email dismissed.")}>Not one of mine</button></div>
  </article>;
}

function EmployerResponses({ inbox, onDone }: { inbox: InboxSummary; onDone: (message: string) => void }) {
  const [mode, setMode] = useState<"review" | "recent">(inbox.confirm.length ? "review" : "recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const waiting = inbox.confirm.filter(m => !resolved.includes(`${m.target}:${m.id}`));
  const selected = waiting.find(m => `${m.target}:${m.id}` === selectedId) ?? waiting[0];
  const index = selected ? waiting.indexOf(selected) : 0;
  const recentPage = Math.min(page, Math.max(0, Math.ceil(inbox.recent.length / 6) - 1));
  return <section className="ins-responses">
    <div className="ins-view-heading"><div><h2>Employer responses</h2><p>Application receipts and rejections · last {inbox.days} days</p></div><div className="ins-response-counts"><span><b>{inbox.confirmed}</b> receipts</span><span><b>{inbox.rejected}</b> rejections</span></div></div>
    <div className="ins-switch" role="group" aria-label="Employer response view"><button aria-pressed={mode === "review"} onClick={() => setMode("review")}>Needs a match <span>{waiting.length}</span></button><button aria-pressed={mode === "recent"} onClick={() => setMode("recent")}>Recent emails <span>{inbox.recent.length}</span></button></div>
    {mode === "review" ? selected ? <div className="ins-review-layout">
      <aside className="ins-review-context"><span className="ins-label">One email at a time</span><h3>Keep your results up to date.</h3><p>Link each response to the right role. Your application history will reflect the result.</p><div className="ins-pagination"><button className="apps-btn" aria-label="Previous email" disabled={index === 0} onClick={() => setSelectedId(`${waiting[index - 1].target}:${waiting[index - 1].id}`)}>←</button><span>{index + 1} of {waiting.length}</span><button className="apps-btn" aria-label="Next email" disabled={index >= waiting.length - 1} onClick={() => setSelectedId(`${waiting[index + 1].target}:${waiting[index + 1].id}`)}>→</button></div></aside>
      <InboxConfirmItem key={`${selected.target}:${selected.id}`} item={selected} onDone={message => { setResolved(ids => [...ids, `${selected.target}:${selected.id}`]); onDone(message); }} />
    </div> : <div className="ins-empty"><h3>You're all caught up.</h3><p>No emails need matching.</p><button className="apps-btn" onClick={() => setMode("recent")}>View recent emails</button></div> : <>
      <ul className="ins-response-list">{inbox.recent.slice(recentPage * 6, recentPage * 6 + 6).map(m => <li key={m.id}><CompanyLogo company={m.company} size="sm" /><div className="ins-response-id"><strong>{m.company ?? "Unknown company"}</strong><span>{m.title ?? "Role not named"}</span><details><summary>Email details</summary><p>{m.subject}</p><p>{m.recordedIn.length ? `Recorded in ${m.recordedIn.map(w => RECORDED_IN[w]).join(", ")}` : "Not yet matched"}</p></details></div><span className={`apps-tag ${m.kind === "rejected" ? "bad" : "good"}`}>{m.kind === "rejected" ? "Rejected" : "Receipt"}</span><time>{when(m.at)}</time></li>)}</ul>
      {!inbox.recent.length && <div className="ins-empty">No employer emails in this period.</div>}
      {inbox.recent.length > 6 && <div className="ins-pagination"><button className="apps-btn" disabled={recentPage === 0} onClick={() => setPage(recentPage - 1)}>Previous</button><span>Page {recentPage + 1} of {Math.ceil(inbox.recent.length / 6)}</span><button className="apps-btn" disabled={(recentPage + 1) * 6 >= inbox.recent.length} onClick={() => setPage(recentPage + 1)}>Next</button></div>}
    </>}
  </section>;
}

function QueueReasons({ report }: { report: QueueReport }) {
  return <>
    <div className="apps-simple-metrics"><div><b>{report.resumeReady}</b><span>Resumes ready</span></div><div><b>{report.queued}</b><span>In the queue</span></div><div><b>{report.autoQueue ? "On" : "Off"}</b><span>Automatic queue</span></div></div>
    <h3>What’s holding jobs back?</h3>
    <BarList rows={report.reasons.map(r => ({ label: r.label, n: r.n }))} empty="No blockers." />
    <details className="apps-more-details"><summary>See examples and timing</summary><p className="apps-muted">Updated {when(report.generatedAt)}{report.waitingForCompanySlot ? ` · ${report.waitingForCompanySlot} waiting for a company’s daily slot` : ""}</p>{report.reasons.map(r => <p key={r.code}><strong>{r.label}</strong><br /><span className="apps-muted">{r.examples.map(e => `${e.company} · ${e.title}`).join("; ") || "No examples"}</span></p>)}</details>
    {report.youApply && report.youApply.length > 0 && <details className="apps-more-details"><summary>Jobs you can apply to yourself ({report.youApply.length})</summary><YouApplyPile jobs={report.youApply} /></details>}
  </>;
}

/** Jobs whose site the engine can't fill: you apply, with the tailored resume already made. */
function YouApplyPile({ jobs }: { jobs: NonNullable<QueueReport["youApply"]> }) {
  return (
    <>
      <h3 className="apps-subhead">You apply ({jobs.length}{jobs.length >= 50 ? ", best first" : ""})</h3>
      <p className="apps-muted">Company career sites and platforms the engine can't fill. Your tailored resume is ready for each.</p>
      <ul className="apps-inbox-list">
        {jobs.map((j) => (
          <li key={j.applyUrl} className="apps-inbox-item">
            <div className="apps-cards-top">
              <div className="apps-cards-id"><strong>{j.company}</strong><span>{j.title}</span></div>
              <a className="apps-btn-link" href={j.applyUrl} target="_blank" rel="noreferrer">Apply ↗</a>
            </div>
            <div className="apps-muted">{j.site}{j.score !== null ? ` · score ${Math.round(j.score)}` : ""}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? { label: status, icon: "·", cls: "st-neutral" };
  return <span className={`apps-pill ${m.cls}`}><span aria-hidden>{m.icon}</span> {m.label}</span>;
}

function BarList({ rows, empty }: { rows: Array<{ label: string; n: number }>; empty: string }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="apps-empty">{empty}</p>;
  return (
    <> <ul className="apps-barlist">
      {visible.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.n}`}>
          <span className="apps-barlist-label">{r.label}</span>
          <span className="apps-barlist-track"><span className="apps-barlist-fill" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="apps-barlist-n">{r.n}</span>
        </li>
      ))}
    </ul>{sorted.length > 5 && <button className="apps-link" onClick={() => setExpanded(v => !v)}>{expanded ? "Show fewer" : `Show all ${sorted.length}`}</button>}</>
  );
}

/** Answer pending questions, or decide on an application, without the terminal. */
function ReviewPanel({ row, onDone }: { row: HistoryRow; onDone: (msg: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, Scope>>(() => Object.fromEntries(row.questions.map((q) => [q.fingerprint, defaultScope(q, row.company)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (body: object, success: string) => {
    setBusy(true);
    setError(null);
    const r = await postAction(body);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Failed");
    else onDone(success);
  };

  if (row.submitAttempted) {
    return (
      <div className="apps-review">
        {emailStepOf(row) === "code" ? (
          <div className="apps-note">
            <p><strong>Greenhouse asked for an emailed security code.</strong> {row.reviewDetail}</p>
            <p>If Gmail is connected the engine normally reads the code and finishes by itself. This one did not get it in time. Check your inbox for a “thank you for applying” email: if it is there, choose “It went through”. If not, choose “It did not go through, retry”, and a fresh code is requested on the next attempt.</p>
          </div>
        ) : (
          <p>Submit was already clicked for this application, so it is never retried automatically. Did it go through? Check your email for a confirmation.</p>
        )}
        <div className="apps-review-actions">
          <button disabled={busy} onClick={() => run({ action: "mark_applied", applicationId: row.id }, "Marked as applied.")}>✓ It went through</button>
          <button disabled={busy} onClick={() => run({ action: "not_submitted", applicationId: row.id }, "Queued again.")}>It did not go through, retry</button>
        </div>
        {error && <p className="apps-error">{error}</p>}
      </div>
    );
  }

  const answers = row.questions
    .filter((q) => questionKind(q) !== "file" && !q.openEndedAssessment?.questionFamily && values[q.fingerprint]?.trim())
    .map((q) => answerFor(q, values[q.fingerprint]!.trim(), scopes[q.fingerprint] ?? defaultScope(q, row.company)));
  const canApproveSubmit = row.status === "NEEDS_REVIEW" && row.reviewReason === "SUBMIT_APPROVAL" && row.questions.length === 0;

  return (
    <div className="apps-review">
      {row.questions.length === 0 && (
        <div className="apps-note">
          {canApproveSubmit ? (
            <p><strong>Ready for your decision.</strong> Approve to have the worker reopen the form, refill it, check it again, and submit. If anything changed, it returns to review.</p>
          ) : (
            <p><strong>Needs your attention.</strong> {row.reviewDetail ?? "The engine stopped on a rule."}</p>
          )}
        </div>
      )}
      {row.questions.filter((q) => !q.openEndedAssessment?.questionFamily).map((q) => (
        <QuestionField key={q.fingerprint} q={q} appId={row.id} company={row.company}
          value={values[q.fingerprint] ?? ""} onValue={(v) => setValues((cur) => ({ ...cur, [q.fingerprint]: v }))}
          scope={scopes[q.fingerprint] ?? defaultScope(q, row.company)} onScope={(sc) => setScopes((cur) => ({ ...cur, [q.fingerprint]: sc }))} />
      ))}
      <div className="apps-review-actions">
        {(row.questions.some((q) => q.openEndedAssessment?.questionFamily) || row.questionReviewStatus === "complete") && <Link className="apps-btn-link" to="/answers">Review story answers and continue →</Link>}
        {canApproveSubmit && (
          <button className="primary" disabled={busy} onClick={() => run({ action: "approve_submit", applicationId: row.id, expectedUpdatedAt: row.updatedAt }, "Approval queued. The worker will refill, validate, and submit if nothing changed.")}>Approve and submit</button>
        )}
        {row.questions.length > 0 && <button className="primary" disabled={busy || !answers.length} onClick={() => run({ action: "answer", applicationId: row.id, answers }, `Saved ${answers.length} answer(s). The engine will refill this application under the current review settings.`)}>
          Save answers & continue
        </button>}
        {row.questions.length === 0 && (
          <a className="apps-btn-link" href={row.url} target="_blank" rel="noreferrer">Open the form ↗</a>
        )}
        {row.questions.length === 0 && (
          <button disabled={busy} onClick={() => run({ action: "mark_applied", applicationId: row.id, note: "submitted by you on the employer site" }, "Marked as applied.")}>I submitted it myself</button>
        )}
        <button disabled={busy} onClick={() => run({ action: "retry", applicationId: row.id }, "Queued again.")}>Retry without changes</button>
        <button disabled={busy} onClick={() => run({ action: "skip", applicationId: row.id }, "Skipped.")}>Skip this job</button>
      </div>
      {error && <p className="apps-error">{error}</p>}
    </div>
  );
}

const ACCOUNT_STATUS: Record<AccountRow["status"], { label: string; icon: string; cls: string }> = {
  signed_in: { label: "Signed in", icon: "✓", cls: "st-good" },
  verify_email: { label: "Verify email", icon: "!", cls: "st-warning" },
  created: { label: "Created", icon: "…", cls: "st-neutral" },
};

/** Portal accounts the engine created. The password stays masked until you reveal or copy it. */
function AccountsCard({ accounts }: { accounts: AccountRow[] }) {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    }).catch(() => {});
  };
  const needsVerify = accounts.filter((a) => a.status === "verify_email").length;
  return (
    <div>
      <div className="apps-card-head">
        <h3>Your employer logins</h3>
        {needsVerify > 0 && <span className="apps-pill st-warning">{needsVerify} need email verification</span>}
      </div>
      <ul className="apps-cards apps-only-narrow">
        {accounts.map((a) => {
          const m = ACCOUNT_STATUS[a.status] ?? ACCOUNT_STATUS.created;
          return (
            <li key={a.id}>
              <div className="apps-cards-top">
                <div className="apps-cards-id"><strong>{a.tenant}</strong><span>{a.email}</span></div>
                <span className={`apps-pill ${m.cls}`}><span aria-hidden>{m.icon}</span> {m.label}</span>
              </div>
              <div className="apps-secret"><code>{shown[a.id] ? a.password : "••••••••••••"}</code></div>
              <div className="apps-cards-actions">
                <button className="apps-btn" onClick={() => setShown({ ...shown, [a.id]: !shown[a.id] })}>{shown[a.id] ? "Hide" : "Show"}</button>
                <button className="apps-btn" onClick={() => copy(a.id, a.password)}>{copied === a.id ? "Copied" : "Copy"}</button>
                {a.loginUrl && <a className="apps-btn" href={a.loginUrl} target="_blank" rel="noreferrer">Open</a>}
              </div>
            </li>
          );
        })}
      </ul>
      <details className="apps-more-details apps-full-table"><summary>View full table</summary><div className="apps-table-wrap apps-only-wide"><table className="apps-table">
        <thead><tr><th>Employer</th><th>Email</th><th>Password</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{accounts.map((a) => {
          const m = ACCOUNT_STATUS[a.status] ?? ACCOUNT_STATUS.created;
          return (
            <tr key={a.id}>
              <td>{a.tenant} <span className="apps-chip">{a.ats}</span></td>
              <td>{a.email}</td>
              <td className="apps-secret">
                <code>{shown[a.id] ? a.password : "••••••••••••"}</code>
                <button className="apps-link" onClick={() => setShown({ ...shown, [a.id]: !shown[a.id] })}>{shown[a.id] ? "Hide" : "Show"}</button>
                <button className="apps-link" onClick={() => copy(a.id, a.password)}>{copied === a.id ? "Copied" : "Copy"}</button>
              </td>
              <td><span className={`apps-pill ${m.cls}`}><span aria-hidden>{m.icon}</span> {m.label}</span></td>
              <td>{when(a.createdAt)}</td>
              <td>{a.loginUrl && <a href={a.loginUrl} target="_blank" rel="noreferrer">Open</a>}</td>
            </tr>
          );
        })}</tbody>
      </table></div></details>
    </div>
  );
}

function DailyChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<Day | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.applied + d.needsReview + d.failed + d.skipped));
  const W = 720, H = 110, pad = 24, gap = 2;
  const bw = Math.max(4, (W - pad) / days.length - 4);
  return (
    <div className="apps-chartbox">
      <div className="apps-card-head">
        <h3>Outcomes per day</h3>
        <div className="apps-legend">
          {OUTCOMES.map((o) => <span key={o.key}><i className={o.cls} /> {o.icon} {o.label}</span>)}
          <button className="apps-link" onClick={() => setAsTable((v) => !v)}>{asTable ? "Show chart" : "Show table"}</button>
        </div>
      </div>
      {asTable ? (
        <div className="apps-table-wrap"><table className="apps-table"><thead><tr><th>Day</th><th>Queued</th>{OUTCOMES.map((o) => <th key={o.key}>{o.label}</th>)}</tr></thead>
          <tbody>{days.filter((d) => d.queued || d.applied || d.needsReview || d.failed || d.skipped).map((d) => (
            <tr key={d.day}><td>{d.day}</td><td>{d.queued}</td>{OUTCOMES.map((o) => <td key={o.key}>{d[o.key]}</td>)}</tr>
          ))}</tbody></table></div>
      ) : (
        <div className="apps-chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Application outcomes per day">
            <line x1={pad} x2={W} y1={H} y2={H} className="apps-axis" />
            <text x={0} y={10} className="apps-tick">{max}</text>
            <text x={0} y={H} className="apps-tick">0</text>
            {days.map((d, i) => {
              const x = pad + i * ((W - pad) / days.length) + 2;
              let y = H;
              const segs = OUTCOMES.map((o) => ({ ...o, v: d[o.key] })).filter((s) => s.v > 0);
              return (
                <g key={d.day} onMouseEnter={() => setHover(d)}>
                  <rect x={x - 2} y={0} width={bw + 4} height={H} fill="transparent" />
                  {segs.map((s, si) => {
                    const h = Math.max(2, (s.v / max) * (H - 8));
                    y -= h;
                    const top = si === segs.length - 1;
                    const r = <rect key={s.key} x={x} y={y} width={bw} height={Math.max(1, h - (si ? gap : 0))} rx={top ? 3 : 0} className={`apps-seg ${s.cls}`} />;
                    return r;
                  })}
                  {i % Math.ceil(days.length / 8) === 0 && <text x={x} y={H + 14} className="apps-tick">{d.day.slice(5)}</text>}
                </g>
              );
            })}
          </svg>
          {hover && (
            <div className="apps-tooltip">
              <strong>{hover.day}</strong>
              <span>Queued: {hover.queued}</span>
              {OUTCOMES.map((o) => <span key={o.key}><i className={o.cls} /> {o.label}: {hover[o.key]}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


const REASON_LABEL: Record<string, string> = {
  BOT_CHALLENGE: "Bot challenge", CAPTCHA: "CAPTCHA", LOGIN_REQUIRED: "Sign-in needed", MFA_OR_EMAIL_CODE: "Email verification",
  SENSITIVE_QUESTION: "Sensitive question", SUBMIT_APPROVAL: "Approve submit", UNCERTAIN_SUBMISSION: "Confirm submission",
  VALIDATION_FAILED: "Validation failed",
};
/** Which email step the engine stopped on, from the engine's own message. */
function emailStepOf(h: Pick<HistoryRow, "reviewReason" | "reviewDetail">): "code" | "verify" | null {
  if (h.reviewReason !== "MFA_OR_EMAIL_CODE") return null;
  return /security code/i.test(h.reviewDetail ?? "") ? "code" : "verify";
}

/** The engine's live sub-step while it handles an email code, in plain words. */
function stepLabel(step: string | null): string | null {
  if (!step) return null;
  if (step.startsWith("security code · waiting")) return "Waiting for the security code in Gmail";
  if (step.startsWith("security code · entering")) return "Entering the security code";
  return step;
}

function reasonOf(h: HistoryRow): { label: string; tone: "warn" | "bad" } {
  if (h.owner === "extension" && h.status === "NEEDS_REVIEW") return { label: IN_BROWSER_LABEL, tone: "warn" };
  if (h.status === "FAILED") return { label: humanize(h.failureCode ?? "failed"), tone: "bad" };
  const email = emailStepOf(h);
  if (email === "code") return { label: "Security code not entered", tone: "warn" };
  if (email === "verify") return { label: "Verify email", tone: "warn" };
  if (h.submitAttempted) return { label: "Confirm submission", tone: "warn" };
  if (h.reviewReason === "UNKNOWN_QUESTION" || h.reviewReason === "SENSITIVE_QUESTION") {
    const n = h.pendingCount;
    if (h.reviewReason === "UNKNOWN_QUESTION" && n) return { label: `${n} unanswered question${n === 1 ? "" : "s"}`, tone: "warn" };
    if (n > 1) return { label: `${n} sensitive questions`, tone: "warn" };
  }
  return { label: REASON_LABEL[h.reviewReason ?? ""] ?? humanize(h.reviewReason ?? "needs review"), tone: "warn" };
}

/** One application's single view (ApplicationDetail) as a large panel on desktop and a full-screen sheet on phones. */
function HistoryDrawer({ row, onClose }: { row: HistoryRow; onClose: () => void }) {
  useBodyLock();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pdf-modal-overlay")) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="apps-drawer-wrap apps-full-wrap">
      <div className="apps-scrim" onClick={onClose} />
      <div className="apps-full" role="dialog" aria-modal="true" aria-label={`Application details for ${row.company}`} tabIndex={-1} ref={ref}>
        <span className="apps-handle" aria-hidden />
        <div className="apps-drawer-head">
          <CompanyLogo company={row.company} size="md" />
          <div className="apps-drawer-title"><strong>{row.company}</strong><span>{row.title}{row.ats ? ` · ${row.ats}` : ""}</span></div>
          <StatusPill status={row.status} />
          <a className="apps-link apps-full-open" href={row.url} target="_blank" rel="noreferrer">Open application ↗</a>
          <button className="apps-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="apps-full-body">
          <ApplicationDetail id={row.id} version={row.updatedAt} />
        </div>
      </div>
    </div>
  );
}

/** One line about what happened to an application, shared by the table and the phone cards. */
function detailOf(h: HistoryRow): string {
  if (h.owner === "extension" && h.status === "NEEDS_REVIEW") return h.inBrowser ? `${IN_BROWSER_LABEL} · ${inBrowserSummary(h.inBrowser)}` : IN_BROWSER_LABEL;
  if (h.status === "NEEDS_REVIEW") return `${humanize(h.reviewReason ?? "")}${h.pendingCount ? ` · ${h.pendingCount} question(s)` : ""}`;
  if (h.status === "FAILED") return `${humanize(h.failureCode ?? "")}${h.failureMessage ? ` — ${h.failureMessage}` : ""}`;
  if (h.status === "APPLIED") return `by ${h.submittedBy ?? "engine"} · ${when(h.submittedAt)}`;
  return "";
}

/** Stops the page behind a sheet from scrolling while it is open. */
function useBodyLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
}

function Section({ title, hint, meta, children }: { title: string; hint: string; meta?: React.ReactNode; children: React.ReactNode }) {
  const labels: Record<string, string> = { "Questions & learned answers": "Questions", "ATS performance": "Platforms" };
  return <section className="ins-panel"><div className="ins-view-heading"><div><h2>{labels[title] || title}</h2><p>{hint}</p></div><div className="ins-panel-meta">{meta}</div></div><div className="ins-panel-body">{children}</div></section>;
}

function ReviewDrawer({ row, onClose, onDone }: { row: HistoryRow; onClose: () => void; onDone: (msg: string) => void }) {
  useBodyLock();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const reason = reasonOf(row);
  // History rows are light; this application's pending questions load when you open it.
  const inBrowser = row.owner === "extension" ? row.inBrowser ?? null : null;
  const [questions, setQuestions] = useState<PendingQ[] | null>(row.pendingCount && !inBrowser ? null : []);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!row.pendingCount || inBrowser) return;
    let live = true;
    fetch(`${getTailorServerBase()}/applications/review-queue?view=cards&ids=${encodeURIComponent(row.id)}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (live) { if (j.ok === false) setLoadError(j.error ?? "Couldn't load the questions"); else setQuestions(j.cards?.[0]?.questions ?? []); } })
      .catch((e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [row.id, row.pendingCount]);
  return (
    <div className="apps-drawer-wrap">
      <div className="apps-scrim" onClick={onClose} />
      <aside className="apps-drawer" role="dialog" aria-modal="true" aria-label={`Review ${row.company}`} tabIndex={-1} ref={ref}>
        <span className="apps-handle" aria-hidden />
        <div className="apps-drawer-head">
          <CompanyLogo company={row.company} size="md" />
          <div className="apps-drawer-title">
            <strong>{row.company}</strong>
            <span>{row.title}</span>
          </div>
          <button className="apps-x" onClick={onClose} aria-label="Close review">✕</button>
        </div>
        <div className="apps-drawer-meta">
          <span className={`apps-tag ${reason.tone}`}>{reason.label}</span>
          {row.ats && <span className="apps-tag">{row.ats}</span>}
          <span className="apps-muted">{row.attempts} attempt{row.attempts === 1 ? "" : "s"} · {when(row.updatedAt)}</span>
          <a href={row.url} target="_blank" rel="noreferrer">Open ↗</a>
        </div>
        <div className="apps-drawer-body">
          {inBrowser ? (
            <div className="apps-review">
              <div className="apps-note"><p><strong>{IN_BROWSER_LABEL}.</strong> You opened it with Apply with Atriveo: review the answers and click Submit on the page. The worker never touches it, so there is nothing to approve here. {inBrowserSummary(inBrowser)}.</p></div>
              <InBrowserActions app={inBrowser} onDone={onDone} />
            </div>
          ) : loadError ? <p className="apps-error">{loadError}</p>
            : questions ? <ReviewPanel row={{ ...row, questions }} onDone={onDone} />
            : <p className="apps-muted">Loading questions…</p>}
        </div>
      </aside>
    </div>
  );
}

const HISTORY_PAGE = 10;

// --- Date range (your time zone) ------------------------------------------------------------------
type RangeKey = "today" | "yesterday" | "7" | "30" | "90" | "all" | "custom";
const RANGES: Array<[RangeKey, string]> = [["today", "Today"], ["yesterday", "Yesterday"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"], ["custom", "Custom"]];
const etDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function rangeDates(key: RangeKey, custom: { from: string; to: string }): { from: string; to: string } {
  switch (key) {
    case "today": return { from: etDay(0), to: etDay(0) };
    case "yesterday": return { from: etDay(1), to: etDay(1) };
    case "7": return { from: etDay(6), to: etDay(0) };
    case "90": return { from: etDay(89), to: etDay(0) };
    case "all": return { from: etDay(399), to: etDay(0) };
    case "custom": return custom.from && custom.to && custom.from <= custom.to ? custom : { from: etDay(29), to: etDay(0) };
    default: return { from: etDay(29), to: etDay(0) };
  }
}
const loadRange = (): RangeKey => { try { const v = localStorage.getItem("stats-range") as RangeKey | null; return v && RANGES.some(([k]) => k === v) ? v : "today"; } catch { return "today"; } };

/** The Applications console. Lives on apply.atriveo.com; the site supplies its own header. */
export default function Applications({ header }: { header?: React.ReactNode }) {
  // One date range for the whole page: tiles, charts and insights (remembered in this browser).
  const [rangeKey, setRangeKey] = useState<RangeKey>(loadRange);
  const [custom, setCustom] = useState({ from: etDay(6), to: etDay(0) });
  const { from: rangeFrom, to: rangeTo } = rangeDates(rangeKey, custom);
  const pickRange = (k: RangeKey) => { setRangeKey(k); try { localStorage.setItem("stats-range", k); } catch { /* private window */ } };
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"overview" | "responses" | "history" | "system">("overview");
  const [systemView, setSystemView] = useState("pipeline");
  const [historyPage, setHistoryPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getTailorServerBase()}/applications/analytics?view=summary&from=${rangeFrom}&to=${rangeTo}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // The scrape dock asks pages to refresh when a run finishes; this page can do it without a reload.
  useEffect(() => {
    const onFeed = (e: Event) => { e.preventDefault(); void load(); };
    window.addEventListener("atriveo:feed-updated", onFeed);
    return () => window.removeEventListener("atriveo:feed-updated", onFeed);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const [history, setHistory] = useState<{ rows: HistoryRow[]; total: number; key: string } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyKey = `${filter}|${query.trim()}|${historyPage}`;
  useEffect(() => {
    if (view !== "history") return;
    const controller = new AbortController();
    setHistoryBusy(true); setHistoryError(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ view: "history", status: filter, q: query.trim(), skip: String(historyPage * HISTORY_PAGE), limit: String(HISTORY_PAGE) });
      void fetch(`${getTailorServerBase()}/applications/analytics?${params}`, { credentials: "include", cache: "no-store", signal: controller.signal })
        .then(async response => {
          const json = await response.json();
          if (!response.ok || json.ok === false) throw new Error(json.error || `HTTP ${response.status}`);
          if (controller.signal.aborted) return;
          const lastPage = Math.max(0, Math.ceil(json.total / HISTORY_PAGE) - 1);
          if (historyPage > lastPage) { setHistoryPage(lastPage); return; }
          setHistory({ key: historyKey, total: json.total, rows: json.rows });
        }).catch(e => { if (!controller.signal.aborted) setHistoryError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!controller.signal.aborted) setHistoryBusy(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, filter, query, historyPage, historyKey, data?.generatedAt]);
  const historyRows = history?.key === historyKey ? history.rows : [];
  const attention = data?.attention ?? [];
  const showHistory = (status: Status | "ALL") => { setFilter(status); setQuery(""); setHistoryPage(0); setView("history"); };

  // In-flight first, then queued in the order the worker claims them (priority, then oldest first).
  const queue = useMemo(() => {
    const rank = (h: HistoryRow) => (h.status === "SUBMITTING" ? 0 : h.status === "APPLYING" ? 1 : 2);
    return [...(data?.queue ?? [])].sort((a, b) => rank(a) - rank(b) || (b.priority ?? 0) - (a.priority ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }, [data]);
  const findRow = (id: string) => attention.find((h) => h.id === id) ?? historyRows.find((h) => h.id === id) ?? queue.find((h) => h.id === id) ?? null;

  const found = openId ? findRow(openId) : null;
  const openRow = found?.status === "NEEDS_REVIEW" ? found : null;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const retry = (id: string) => void postAction({ action: "retry", applicationId: id }).then((r) => { setNotice(r.ok ? "Queued again." : r.error ?? "Failed"); void load(); });
  const done = (msg: string) => { setNotice(msg); setOpenId(null); void load(); };

  const k = data?.kpis;
  const r = data?.range;
  const rangeLabel = rangeKey === "custom" ? `${rangeFrom.slice(5)} – ${rangeTo.slice(5)}` : (RANGES.find(([key]) => key === rangeKey)?.[1] ?? "");
  const submitted = (r?.applied ?? 0) + (r?.linkedinApplied ?? 0);
  const cur = data?.current ?? null;
  const needsVerify = (data?.accounts ?? []).filter((a) => a.status === "verify_email").length;

  return (
    <div className="apps-page insights-workspace">
      {header}
      <main className="ins-workspace">
        <header className="ins-page-head"><div><span className="ins-label">Your application workspace</span><h1>Application insights</h1><p>A clear view of your progress and what needs you next.</p></div><div className="ins-page-tools"><Link className="apps-btn" to="/">Back to opportunities ↗</Link><button className="apps-refresh" onClick={() => void load()}>Refresh ↻</button>{data && <span className="apps-muted">Updated {when(data.generatedAt)}</span>}</div></header>
        {error && <div className="apps-error" role="alert">Couldn't refresh insights: {error} <button className="apps-btn" onClick={() => void load()}>Retry</button></div>}
        {!data && !error && <p className="apps-muted">Loading your insights…</p>}
        {data && k && <>
          <nav className="ins-nav" aria-label="Insights views">{([['overview', 'Overview'], ['responses', 'Employer responses'], ['history', 'History'], ['system', 'System details']] as const).map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}{key === 'responses' && Boolean(data.inbox?.confirm.length) && <span>{data.inbox!.confirm.length}</span>}</button>)}</nav>
          {view === "overview" && <section className="ins-overview" aria-label="Overview">
            <div className="ins-overview-top"><h2>Your progress</h2><div className="ins-range"><label>Activity period <select value={rangeKey} onChange={e => pickRange(e.target.value as RangeKey)}>{RANGES.map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>{rangeKey === 'custom' && <span><input type="date" aria-label="From" value={custom.from} max={custom.to || etDay(0)} onChange={e => setCustom(c => ({...c, from:e.target.value}))} /> → <input type="date" aria-label="To" value={custom.to} min={custom.from} max={etDay(0)} onChange={e => setCustom(c => ({...c, to:e.target.value}))} /></span>}</div></div>
            <div className="ins-metrics">
              <div><span>Applications submitted</span><strong>{submitted}</strong><small>{rangeLabel} · {k.applied + (data.linkedin?.applied ?? 0)} all time</small></div>
              <button onClick={() => showHistory('NEEDS_REVIEW')}><span>Awaiting your review ↗</span><strong>{k.needsReview}</strong><small>Current applications</small></button>
              <button onClick={() => showHistory('READY_TO_APPLY')}><span>Ready in the queue ↗</span><strong>{data.byStatus?.READY_TO_APPLY ?? 0}</strong><small>{(data.byStatus?.APPLYING ?? 0) + (data.byStatus?.SUBMITTING ?? 0)} being filled or submitted</small></button>
            </div>
            <div className="ins-overview-grid">
              <section className="ins-panel"><div className="ins-view-heading"><div><h2>Your next steps</h2><p>Pick one thing to move forward.</p></div></div><div className="ins-next-steps">
                <Link to="/unanswered"><span><strong>Answer application questions</strong><small>Complete the answers holding applications back.</small></span><span>→</span></Link>
                <Link to="/ready"><span><strong>Review ready applications</strong><small>Check your answers and approve the next submission.</small></span><span>→</span></Link>
                <button onClick={() => setView('responses')}><span><strong>{data.inbox?.confirm.length ? `Match ${data.inbox.confirm.length} employer emails` : 'Review employer responses'}</strong><small>{data.inbox?.confirm.length ? 'A few emails need to be linked to the right role.' : 'See application receipts and rejections.'}</small></span><span>→</span></button>
                {k.failed > 0 && <button onClick={() => showHistory('FAILED')}><span><strong>Check {k.failed} failed applications</strong><small>Review what happened and retry when appropriate.</small></span><span>→</span></button>}
              </div></section>
              <section className="ins-panel"><div className="ins-view-heading"><div><h2>Recent employer responses</h2><p>Latest emails · last {data.inbox?.days ?? 60} days</p></div><button className="apps-link" onClick={() => setView('responses')}>View all →</button></div><ul className="ins-recent-preview">{(data.inbox?.recent ?? []).slice(0,4).map(mail => <li key={mail.id}><CompanyLogo company={mail.company} size="sm" /><div><strong>{mail.company ?? 'Unknown company'}</strong><span>{mail.title || 'Role not named'}</span></div><span className={`apps-tag ${mail.kind === 'rejected' ? 'bad' : 'good'}`}>{mail.kind === 'rejected' ? 'Rejected' : 'Receipt'}</span></li>)}</ul>{!data.inbox?.recent.length && <p className="ins-empty">No employer responses yet.</p>}</section>
            </div>
            <div className="ins-health"><span><i className={data.worker?.online ? 'is-online' : ''} />{data.worker ? data.worker.online ? 'Worker online' : 'Worker offline' : 'Worker status unavailable'}</span>{cur && <span>{cur.status === 'SUBMITTING' ? 'Submitting' : 'Filling'} · {cur.company}</span>}{data.killSwitch && !data.killSwitch.enabled && <span className="apps-tag bad">Submissions paused{data.killSwitch.reason ? `: ${data.killSwitch.reason}` : ''}</span>}<button className="apps-link" onClick={() => setView('system')}>System details →</button></div>
          </section>}
          {view === 'responses' && (data.inbox ? <EmployerResponses inbox={data.inbox} onDone={done} /> : <div className="ins-empty">Employer responses aren't available yet.</div>)}
          {view === 'history' && <div className="ins-history">              <Section title="Application history" hint="All applications and their status" meta={<><span>{k.total} total</span><span>{k.applied} applied</span><span>{k.needsReview} need review</span></>}>
                <div className="apps-filters">
                  {(["ALL", "APPLIED", "NEEDS_REVIEW", "FAILED", "SKIPPED", "READY_TO_APPLY"] as const).map((st) => (
                    <button key={st} className={filter === st ? "active" : ""} onClick={() => { setFilter(st); setHistoryPage(0); }}>{st === "ALL" ? "All" : STATUS_META[st].label}</button>
                  ))}
                  <input placeholder="Search company or role" aria-label="Search applications" value={query} onChange={(e) => { setQuery(e.target.value); setHistoryPage(0); }} />
                </div>
                {historyError ? <p className="apps-error" role="alert">{historyError} <button className="apps-btn" onClick={() => void load()}>Retry</button></p> : !history ? <p className="apps-muted">Loading history…</p> : historyRows.length === 0 ? <p className="apps-muted">{historyBusy ? "Loading…" : "No applications match."}</p> : (
                  <>
                  <div className="apps-table-wrap apps-only-wide" tabIndex={0} aria-label="Application history results">
                    <table className="apps-table">
                      <thead><tr><th>Updated</th><th>Company</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                      <tbody>{historyRows.map((h) => (
                        <tr key={h.id}>
                          <td>{when(h.updatedAt)}</td>
                          <td>{h.company}</td>
                          <td>{h.title}</td>
                          <td><StatusPill status={h.status} /> <OutcomePill outcome={h.outcome} /></td>
                          <td><div className="apps-row-actions">
                            {h.status === "NEEDS_REVIEW" && <button className="apps-link" onClick={() => setOpenId(h.id)}>Review</button>}
                            {h.status === "FAILED" && <button className="apps-link" onClick={() => retry(h.id)}>Retry</button>}
                            <button className="apps-link" onClick={() => setHistoryId(h.id)}>History</button>
                            <a href={h.url} target="_blank" rel="noreferrer">Open</a>
                          </div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <ul className="apps-cards apps-only-narrow">
                    {historyRows.map((h) => (
                      <li key={h.id}>
                        <div className="apps-cards-top">
                          <CompanyLogo company={h.company} size="sm" />
                          <div className="apps-cards-id"><strong>{h.company}</strong><span>{h.title}</span></div>
                          <StatusPill status={h.status} />
                          <OutcomePill outcome={h.outcome} />
                        </div>
                        <div className="apps-muted">{h.ats ?? "—"} · {when(h.updatedAt)} · {h.attempts} attempt{h.attempts === 1 ? "" : "s"}</div>
                        {detailOf(h) && <div className="apps-cards-detail">{detailOf(h)}</div>}
                        <div className="apps-cards-actions">
                          {h.status === "NEEDS_REVIEW" && <button className="apps-btn accent" onClick={() => setOpenId(h.id)}>Review</button>}
                          {h.status === "FAILED" && <button className="apps-btn" onClick={() => retry(h.id)}>Retry</button>}
                          <button className="apps-btn" onClick={() => setHistoryId(h.id)}>History</button>
                          <a className="apps-btn" href={h.url} target="_blank" rel="noreferrer">Open</a>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="ins-pagination">
                    <span>{historyPage * HISTORY_PAGE + 1}–{historyPage * HISTORY_PAGE + historyRows.length} of {history.total} applications</span>
                    <button className="apps-btn" disabled={historyBusy || historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}>Previous</button>
                    <span>Page {historyPage + 1} of {Math.max(1, Math.ceil(history.total / HISTORY_PAGE))}</span>
                    <button className="apps-btn" disabled={historyBusy || (historyPage + 1) * HISTORY_PAGE >= history.total} onClick={() => setHistoryPage(p => p + 1)}>Next</button>
                  </div>
                  </>
                )}
              </Section></div>}
          {view === 'system' && <div className="ins-system">
            <aside className="ins-system-nav" aria-label="System detail categories">{[['pipeline','Pipeline'],['queue','Queue blockers'],['platforms','Platforms'],['questions','Questions'],['failures','Failures'],['accounts','Employer accounts'],['activity','Activity & connections']].map(([key,label]) => <button key={key} aria-current={systemView === key ? 'page' : undefined} onClick={() => setSystemView(key)}>{label}</button>)}</aside>
            <div className="ins-system-content">
              {systemView === 'pipeline' && <>              <Section title="Pipeline" hint={`Job funnel · all time. Daily outcomes: ${rangeLabel}. Change the activity period in Overview.`} meta={<>{data.funnel.map((f) => <span key={f.stage}>{f.n} {f.stage.toLowerCase()}</span>)}</>}>
                <ul className="apps-funnel">
                  {data.funnel.map((f, i) => {
                    const max = Math.max(1, data.funnel[0]?.n ?? 1);
                    const prev = i ? data.funnel[i - 1]!.n : null;
                    return (
                      <li key={f.stage} title={`${f.stage}: ${f.n}`}>
                        <span className="apps-barlist-label">{f.stage}</span>
                        <span className="apps-barlist-track"><span className="apps-funnel-fill" style={{ width: `${Math.max(1, (f.n / max) * 100)}%` }} /></span>
                        <span className="apps-barlist-n">{f.n}{prev ? <small> {pct(f.n / prev)}</small> : null}</span>
                      </li>
                    );
                  })}
                </ul>
                <details className="apps-more-details"><summary>Activity totals · {rangeLabel}</summary><div className="apps-simple-metrics">{[['Discovered',r?.discovered],['Resumes built',r?.matched],['Queued',r?.queued],['Submitted',submitted],['Sent to review',r?.needsReview],['Failed',r?.failed]].map(([label,value]) => <div key={label}><b>{value ?? '—'}</b><span>{label}</span></div>)}</div></details>
                <DailyChart days={data.daily} />
                <details className="apps-more-details"><summary>More pipeline details</summary><dl className="apps-status">
                  <dt>Success rate</dt><dd>{pct(k.successRate)} <span className="apps-muted">applied ÷ (applied + failed)</span></dd>
                  <dt>Skipped</dt><dd>{k.skipped}</dd>
                  <dt>Form patterns</dt>
                  <dd>{data.formTrust.trusted ?? 0} trusted · {data.formTrust.learning ?? 0} learning{data.formTrust.revoked ? ` · ${data.formTrust.revoked} revoked` : ""}</dd>
                  <dt>Job boards</dt>
                  <dd>{data.discovery.boards.map((b) => `${b.ats} ${b.boards} (${b.withMatches} with matches)`).join(" · ") || "—"}</dd>
                  <dt>Jobs by source</dt>
                  <dd>{data.discovery.jobsBySite.map((s) => `${s.site} ${s.n}`).join(" · ")}</dd>
                </dl></details>
              </Section></>}
              {systemView === 'queue' && <Section title="Queue blockers" hint="What is holding applications back">{data.queueReport ? <QueueReasons report={data.queueReport} /> : <p className="apps-muted">No queue report available.</p>}</Section>}
              {systemView === 'platforms' && <>              <Section title="ATS performance" hint="Application results by platform" meta={<><span>{data.byAts.length} platform{data.byAts.length === 1 ? "" : "s"}</span><span>{k.total} jobs</span></>}>
                <ul className="apps-cards apps-only-narrow">
                  {data.byAts.map((a) => (
                    <li key={a.ats}>
                      <div className="apps-cards-top"><div className="apps-cards-id"><strong>{a.ats}</strong><span>{a.total} total</span></div></div>
                      <div className="apps-kv"><span>Applied <b>{a.APPLIED}</b></span><span>Needs review <b>{a.NEEDS_REVIEW}</b></span><span>Failed <b>{a.FAILED}</b></span><span>Skipped <b>{a.SKIPPED}</b></span><span>In progress <b>{a.other}</b></span></div>
                    </li>
                  ))}
                </ul>
                <div className="apps-table-wrap apps-only-wide"><table className="apps-table">
                  <thead><tr><th>ATS</th><th>Total</th><th>Applied</th><th>Needs review</th><th>Failed</th><th>Skipped</th><th>In progress</th></tr></thead>
                  <tbody>{data.byAts.map((a) => (
                    <tr key={a.ats}><td>{a.ats}</td><td>{a.total}</td><td>{a.APPLIED}</td><td>{a.NEEDS_REVIEW}</td><td>{a.FAILED}</td><td>{a.SKIPPED}</td><td>{a.other}</td></tr>
                  ))}</tbody>
                </table></div>
              </Section></>}
              {systemView === 'questions' && <>              <Section title="Questions & learned answers" hint="Questions that often need your input" meta={<span>{data.topPendingQuestions.length} categor{data.topPendingQuestions.length === 1 ? "y" : "ies"}</span>}>
                <details className="apps-more-details"><summary>Why applications are waiting</summary><BarList rows={data.reviewReasons.map((r) => ({ label: humanize(r.reason), n: r.n }))} empty="Nothing waiting for review." /></details>
                <h3>Questions that most often need your answer</h3>
                <p className="apps-muted">Answer these once (Review) and they're remembered for future applications.</p>
                <BarList rows={data.topPendingQuestions.map((q) => ({ label: q.label, n: q.n }))} empty="No pending questions." />
              </Section></>}
              {systemView === 'failures' && <>              <Section title="Failures" hint="Failed applications by type" meta={<span>{k.failed ? `${k.failed} failed` : "No failures"}</span>}>
                <BarList rows={data.failureCodes.map((r) => ({ label: humanize(r.code), n: r.n }))} empty="No failures." />
              </Section></>}
              {systemView === 'accounts' && <Section title="Employer accounts" hint="Accounts created for your applications" meta={<span>{needsVerify} need verification</span>}>{data.accounts?.length ? <AccountsCard accounts={data.accounts} /> : <p className="apps-muted">No employer accounts.</p>}</Section>}
              {systemView === 'activity' && <Section title="Activity & connections" hint="Application activity and service status"><ApplyHeatmap /><dl className="apps-status"><dt>Worker</dt><dd>{data.worker ? data.worker.online ? 'Online' : 'Offline' : 'Unknown'}</dd><dt>Gmail</dt><dd>{data.worker?.gmailConnected ? 'Connected' : 'Not connected'}</dd><dt>Submissions</dt><dd>{data.killSwitch ? data.killSwitch.enabled ? 'Allowed' : `Paused: ${data.killSwitch.reason ?? 'No reason supplied'}` : 'Unknown'}</dd><dt>Last application activity</dt><dd>{data.lastActivityAt ? when(data.lastActivityAt) : 'No activity yet'}</dd></dl>{cur && <div className="apps-now"><strong>{cur.company}</strong><span>{cur.title} · {stepLabel(cur.step) || humanize(cur.status)}{cur.startedAt ? ` · started ${clock(cur.startedAt)}` : ''}</span><a href={cur.url} target="_blank" rel="noreferrer">Open ↗</a></div>}</Section>}
            </div>
          </div>}
        </>}
      </main>

      {historyId && data && (() => {
        const hr = findRow(historyId);
        return hr ? <HistoryDrawer row={hr} onClose={() => setHistoryId(null)} /> : null;
      })()}
      {openRow && <ReviewDrawer row={openRow} onClose={closeDrawer} onDone={done} />}
      {notice && <div className="apps-toast" role="status"><span>{notice}</span><button type="button" className="apps-toast-close" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
