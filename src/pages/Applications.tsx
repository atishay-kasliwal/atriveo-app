import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import CompanyLogo from "../components/CompanyLogo";
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
  submittedBy: string | null; submittedAt: string | null; attempts: number; domain: string | null; url: string; updatedAt: string;
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
  worker?: { online: boolean; host: string | null; concurrency: number | null; gmailConnected: boolean; accountsEmail: string | null; updatedAt: string } | null;
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
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

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


const STAGES = ["Found", "Matched", "Resume", "Form", "Review", "Submit"] as const;
const STAGE_HINT = ["Job discovered", "Resume selected", "Resume ready", "Filling application", "Waiting if needed", "Not started"];

/** Stage index the application is at, from the engine's own status machine. */
function stageOf(status: Status): number {
  switch (status) {
    case "APPLYING": return 3;
    case "NEEDS_REVIEW": return 4;
    case "SUBMITTING": return 5;
    case "APPLIED": return 6;
    default: return 2;
  }
}

function Stages({ status }: { status: Status }) {
  const at = stageOf(status);
  return (
    <ol className="apps-stages" aria-label="Progress">
      {STAGES.map((name, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={name} className={`st ${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="st-dot" aria-hidden>{state === "done" ? "✓" : i + 1}</span>
            <span className="st-name">{name}</span>
            <span className="st-hint">{state === "now" ? (status === "SUBMITTING" ? "Submitting" : STAGE_HINT[i]) : state === "done" ? "Done" : "Upcoming"}</span>
          </li>
        );
      })}
    </ol>
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

/** Everything the engine did for one application: the resume used, each question with its answer and where it came from, and the timeline. */
function HistoryDrawer({ row, onClose }: { row: HistoryRow; onClose: () => void }) {
  useBodyLock();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

  return (
    <div className="apps-drawer-wrap">
      <div className="apps-scrim" onClick={onClose} />
      <aside className="apps-drawer wide" role="dialog" aria-modal="true" aria-label={`History for ${row.company}`} tabIndex={-1} ref={ref}>
        <span className="apps-handle" aria-hidden />
        <div className="apps-drawer-head">
          <CompanyLogo company={row.company} size="md" />
          <div className="apps-drawer-title"><strong>{row.company}</strong><span>{row.title}</span></div>
          <StatusPill status={row.status} />
          <button className="apps-x" onClick={onClose} aria-label="Close history">✕</button>
        </div>
        <div className="apps-drawer-body apps-hist">
          {error && <p className="apps-error">Couldn't load the history: {error}</p>}
          {!detail && !error && <p className="apps-muted">Loading…</p>}
          {detail && (
            <>
              <section>
                <h3>Resume used</h3>
                {detail.resume.fileName ? (
                  <dl className="apps-status">
                    <dt>File</dt><dd>{detail.resume.fileName} <span className="apps-muted">{bytesLabel(detail.resume.bytes)}</span></dd>
                    <dt>Verified</dt><dd>{detail.resume.verifiedAt ? when(detail.resume.verifiedAt) : "—"}{detail.resume.sha256 ? <span className="apps-muted"> · sha256 {detail.resume.sha256.slice(0, 12)}…</span> : null}</dd>
                    {detail.resume.sourceJobUrl && <><dt>Made for</dt><dd><a href={detail.resume.sourceJobUrl} target="_blank" rel="noreferrer">The tailored job ↗</a></dd></>}
                    {detail.resume.path && <><dt>On your Mac</dt><dd><code>{detail.resume.path}</code></dd></>}
                  </dl>
                ) : <p className="apps-muted">No resume recorded yet.</p>}
              </section>

              <section>
                <div className="apps-card-head">
                  <h3>Questions and answers <span className="apps-count">{answered}/{detail.questions.length}</span></h3>
                  <input className="apps-hist-search" placeholder="Filter" aria-label="Filter questions" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                {qs.length === 0 ? <p className="apps-muted">No questions recorded.</p> : (
                  <ul className="apps-qa">
                    {qs.map((q, i) => {
                      const a = answerText(q);
                      return (
                        <li key={`${q.label}-${i}`}>
                          <div className="apps-qa-q">{q.label}{q.required ? " *" : ""}{q.sensitive ? <em> · {q.sensitive.replace(/_/g, " ")}</em> : null}</div>
                          <div className={`apps-qa-a ${a.muted ? "muted" : ""}`}>{a.text}</div>
                          <div className="apps-qa-meta">
                            <span>{q.source}</span>
                            {q.resolution === "answered" && <span className={q.verified ? "ok" : "warn"}>{q.verified ? "✓ read back from the form" : "not read back"}</span>}
                            {q.resolution === "needs_review" && <span className="warn">needs your answer</span>}
                            {q.detail && q.resolution !== "answered" ? <span>{q.detail}</span> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section>
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
            </>
          )}
        </div>
      </aside>
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

function CurrentActivity({ data }: { data: Analytics }) {
  const cur = data.current ?? null;
  const queued = data.byStatus?.READY_TO_APPLY ?? 0;
  return (
    <section className="apps-panel" aria-labelledby="act-title">
      <div className="apps-panel-head">
        <h2 id="act-title">Current activity</h2>
        {cur?.startedAt && <span className="apps-muted">Started {when(cur.startedAt)}</span>}
      </div>
      {cur ? (
        <div className="apps-activity">
          <div className="apps-activity-top">
            <CompanyLogo company={cur.company} size="lg" />
            <div className="apps-activity-id">
              <strong>{cur.company}</strong>
              <span>{cur.title}</span>
              <span className="apps-muted">{cur.ats ?? "unknown ATS"} · <a href={cur.url} target="_blank" rel="noreferrer">Open ↗</a></span>
            </div>
            <span className="apps-tag active">{cur.status === "SUBMITTING" ? "Submitting" : "Applying"}</span>
          </div>
          <Stages status={cur.status} />
          <p className="apps-activity-line">
            <span className="apps-pulse" aria-hidden />
            {cur.status === "SUBMITTING" ? "Submitting application" : "Filling application"}
            {stepLabel(cur.step) ? <span className="apps-muted"> · {stepLabel(cur.step)}</span> : null}
            {cur.attempt ? <span className="apps-muted"> · attempt {cur.attempt}</span> : null}
          </p>
        </div>
      ) : (
        <div className="apps-idle">
          <p><strong>Idle.</strong> No application is being filled right now.</p>
          <p className="apps-muted">
            {queued > 0 ? `${queued} queued; the worker picks up the next one on its next cycle.` : "Nothing is queued."}
            {data.lastActivityAt ? ` Last activity ${when(data.lastActivityAt)}.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function AttentionPanel({ rows, onReview, onRetry, onHistory }: { rows: HistoryRow[]; onReview: (id: string) => void; onRetry: (id: string) => void; onHistory: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <section className={`apps-panel is-attn ${rows.length ? "has-items" : ""}`} aria-labelledby="attn-title">
      <div className="apps-panel-head">
        <h2 id="attn-title">Needs your attention {rows.length > 0 && <span className="apps-count warn">{rows.length}</span>}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="apps-clear">Nothing is waiting for you.</p>
      ) : (
        <>
          <ul className="apps-rows">
            {shown.map((h) => {
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
          </ul>
          {rows.length > 4 && (
            <button className="apps-link" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `View all needing review (${rows.length})`}</button>
          )}
        </>
      )}
    </section>
  );
}

export default function Applications() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const openRow = openId ? attention.find((h) => h.id === openId && h.status === "NEEDS_REVIEW") ?? null : null;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const retry = (id: string) => void postAction({ action: "retry", applicationId: id }).then((r) => { setNotice(r.ok ? "Queued again." : r.error ?? "Failed"); void load(); });
  const done = (msg: string) => { setNotice(msg); setOpenId(null); void load(); };

  const k = data?.kpis;
  const working = Boolean(data?.current);
  const today = data?.daily.at(-1);
  const needsVerify = (data?.accounts ?? []).filter((a) => a.status === "verify_email").length;

  return (
    <div className="apps-page">
      <AppHeader />
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
                    : <span className={`apps-state ${working ? "on" : ""}`}><i aria-hidden />{working ? "Working" : "Idle"}</span>}
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
              <div className="apps-stats">
                <Stat label="Jobs discovered" value={data.funnel[0]?.n ?? 0} />
                <Stat label="Matched / resume ready" value={data.funnel[1]?.n ?? 0} />
                <Stat label="Queued to apply" value={data.byStatus?.READY_TO_APPLY ?? 0} />
                <Stat label="Submitted today" value={today?.applied ?? 0} tone={today?.applied ? "good" : undefined} sub={`${k.applied} total`} />
                <Stat label="Need your review" value={k.needsReview} tone={k.needsReview ? "warn" : undefined} />
                <Stat label="Failed" value={k.failed} tone={k.failed ? "bad" : undefined} />
              </div>
            </section>

            <div className="apps-ops">
              <CurrentActivity data={data} />
              <AttentionPanel rows={attention} onReview={setOpenId} onRetry={retry} onHistory={setHistoryId} />
            </div>

            <section className="apps-insights" aria-labelledby="ins-title">
              <div className="apps-insights-head">
                <h2 id="ins-title">Application insights</h2>
                <div className="apps-range" role="group" aria-label="Time range">
                  {[14, 30, 90].map((d) => <button key={d} className={d === days ? "active" : ""} onClick={() => setDays(d)}>{d}d</button>)}
                </div>
              </div>

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
                          <td><StatusPill status={h.status} /></td>
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
