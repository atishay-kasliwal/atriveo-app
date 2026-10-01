import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CompanyLogo from "../components/CompanyLogo";
import PdfPreviewModal from "../components/PdfPreviewModal";
import { getTailorServerBase } from "../utils/tailorServer";
import "../styles/applications.css";

// Application engine analytics (playatriveo): history, outcomes and what needs you.
// Data: GET /tailor/applications/analytics → Mac sidecar → Mongo (read-only).

type Status = "READY_TO_APPLY" | "APPLYING" | "NEEDS_REVIEW" | "SUBMITTING" | "APPLIED" | "FAILED" | "SKIPPED";

interface Day { day: string; queued: number; applied: number; needsReview: number; failed: number; skipped: number }
interface PendingQ {
  fingerprint: string; label: string; type: string; required: boolean; options: string[];
  canonicalKey: string | null; sensitive: string | null; reason: string; detail: string;
}
interface HistoryRow {
  questions: PendingQ[]; submitAttempted: boolean;
  id: string; company: string; title: string; location: string | null; ats: string | null; status: Status;
  reviewReason: string | null; reviewDetail: string | null; pending: string[]; failureCode: string | null; failureMessage: string | null;
  submittedBy: string | null; submittedAt: string | null; attempts: number; domain: string | null; url: string; createdAt: string; updatedAt: string;
  /** What the employer's mail said after you applied (inbox watcher). */
  outcome?: { status: "confirmed" | "rejected"; at: string | null; subject: string | null } | null;
  priority?: number;
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
  history: HistoryRow[];
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

const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { ...(new Date(iso).toDateString() === new Date().toDateString() ? {} : { month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit" }) : null);
const duration = (ms: number | null | undefined) => (ms == null ? null : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

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
  const [pick, setPick] = useState(item.candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const run = async (body: object, ok: string) => {
    setBusy(true);
    const r = await postAction(body);
    setBusy(false);
    onDone(r.ok ? ok : r.error ?? "Failed");
  };
  return (
    <li className="apps-inbox-item">
      <div className="apps-cards-id">
        <strong>{item.company ?? "Unknown company"}{item.title ? ` · ${item.title}` : ""}</strong>
        <span>{item.kind === "rejected" ? "Rejection" : "Confirmation"} · {when(item.at)} · “{item.subject}”</span>
      </div>
      <div className="apps-muted">{item.reason}</div>
      <div className="apps-cards-actions">
        {item.candidates.length > 0 && (
          <select className="apps-select" aria-label="Which application is this about?" value={pick} onChange={(e) => setPick(e.target.value)}>
            {item.candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <button className="apps-btn accent" disabled={!pick || busy}
          onClick={() => void run({ action: "inbox_confirm", mailId: item.id, target: item.target, id: pick }, item.kind === "rejected" ? "Marked rejected." : "Linked.")}>
          {item.kind === "rejected" ? "Mark rejected" : "Link"}
        </button>
        <button className="apps-btn" disabled={busy} onClick={() => void run({ action: "inbox_dismiss", mailId: item.id }, "Dismissed.")}>Not one of mine</button>
      </div>
    </li>
  );
}

function EmployerResponses({ inbox, onDone }: { inbox: InboxSummary; onDone: (message: string) => void }) {
  return (
    <>
      {inbox.confirm.length > 0 && (
        <>
          <h3 className="apps-subhead">Please confirm ({inbox.confirm.length})</h3>
          <ul className="apps-inbox-list">{inbox.confirm.map((item) => <InboxConfirmItem key={item.id} item={item} onDone={onDone} />)}</ul>
        </>
      )}
      <h3 className="apps-subhead">Recent</h3>
      {inbox.recent.length === 0 ? <p className="apps-muted">No confirmations or rejections in the last {inbox.days} days.</p> : (
        <>
        <div className="apps-only-narrow">
        <ul className="apps-inbox-list">
          {inbox.recent.map((m) => (
            <li key={m.id} className="apps-inbox-item" title={m.subject}>
              <div className="apps-cards-top">
                <div className="apps-cards-id"><strong>{m.company ?? "—"}</strong><span>{m.title ?? "Role not named"}</span></div>
                <span className={`apps-pill ${m.kind === "rejected" ? "st-critical" : "st-good"}`}><span aria-hidden>{m.kind === "rejected" ? "✕" : "✓"}</span> {m.kind === "rejected" ? "Rejected" : "Confirmed"}</span>
              </div>
              <div className="apps-muted">{when(m.at)} · {m.recordedIn.length ? `in ${m.recordedIn.map((w) => RECORDED_IN[w]).join(", ")}` : "not matched"}</div>
            </li>
          ))}
        </ul>
        </div>
        <div className="apps-table-wrap apps-only-wide">
          <table className="apps-table">
            <thead><tr><th>Received</th><th>Company</th><th>Role</th><th>Result</th><th>Recorded in</th></tr></thead>
            <tbody>{inbox.recent.map((m) => (
              <tr key={m.id} title={m.subject}>
                <td>{when(m.at)}</td>
                <td>{m.company ?? "—"}</td>
                <td>{m.title ?? "—"}</td>
                <td><span className={`apps-pill ${m.kind === "rejected" ? "st-critical" : "st-good"}`}><span aria-hidden>{m.kind === "rejected" ? "✕" : "✓"}</span> {m.kind === "rejected" ? "Rejected" : "Confirmed"}</span></td>
                <td className="apps-detail">{m.recordedIn.length ? m.recordedIn.map((w) => RECORDED_IN[w]).join(", ") : "not matched"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}

function QueueReasons({ report }: { report: QueueReport }) {
  return (
    <>
      <p className="apps-muted">
        {report.resumeReady} jobs have a finished resume. Auto-queue is <strong>{report.autoQueue ? "on" : "off"}</strong>
        {report.queued ? ` · ${report.queued} in the engine's queue${report.waitingForCompanySlot ? ` (${report.waitingForCompanySlot} waiting for the company's daily slot)` : ""}` : ""}
        {" · "}as of {when(report.generatedAt)}
      </p>
      <div className="apps-table-wrap">
        <table className="apps-table">
          <thead><tr><th>Jobs</th><th>Reason</th><th className="apps-hide-narrow">For example</th></tr></thead>
          <tbody>{report.reasons.map((r) => (
            <tr key={r.code}>
              <td>{r.n}</td>
              <td>{r.code === "READY" && !report.autoQueue ? `${r.label} (auto-queue is off)` : r.label}</td>
              <td className="apps-detail apps-hide-narrow">{r.examples.map((e) => `${e.company} · ${e.title}`).join("; ")}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {report.youApply && report.youApply.length > 0 && <YouApplyPile jobs={report.youApply} />}
    </>
  );
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
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="apps-empty">{empty}</p>;
  return (
    <ul className="apps-barlist">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.n}`}>
          <span className="apps-barlist-label">{r.label}</span>
          <span className="apps-barlist-track"><span className="apps-barlist-fill" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="apps-barlist-n">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

type Scope = "application" | "company" | "global";

async function postAction(body: object): Promise<{ ok: boolean; error?: string; requeued?: boolean }> {
  const res = await fetch(`${getTailorServerBase()}/applications/action`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? json : { ok: false, error: json.error || `HTTP ${res.status}` };
}

/** Answer pending questions, or decide on an application, without the terminal. */
function ReviewPanel({ row, onDone }: { row: HistoryRow; onDone: (msg: string) => void }) {
  const companyWord = row.company.toLowerCase().split(/\s+/)[0] ?? "";
  const defaultScope = (q: PendingQ): Scope =>
    q.sensitive ? "application" : companyWord && q.label.toLowerCase().includes(companyWord) ? "company" : "global";
  const [values, setValues] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, Scope>>(() => Object.fromEntries(row.questions.map((q) => [q.fingerprint, defaultScope(q)])));
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
    .filter((q) => values[q.fingerprint]?.trim())
    .map((q) => ({ fingerprint: q.fingerprint, label: q.label, type: q.type, canonicalKey: q.canonicalKey, sensitive: q.sensitive, value: values[q.fingerprint]!.trim(), scope: scopes[q.fingerprint] ?? "global" }));

  return (
    <div className="apps-review">
      {row.questions.length === 0 && (
        <div className="apps-note">
          <p><strong>Nothing to answer here.</strong> {row.reviewDetail ?? "The engine stopped on a rule."}</p>
          <p>Some questions, such as legal confirmations and privacy notices, are never answered for you. Open the form, finish it yourself, then choose “I submitted it myself”.</p>
        </div>
      )}
      {row.questions.map((q) => (
        <div key={q.fingerprint} className="apps-q">
          <label>
            <span className="apps-q-label">{q.label}{q.required ? " *" : ""}{q.sensitive ? <em> · {q.sensitive.replace(/_/g, " ")}</em> : null}</span>
            {q.options.length ? (
              <select value={values[q.fingerprint] ?? ""} onChange={(e) => setValues({ ...values, [q.fingerprint]: e.target.value })}>
                <option value="">Choose…</option>
                {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <textarea rows={q.type === "textarea" ? 3 : 1} value={values[q.fingerprint] ?? ""} onChange={(e) => setValues({ ...values, [q.fingerprint]: e.target.value })} placeholder="Your answer" />
            )}
          </label>
          <select className="apps-q-scope" aria-label="Use this answer for" value={scopes[q.fingerprint]} onChange={(e) => setScopes({ ...scopes, [q.fingerprint]: e.target.value as Scope })}>
            <option value="application">Only this application</option>
            <option value="company">All {row.company} jobs</option>
            <option value="global">Every application</option>
          </select>
        </div>
      ))}
      <div className="apps-review-actions">
        {row.questions.length > 0 && <button className="primary" disabled={busy || !answers.length} onClick={() => run({ action: "answer", applicationId: row.id, answers }, `Saved ${answers.length} answer(s). It will be filled again and, if everything is answered, submitted.`)}>
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
        <h3>Sign-ins the engine created</h3>
        {needsVerify > 0 && <span className="apps-pill st-warning">! {needsVerify} waiting for email verification</span>}
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
      <div className="apps-table-wrap apps-only-wide"><table className="apps-table">
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
      </table></div>
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
  if (h.status === "FAILED") return { label: humanize(h.failureCode ?? "failed"), tone: "bad" };
  const email = emailStepOf(h);
  if (email === "code") return { label: "Security code not entered", tone: "warn" };
  if (email === "verify") return { label: "Verify email", tone: "warn" };
  if (h.submitAttempted) return { label: "Confirm submission", tone: "warn" };
  if (h.reviewReason === "UNKNOWN_QUESTION" || h.reviewReason === "SENSITIVE_QUESTION") {
    const n = h.pending.length;
    if (h.reviewReason === "UNKNOWN_QUESTION" && n) return { label: `${n} unanswered question${n === 1 ? "" : "s"}`, tone: "warn" };
    if (n > 1) return { label: `${n} sensitive questions`, tone: "warn" };
  }
  return { label: REASON_LABEL[h.reviewReason ?? ""] ?? humanize(h.reviewReason ?? "needs review"), tone: "warn" };
}

interface Detail {
  ok: boolean; error?: string;
  id: string; company: string; title: string; ats: string | null; status: Status; url: string;
  resume: { fileName: string | null; path: string | null; sha256: string | null; bytes: number | null; verifiedAt: string | null; sourceJobUrl: string | null };
  questions: Array<{
    label: string; step: number; required: boolean; type: string; resolution: "answered" | "needs_review" | "skipped"; verified: boolean;
    sensitive: string | null; answer: string | null; answerKind: "value" | "declined" | "withheld" | "blank" | "none"; source: string; detail: string | null;
  }>;
  timeline: Array<{ at: string; from: string | null; to: string; actor: string; reason: string }>;
  attempts: Array<{ n: number; startedAt: string; endedAt: string | null; outcome: string | null }>;
  submission: { by: string | null; submittedAt: string | null; confirmation: string | null };
  failure: { code: string; message: string } | null;
  resumeReport?: ResumeReport | null;
}

interface ResumeReport {
  pipeline: string | null; tailoredAt: string | null; thesis: string | null; headerTitle: string | null;
  ats: { before: number | null; after: number | null };
  confidence: number | null;
  human: {
    score: number | null; wouldInterview: boolean | null; diagnosis: string | null; because: string[]; concerns: string[];
    parts: { technical: number | null; impact: number | null; execution: number | null; uniqueness: number | null; overclaimRisk: number | null };
  } | null;
  coverage: {
    pct: number | null;
    covered: Array<{ term: string; where: string | null; how: string | null }>;
    gaps: Array<{ term: string; where: string | null; how: string | null; status: string }>;
    missingClaimable: string[]; unclaimable: string[];
  };
  keywords: Array<{ keyword: string; count: number; min: number | null; max: number | null; status: string }>;
  jdNote: string | null;
}

const bytesLabel = (n: number | null) => (n == null ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function answerText(q: Detail["questions"][number]): { text: string; muted: boolean } {
  switch (q.answerKind) {
    case "value": return { text: q.answer ?? "", muted: false };
    case "declined": return { text: "Decline to self-identify", muted: false };
    case "withheld": return { text: "Filled (value not stored: sensitive)", muted: true };
    case "blank": return { text: "Left blank", muted: true };
    default: return { text: q.resolution === "needs_review" ? "Waiting for your answer" : "—", muted: true };
  }
}

/** Score tile: a big number, what it means, and an optional tone. */
function Score({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad"; children?: React.ReactNode }) {
  return (
    <div className={`apps-score ${tone ?? ""}`}>
      <span className="apps-score-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
      {children}
    </div>
  );
}

const toneFor = (v: number | null, good: number, ok: number) => (v == null ? undefined : v >= good ? "good" : v >= ok ? "warn" : "bad");

const PART_LABELS: Array<[keyof NonNullable<ResumeReport["human"]>["parts"], string]> = [
  ["technical", "Technical depth"], ["impact", "Business impact"], ["execution", "Execution"], ["uniqueness", "Uniqueness"],
];

/**
 * Everything about one application in a single view: scores (ATS, hiring manager, JD coverage),
 * what the resume covers and misses, the hiring-manager read, every question with its answer,
 * and the timeline. Opens as a large panel on desktop and a full-screen sheet on phones.
 */
function HistoryDrawer({ row, onClose }: { row: HistoryRow; onClose: () => void }) {
  useBodyLock();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pdf-modal-overlay")) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    fetch(`${getTailorServerBase()}/applications/detail?id=${encodeURIComponent(row.id)}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => { const j = await res.json(); if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`); return j as Detail; })
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [row.id]);

  const qs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (detail?.questions ?? []).filter((q) => !f || `${q.label} ${q.answer ?? ""} ${q.source}`.toLowerCase().includes(f));
  }, [detail, filter]);
  const answered = detail?.questions.filter((q) => q.resolution === "answered").length ?? 0;
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  // Phones show only the first page of a PDF inside a frame, so open it in its own tab there.
  const openResume = (path: string) => {
    if (window.matchMedia("(max-width: 720px)").matches) window.open(`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(path)}`, "_blank", "noopener");
    else setPdfPath(path);
  };

  const rep = detail?.resumeReport ?? null;
  const human = rep?.human ?? null;
  const notCovered = rep ? [
    ...rep.coverage.missingClaimable.map((t) => ({ term: t, kind: "missing" as const })),
    ...rep.coverage.gaps.filter((g) => !rep.coverage.missingClaimable.includes(g.term)).map((g) => ({ term: g.term, kind: "missing" as const })),
    ...rep.coverage.unclaimable.map((t) => ({ term: t, kind: "no-evidence" as const })),
  ] : [];
  const overUsed = rep?.keywords.filter((k) => k.status === "over") ?? [];
  const underUsed = rep?.keywords.filter((k) => k.status === "under" || k.status === "missing") ?? [];

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
          {error && <p className="apps-error">Couldn't load this application: {error}</p>}
          {!detail && !error && <p className="apps-muted">Loading…</p>}
          {detail && (
            <>
              <section className="apps-scores" aria-label="Scores">
                <Score
                  label="ATS score"
                  value={rep?.ats.after != null ? `${rep.ats.after}` : "—"}
                  sub={rep?.ats.before != null && rep.ats.after != null ? `${rep.ats.before} before tailoring (${rep.ats.after - rep.ats.before >= 0 ? "+" : ""}${rep.ats.after - rep.ats.before})` : rep ? "keyword match to the JD" : "no scoring report"}
                  tone={toneFor(rep?.ats.after ?? null, 75, 60)}
                />
                <Score
                  label="Hiring manager"
                  value={human?.score != null ? `${human.score}/10` : "—"}
                  sub={human?.wouldInterview == null ? "human read" : human.wouldInterview ? "✓ would interview" : "✕ would not interview"}
                  tone={human?.score != null ? (human.score >= 8 ? "good" : human.score >= 6 ? "warn" : "bad") : undefined}
                />
                <Score
                  label="JD coverage"
                  value={rep?.coverage.pct != null ? `${rep.coverage.pct}%` : "—"}
                  sub={rep ? `${rep.coverage.covered.length} covered · ${notCovered.length} not covered` : "weighted by importance"}
                  tone={toneFor(rep?.coverage.pct ?? null, 70, 50)}
                >
                  {notCovered.length > 0 && (
                    <span className="apps-score-missing">
                      <span className="apps-score-missing-label">Missing:</span>{" "}
                      {notCovered.slice(0, 6).map((c) => c.term).join(", ")}
                      {notCovered.length > 6 && (
                        <> · <button type="button" className="apps-link" onClick={() => document.getElementById("apps-not-covered")?.scrollIntoView({ behavior: "smooth", block: "center" })}>+{notCovered.length - 6} more</button></>
                      )}
                    </span>
                  )}
                </Score>
                <Score label="Resume confidence" value={rep?.confidence != null ? `${rep.confidence}` : "—"} sub="overall, out of 100" tone={toneFor(rep?.confidence ?? null, 75, 60)} />
                <Score label="Questions" value={`${answered}/${detail.questions.length}`} sub="answered on the form" tone={answered === detail.questions.length ? "good" : "warn"} />
              </section>

              <div className="apps-full-grid">
                <div className="apps-full-col">
                  <section className="apps-block">
                    <div className="apps-block-head"><h3>Resume</h3>
                      {detail.resume.path && (
                        <div className="apps-resume-open">
                          <button type="button" className="apps-btn accent" onClick={() => openResume(detail.resume.path!)} title={detail.resume.path}>Open resume</button>
                          <a className="apps-link" href={`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(detail.resume.path)}&dl=1`} download="Atishay Kasliwal.pdf">Download</a>
                        </div>
                      )}
                    </div>
                    {rep?.thesis && <p className="apps-thesis">“{rep.thesis}”</p>}
                    <p className="apps-muted">
                      {detail.resume.fileName ?? "No resume recorded"}{detail.resume.bytes ? ` · ${bytesLabel(detail.resume.bytes)}` : ""}
                      {detail.resume.verifiedAt ? ` · uploaded ${when(detail.resume.verifiedAt)}` : ""}
                      {detail.resume.sourceJobUrl && <> · <a href={detail.resume.sourceJobUrl} target="_blank" rel="noreferrer">tailored job ↗</a></>}
                    </p>
                    {rep?.jdNote && <p className="apps-muted">{rep.jdNote}</p>}
                  </section>

                  <section className="apps-block">
                    <h3>What the resume covers</h3>
                    {!rep ? <p className="apps-muted">No coverage report was saved for this resume.</p> : (
                      <>
                        <div className="apps-chips-group">
                          <span className="apps-chips-title good">Covered · {rep.coverage.covered.length}</span>
                          <div className="apps-chips">
                            {rep.coverage.covered.map((c) => <span key={c.term} className="apps-chip2 good" title={c.where ? `in ${c.where}` : undefined}>{c.term}{c.where && c.where !== "none" ? <em>{c.where}</em> : null}</span>)}
                            {rep.coverage.covered.length === 0 && <span className="apps-muted">Nothing matched.</span>}
                          </div>
                        </div>
                        <div className="apps-chips-group" id="apps-not-covered">
                          <span className="apps-chips-title warn">Not covered · {notCovered.length}</span>
                          <div className="apps-chips">
                            {notCovered.map((c) => <span key={`${c.kind}-${c.term}`} className={`apps-chip2 ${c.kind === "missing" ? "warn" : "muted"}`} title={c.kind === "missing" ? "You have evidence for this but it is not on the resume" : "No evidence in your experience bank"}>{c.term}{c.kind === "no-evidence" ? <em>no evidence</em> : null}</span>)}
                            {notCovered.length === 0 && <span className="apps-muted">Every JD term is covered.</span>}
                          </div>
                        </div>
                        {(overUsed.length > 0 || underUsed.length > 0) && (
                          <div className="apps-chips-group">
                            <span className="apps-chips-title">Keyword balance</span>
                            <div className="apps-chips">
                              {overUsed.map((k) => <span key={k.keyword} className="apps-chip2 muted" title={`Used ${k.count}× (target ${k.min ?? 0}–${k.max ?? "?"})`}>{k.keyword}<em>{k.count}× over</em></span>)}
                              {underUsed.map((k) => <span key={k.keyword} className="apps-chip2 warn" title={`Used ${k.count}× (target ${k.min ?? 0}–${k.max ?? "?"})`}>{k.keyword}<em>{k.count}× under</em></span>)}
                            </div>
                          </div>
                        )}
                        {rep.keywords.length > 0 && (
                          <>
                            <button className="apps-link" onClick={() => setShowAllKeywords((v) => !v)}>{showAllKeywords ? "Hide keyword table" : `All ${rep.keywords.length} ATS keywords`}</button>
                            {showAllKeywords && (
                              <div className="apps-table-wrap"><table className="apps-table">
                                <thead><tr><th>Keyword</th><th>Used</th><th>Target</th><th>Status</th></tr></thead>
                                <tbody>{rep.keywords.map((k) => <tr key={k.keyword}><td>{k.keyword}</td><td>{k.count}</td><td>{k.min ?? 0}–{k.max ?? "?"}</td><td>{k.status}</td></tr>)}</tbody>
                              </table></div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </section>

                  <section className="apps-block">
                    <h3>Hiring manager read</h3>
                    {!human ? <p className="apps-muted">No hiring-manager review was saved for this resume.</p> : (
                      <>
                        {human.diagnosis && <p className="apps-diagnosis">{human.diagnosis}</p>}
                        <ul className="apps-bars">
                          {PART_LABELS.map(([k, label]) => {
                            const v = human.parts[k];
                            return v == null ? null : (
                              <li key={k}><span>{label}</span><span className="apps-meter"><i style={{ width: `${Math.max(2, v * 10)}%` }} /></span><b>{v}</b></li>
                            );
                          })}
                          {human.parts.overclaimRisk != null && <li><span>Overclaim risk</span><span className="apps-meter risk"><i style={{ width: `${Math.max(2, human.parts.overclaimRisk * 10)}%` }} /></span><b>{human.parts.overclaimRisk}</b></li>}
                        </ul>
                        <div className="apps-proscons">
                          <ul className="pros">{human.because.map((b) => <li key={b}>{b}</li>)}</ul>
                          {human.concerns.length > 0 && <ul className="cons">{human.concerns.map((c) => <li key={c}>{c}</li>)}</ul>}
                        </div>
                      </>
                    )}
                  </section>
                </div>

                <div className="apps-full-col">
                  <section className="apps-block">
                    <div className="apps-block-head">
                      <h3>Questions and answers <span className="apps-count">{answered}/{detail.questions.length}</span></h3>
                      <input className="apps-hist-search" placeholder="Filter" aria-label="Filter questions" value={filter} onChange={(e) => setFilter(e.target.value)} />
                    </div>
                    {qs.length === 0 ? <p className="apps-muted">No questions recorded.</p> : (
                      <ul className="apps-qa2">
                        {qs.map((q, i) => {
                          const a = answerText(q);
                          return (
                            <li key={`${q.label}-${i}`} className={q.resolution === "needs_review" ? "needs" : ""}>
                              <span className="q">{q.label}{q.required ? " *" : ""}</span>
                              <span className={`a ${a.muted ? "muted" : ""}`}>{a.text}</span>
                              <span className="m" title={q.source}>
                                {q.resolution === "answered" ? (q.verified ? <b className="ok">✓</b> : <b className="warn">?</b>) : q.resolution === "needs_review" ? <b className="warn">!</b> : null}
                                {q.source !== "—" ? q.source.split(" · ")[0] : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="apps-block">
                    <h3>Timeline</h3>
                    <ol className="apps-timeline">
                      {detail.timeline.map((t, i) => (
                        <li key={i}>
                          <span className="apps-muted">{when(t.at)}</span>
                          <span>{t.from ? `${humanize(t.from)} → ` : ""}<strong>{humanize(t.to)}</strong> <span className="apps-muted">· {t.actor}</span></span>
                          {t.reason && <span className="apps-muted">{t.reason}</span>}
                        </li>
                      ))}
                    </ol>
                    {detail.submission.confirmation && <p className="apps-muted">Confirmation: {detail.submission.confirmation}</p>}
                    {detail.failure && <p className="apps-muted">Last failure: {humanize(detail.failure.code)} — {detail.failure.message}</p>}
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {pdfPath && <PdfPreviewModal pdfPath={pdfPath} onClose={() => setPdfPath(null)} />}
    </div>
  );
}

/** One line about what happened to an application, shared by the table and the phone cards. */
function detailOf(h: HistoryRow): string {
  if (h.status === "NEEDS_REVIEW") return `${humanize(h.reviewReason ?? "")}${h.pending.length ? ` · ${h.pending.length} question(s)` : ""}`;
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

function Stat({ label, value, tone, sub }: { label: string; value: string | number; tone?: "warn" | "bad" | "good"; sub?: string }) {
  return (
    <div className={`apps-stat ${tone ?? ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Section({ title, hint, meta, children }: { title: string; hint: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="apps-section">
      <summary>
        <span className="apps-chev" aria-hidden>›</span>
        <span className="apps-section-title">{title}</span>
        <span className="apps-section-hint">{hint}</span>
        <span className="apps-section-meta">{meta}</span>
      </summary>
      <div className="apps-section-body">{children}</div>
    </details>
  );
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
          <ReviewPanel row={row} onDone={onDone} />
        </div>
      </aside>
    </div>
  );
}

const OPS_PREVIEW = 4;
const OPS_VISIBLE = 10;

/** Rows for the two ops panels: 4 collapsed; expanded shows 10 and scrolls the rest. */
function OpsRows({ expanded, children }: { expanded: boolean; children: React.ReactNode[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const scrolls = expanded && children.length > OPS_VISIBLE;

  // Row height changes across breakpoints, so size the list to the 10th row. Written straight to the
  // DOM (no state) so the first expanded paint is already the right height.
  useLayoutEffect(() => {
    const ul = ref.current;
    if (!scrolls || !ul) return;
    const fit = () => {
      const tenth = ul.children[OPS_VISIBLE - 1] as HTMLElement | undefined;
      if (tenth) ul.style.maxHeight = `${Math.ceil(tenth.getBoundingClientRect().bottom - ul.getBoundingClientRect().top + ul.scrollTop)}px`;
      ul.toggleAttribute("data-more", ul.scrollTop + ul.clientHeight < ul.scrollHeight - 2);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(ul);
    ul.addEventListener("scroll", fit, { passive: true });
    return () => {
      ro.disconnect();
      ul.removeEventListener("scroll", fit);
      ul.style.maxHeight = "";
      ul.removeAttribute("data-more");
    };
  }, [scrolls, children.length]);

  return <ul ref={ref} className={`apps-rows ${scrolls ? "is-scroll" : ""}`}>{expanded ? children : children.slice(0, OPS_PREVIEW)}</ul>;
}

function QueuePanel({ rows, expanded, onToggle, onHistory }: { rows: HistoryRow[]; expanded: boolean; onToggle: () => void; onHistory: (id: string) => void }) {
  const firstQueued = rows.find((h) => h.status === "READY_TO_APPLY")?.id;
  return (
    <section className="apps-panel" aria-labelledby="queue-title">
      <div className="apps-panel-head">
        <h2 id="queue-title">Apply queue {rows.length > 0 && <span className="apps-count">{rows.length}</span>}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="apps-clear">Nothing is queued.</p>
      ) : (
        <>
          <OpsRows expanded={expanded}>
            {rows.map((h) => {
              const active = h.status === "APPLYING" || h.status === "SUBMITTING";
              return (
                <li key={h.id}>
                  <CompanyLogo company={h.company} size="sm" />
                  <div className="apps-row-id">
                    <strong>{h.company}</strong>
                    <span>{h.title}</span>
                  </div>
                  <span className={`apps-tag ${active ? "active" : ""}`}>
                    {active && <span className="apps-pulse" aria-hidden />}
                    {active ? STATUS_META[h.status].label : h.id === firstQueued ? "Next up" : "Queued"}
                  </span>
                  <span className="apps-row-act">
                    <button className="apps-link" onClick={() => onHistory(h.id)}>History</button>
                    <a className="apps-btn-link" href={h.url} target="_blank" rel="noreferrer">Open ↗</a>
                  </span>
                </li>
              );
            })}
          </OpsRows>
          {rows.length > OPS_PREVIEW && (
            <button className="apps-link" onClick={onToggle}>{expanded ? "Show fewer" : `View full queue (${rows.length})`}</button>
          )}
        </>
      )}
    </section>
  );
}

function AttentionPanel({ rows, expanded, onToggle, onReview, onRetry, onHistory }: { rows: HistoryRow[]; expanded: boolean; onToggle: () => void; onReview: (id: string) => void; onRetry: (id: string) => void; onHistory: (id: string) => void }) {
  return (
    <section className={`apps-panel is-attn ${rows.length ? "has-items" : ""}`} aria-labelledby="attn-title">
      <div className="apps-panel-head">
        <h2 id="attn-title">Needs your attention {rows.length > 0 && <span className="apps-count warn">{rows.length}</span>}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="apps-clear">Nothing is waiting for you.</p>
      ) : (
        <>
          <OpsRows expanded={expanded}>
            {rows.map((h) => {
              const r = reasonOf(h);
              return (
                <li key={h.id}>
                  <CompanyLogo company={h.company} size="sm" />
                  <div className="apps-row-id">
                    <strong>{h.company}</strong>
                    <span>{h.title}</span>
                  </div>
                  <span className={`apps-tag ${r.tone}`}>{r.label}</span>
                  <span className="apps-row-act">
                    <button className="apps-link" onClick={() => onHistory(h.id)}>History</button>
                    {h.status === "FAILED"
                      ? <button className="apps-btn" onClick={() => onRetry(h.id)}>Retry</button>
                      : <button className="apps-btn accent" onClick={() => onReview(h.id)}>Review</button>}
                  </span>
                </li>
              );
            })}
          </OpsRows>
          {rows.length > OPS_PREVIEW && (
            <button className="apps-link" onClick={onToggle}>{expanded ? "Show fewer" : `View all needing review (${rows.length})`}</button>
          )}
        </>
      )}
    </section>
  );
}

/** The Applications console. Lives on apply.atriveo.com; the site supplies its own header. */
export default function Applications({ header }: { header?: React.ReactNode }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opsExpanded, setOpsExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getTailorServerBase()}/applications/analytics?days=${days}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [days]);

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

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.history ?? []).filter((h) => (filter === "ALL" || h.status === filter) && (!q || `${h.company} ${h.title} ${h.ats ?? ""}`.toLowerCase().includes(q)));
  }, [data, filter, query]);

  const attention = useMemo(() => {
    const rank = (h: HistoryRow) => (h.submitAttempted ? 0 : h.status === "NEEDS_REVIEW" ? 1 : 2);
    return (data?.history ?? [])
      .filter((h) => h.status === "NEEDS_REVIEW" || h.status === "FAILED")
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
  }, [data]);

  // In-flight first, then queued in the order the worker claims them (priority, then oldest first).
  const queue = useMemo(() => {
    const rank = (h: HistoryRow) => (h.status === "SUBMITTING" ? 0 : h.status === "APPLYING" ? 1 : 2);
    return (data?.history ?? [])
      .filter((h) => h.status === "READY_TO_APPLY" || h.status === "APPLYING" || h.status === "SUBMITTING")
      .sort((a, b) => rank(a) - rank(b) || (b.priority ?? 0) - (a.priority ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }, [data]);

  const openRow = openId ? attention.find((h) => h.id === openId && h.status === "NEEDS_REVIEW") ?? null : null;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const retry = (id: string) => void postAction({ action: "retry", applicationId: id }).then((r) => { setNotice(r.ok ? "Queued again." : r.error ?? "Failed"); void load(); });
  const done = (msg: string) => { setNotice(msg); setOpenId(null); void load(); };

  const k = data?.kpis;
  const cur = data?.current ?? null;
  const working = Boolean(cur);
  const today = data?.daily.at(-1);
  const needsVerify = (data?.accounts ?? []).filter((a) => a.status === "verify_email").length;

  return (
    <div className="apps-page">
      {header}
      <main className="apps-body">
        {error && <div className="apps-error">Couldn't load analytics: {error}. The Mac sidecar must be running (npm run tailor:restart).</div>}
        {!data && !error && <p className="apps-muted">Loading…</p>}

        {data && k && (
          <>
            <section className="apps-bar" aria-label="Engine status">
              <div className="apps-bar-top">
                <div className="apps-bar-title">
                  <h1>Application Engine</h1>
                  {data.worker && !data.worker.online
                    ? <span className="apps-state bad" title={`Last seen ${when(data.worker.updatedAt)}`}><i aria-hidden />Worker offline</span>
                    : <span className={`apps-state ${working ? "on" : ""}`} title={data.lastActivityAt ? `Last activity ${when(data.lastActivityAt)}` : undefined}><i aria-hidden />{working ? "Working" : "Idle"}</span>}
                  {data.worker && (
                    <span className={`apps-state ${data.worker.gmailConnected ? "" : "warn"}`} title={data.worker.gmailConnected ? "Emailed security codes and verification links are handled automatically" : "Run npm run apply:gmail-auth on the Mac so codes are entered automatically"}>
                      Gmail {data.worker.gmailConnected ? "connected" : "not connected"}
                    </span>
                  )}
                  {data.killSwitch && (
                    <span className={`apps-state ${data.killSwitch.enabled ? "" : "bad"}`} title={data.killSwitch.reason ?? undefined}>
                      Submissions {data.killSwitch.enabled ? "allowed" : `blocked${data.killSwitch.reason ? `: ${data.killSwitch.reason}` : ""}`}
                    </span>
                  )}
                </div>
                <button className="apps-refresh" onClick={() => void load()} aria-label="Refresh now">Updated {when(data.generatedAt)} <span aria-hidden>↻</span></button>
              </div>
              {cur && (
                <div className="apps-now">
                  <span className="apps-pulse" aria-hidden />
                  <CompanyLogo company={cur.company} size="sm" />
                  <span className="apps-now-id"><strong>{cur.company}</strong> {cur.title}</span>
                  <span className="apps-muted">
                    {cur.status === "SUBMITTING" ? "Submitting" : "Filling application"}
                    {stepLabel(cur.step) ? ` · ${stepLabel(cur.step)}` : ""}
                    {cur.attempt ? ` · attempt ${cur.attempt}` : ""}
                    {cur.startedAt ? ` · started ${clock(cur.startedAt)}` : ""}
                  </span>
                  <a href={cur.url} target="_blank" rel="noreferrer">Open ↗</a>
                </div>
              )}
              <div className="apps-stats">
                <Stat label="Jobs discovered" value={data.funnel[0]?.n ?? 0} sub={clock(data.lastAt?.discovered) ? `latest ${clock(data.lastAt?.discovered)}` : undefined} />
                <Stat label="Matched / resume ready" value={data.funnel[1]?.n ?? 0} sub={clock(data.lastAt?.matched) ? `latest ${clock(data.lastAt?.matched)}` : undefined} />
                <Stat label="Queued to apply" value={data.byStatus?.READY_TO_APPLY ?? 0} sub={clock(data.lastAt?.queued) ? `latest ${clock(data.lastAt?.queued)}` : undefined} />
                <Stat label="Submitted today" value={today?.applied ?? 0} tone={today?.applied ? "good" : undefined} sub={[`${k.applied} total`, clock(data.lastAt?.applied) && `last ${clock(data.lastAt?.applied)}`, duration(data.lastAt?.avgApplyMs) && `avg ${duration(data.lastAt?.avgApplyMs)}`].filter(Boolean).join(" · ")} />
                <Stat label="Need your review" value={k.needsReview} tone={k.needsReview ? "warn" : undefined} sub={clock(data.lastAt?.needsReview) ? `latest ${clock(data.lastAt?.needsReview)}` : undefined} />
                <Stat label="Failed" value={k.failed} tone={k.failed ? "bad" : undefined} sub={clock(data.lastAt?.failed) ? `latest ${clock(data.lastAt?.failed)}` : undefined} />
              </div>
            </section>

            <div className="apps-ops">
              <QueuePanel rows={queue} expanded={opsExpanded} onToggle={() => setOpsExpanded((v) => !v)} onHistory={setHistoryId} />
              <AttentionPanel rows={attention} expanded={opsExpanded} onToggle={() => setOpsExpanded((v) => !v)} onReview={setOpenId} onRetry={retry} onHistory={setHistoryId} />
            </div>

            <section className="apps-insights" aria-labelledby="ins-title">
              <div className="apps-insights-head">
                <h2 id="ins-title">Application insights</h2>
                <div className="apps-range" role="group" aria-label="Time range">
                  {[14, 30, 90].map((d) => <button key={d} className={d === days ? "active" : ""} onClick={() => setDays(d)}>{d}d</button>)}
                </div>
              </div>

              {data.inbox && (
                <Section title="Employer responses" hint={`Confirmations and rejections from your inbox, last ${data.inbox.days} days`}
                  meta={<><span>{data.inbox.confirmed} confirmed</span><span>{data.inbox.rejected} rejected</span>{data.inbox.confirm.length > 0 && <span className="warn">{data.inbox.confirm.length} to confirm</span>}</>}>
                  <EmployerResponses inbox={data.inbox} onDone={(m) => { setNotice(m); void load(); }} />
                </Section>
              )}
              {data.queueReport && (
                <Section title="Why jobs aren't being applied" hint="Every job with a resume, by the reason it isn't going to the engine"
                  meta={<><span>{data.queueReport.resumeReady} with a resume</span><span className={data.queueReport.autoQueue ? "" : "warn"}>auto-queue {data.queueReport.autoQueue ? "on" : "off"}</span></>}>
                  <QueueReasons report={data.queueReport} />
                </Section>
              )}
              <Section title="Pipeline" hint="Job funnel from discovery to submission" meta={<>{data.funnel.map((f) => <span key={f.stage}>{f.n} {f.stage.toLowerCase()}</span>)}</>}>
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
                <DailyChart days={data.daily} />
                <dl className="apps-status">
                  <dt>Success rate</dt><dd>{pct(k.successRate)} <span className="apps-muted">applied ÷ (applied + failed)</span></dd>
                  <dt>Skipped</dt><dd>{k.skipped}</dd>
                  <dt>Form patterns</dt>
                  <dd>{data.formTrust.trusted ?? 0} trusted · {data.formTrust.learning ?? 0} learning{data.formTrust.revoked ? ` · ${data.formTrust.revoked} revoked` : ""}</dd>
                  <dt>Job boards</dt>
                  <dd>{data.discovery.boards.map((b) => `${b.ats} ${b.boards} (${b.withMatches} with matches)`).join(" · ") || "—"}</dd>
                  <dt>Jobs by source</dt>
                  <dd>{data.discovery.jobsBySite.map((s) => `${s.site} ${s.n}`).join(" · ")}</dd>
                </dl>
              </Section>

              <Section title="Application history" hint="All applications and their status" meta={<><span>{k.total} total</span><span>{k.applied} applied</span><span>{k.needsReview} need review</span></>}>
                <div className="apps-filters">
                  {(["ALL", "APPLIED", "NEEDS_REVIEW", "FAILED", "SKIPPED", "READY_TO_APPLY"] as const).map((st) => (
                    <button key={st} className={filter === st ? "active" : ""} onClick={() => setFilter(st)}>{st === "ALL" ? "All" : STATUS_META[st].label}</button>
                  ))}
                  <input placeholder="Search company or role" aria-label="Search applications" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                {history.length === 0 ? <p className="apps-muted">No applications match.</p> : (
                  <>
                  <div className="apps-table-wrap apps-only-wide">
                    <table className="apps-table">
                      <thead><tr><th>Updated</th><th>Company</th><th>Role</th><th>ATS</th><th>Status</th><th>Details</th><th>Attempts</th><th /></tr></thead>
                      <tbody>{history.map((h) => (
                        <tr key={h.id}>
                          <td>{when(h.updatedAt)}</td>
                          <td>{h.company}</td>
                          <td>{h.title}</td>
                          <td>{h.ats ?? "—"}</td>
                          <td><StatusPill status={h.status} /> <OutcomePill outcome={h.outcome} /></td>
                          <td className="apps-detail">{detailOf(h)}</td>
                          <td>{h.attempts}</td>
                          <td className="apps-row-actions">
                            {h.status === "NEEDS_REVIEW" && <button className="apps-link" onClick={() => setOpenId(h.id)}>Review</button>}
                            {h.status === "FAILED" && <button className="apps-link" onClick={() => retry(h.id)}>Retry</button>}
                            <button className="apps-link" onClick={() => setHistoryId(h.id)}>History</button>
                            <a href={h.url} target="_blank" rel="noreferrer">Open</a>
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <ul className="apps-cards apps-only-narrow">
                    {history.map((h) => (
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
                  </>
                )}
              </Section>

              <Section title="ATS performance" hint="Application results by platform" meta={<><span>{data.byAts.length} platform{data.byAts.length === 1 ? "" : "s"}</span><span>{k.total} jobs</span></>}>
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
              </Section>

              <Section title="Questions & learned answers" hint="Questions that often need your input" meta={<span>{data.topPendingQuestions.length} categor{data.topPendingQuestions.length === 1 ? "y" : "ies"}</span>}>
                <h3>Why applications wait for you</h3>
                <BarList rows={data.reviewReasons.map((r) => ({ label: humanize(r.reason), n: r.n }))} empty="Nothing waiting for review." />
                <h3>Questions that most often need your answer</h3>
                <p className="apps-muted">Answer these once (Review) and they're remembered for future applications.</p>
                <BarList rows={data.topPendingQuestions.map((q) => ({ label: q.label, n: q.n }))} empty="No pending questions." />
              </Section>

              <Section title="Failures" hint="Failed applications by type" meta={<span>{k.failed ? `${k.failed} failed` : "No failures"}</span>}>
                <BarList rows={data.failureCodes.map((r) => ({ label: humanize(r.code), n: r.n }))} empty="No failures." />
              </Section>

              {data.accounts && data.accounts.length > 0 && (
                <Section title="Employer accounts" hint="Sign-ins the engine created" meta={<><span>{data.accounts.length} account{data.accounts.length === 1 ? "" : "s"}</span>{needsVerify > 0 && <span className="warn">{needsVerify} to verify</span>}</>}>
                  <AccountsCard accounts={data.accounts} />
                </Section>
              )}
            </section>
          </>
        )}
      </main>

      {historyId && data && (() => {
        const hr = data.history.find((h) => h.id === historyId);
        return hr ? <HistoryDrawer row={hr} onClose={() => setHistoryId(null)} /> : null;
      })()}
      {openRow && <ReviewDrawer row={openRow} onClose={closeDrawer} onDone={done} />}
      {notice && <p className="apps-toast" role="status">{notice}</p>}
    </div>
  );
}
