import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import { getTailorServerBase } from "../utils/tailorServer";
import "../styles/applications.css";

// Application engine analytics (playatriveo): history, outcomes and what needs you.
// Data: GET /tailor/applications/analytics → Mac sidecar → Mongo (read-only).

type Status = "READY_TO_APPLY" | "APPLYING" | "NEEDS_REVIEW" | "SUBMITTING" | "APPLIED" | "FAILED" | "SKIPPED";

interface Day { day: string; queued: number; applied: number; needsReview: number; failed: number; skipped: number }
interface HistoryRow {
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

function DailyChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<Day | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.applied + d.needsReview + d.failed + d.skipped));
  const W = 720, H = 180, pad = 24, gap = 2;
  const bw = Math.max(4, (W - pad) / days.length - 4);
  return (
    <div className="apps-card apps-wide">
      <div className="apps-card-head">
        <h2>Outcomes per day</h2>
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

export default function Applications() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [query, setQuery] = useState("");

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

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.history ?? []).filter((h) => (filter === "ALL" || h.status === filter) && (!q || `${h.company} ${h.title} ${h.ats ?? ""}`.toLowerCase().includes(q)));
  }, [data, filter, query]);

  const k = data?.kpis;
  return (
    <div className="apps-page">
      <AppHeader />
      <main className="apps-body">
        <header className="apps-head">
          <div>
            <p className="apps-kicker">Application engine</p>
            <h1>Applications</h1>
            <p className="apps-sub">Every application the engine has touched: outcomes, what needs you, and the pipeline behind it.{data && ` Updated ${when(data.generatedAt)}.`}</p>
          </div>
          <div className="apps-range" role="group" aria-label="Time range">
            {[14, 30, 90].map((d) => <button key={d} className={d === days ? "active" : ""} onClick={() => setDays(d)}>{d}d</button>)}
          </div>
        </header>

        {error && <div className="apps-error">Couldn't load analytics: {error}. The Mac sidecar must be running (npm run tailor:restart).</div>}
        {!data && !error && <p className="apps-empty">Loading…</p>}

        {data && k && (
          <>
            <section className="apps-kpis">
              <div className="apps-kpi"><span className="apps-kpi-label"><span className="st-good-ink" aria-hidden>✓</span> Applied</span><strong>{k.applied}</strong></div>
              <div className="apps-kpi"><span className="apps-kpi-label"><span className="st-warning-ink" aria-hidden>!</span> Needs review</span><strong>{k.needsReview}</strong></div>
              <div className="apps-kpi"><span className="apps-kpi-label"><span className="st-critical-ink" aria-hidden>✕</span> Failed</span><strong>{k.failed}</strong></div>
              <div className="apps-kpi"><span className="apps-kpi-label">– Skipped</span><strong>{k.skipped}</strong></div>
              <div className="apps-kpi"><span className="apps-kpi-label">… In progress</span><strong>{k.inProgress}</strong></div>
              <div className="apps-kpi"><span className="apps-kpi-label">Success rate</span><strong>{pct(k.successRate)}</strong><small>applied ÷ (applied + failed)</small></div>
            </section>

            <section className="apps-grid">
              <div className="apps-card">
                <h2>Pipeline funnel</h2>
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
              </div>
              <div className="apps-card">
                <h2>Engine status</h2>
                <dl className="apps-status">
                  <dt>Submissions</dt>
                  <dd>{data.killSwitch?.enabled ? <span className="apps-pill st-good">✓ Allowed (review mode)</span> : <span className="apps-pill st-critical">✕ Blocked{data.killSwitch?.reason ? `: ${data.killSwitch.reason}` : ""}</span>}</dd>
                  <dt>Form patterns</dt>
                  <dd>{data.formTrust.trusted ?? 0} trusted · {data.formTrust.learning ?? 0} learning{data.formTrust.revoked ? ` · ${data.formTrust.revoked} revoked` : ""}</dd>
                  <dt>Job boards</dt>
                  <dd>{data.discovery.boards.map((b) => `${b.ats} ${b.boards} (${b.withMatches} with matches)`).join(" · ") || "—"}</dd>
                  <dt>Jobs by source</dt>
                  <dd>{data.discovery.jobsBySite.map((s) => `${s.site} ${s.n}`).join(" · ")}</dd>
                </dl>
              </div>
            </section>

            <DailyChart days={data.daily} />

            <section className="apps-grid">
              <div className="apps-card">
                <h2>Why applications wait for you</h2>
                <BarList rows={data.reviewReasons.map((r) => ({ label: humanize(r.reason), n: r.n }))} empty="Nothing waiting for review." />
              </div>
              <div className="apps-card">
                <h2>Failures by type</h2>
                <BarList rows={data.failureCodes.map((r) => ({ label: humanize(r.code), n: r.n }))} empty="No failures." />
              </div>
              <div className="apps-card apps-wide">
                <h2>Questions that most often need your answer</h2>
                <p className="apps-sub">Answer these once in the review console (npm run apply -- --application &lt;id&gt;) and they're remembered.</p>
                <BarList rows={data.topPendingQuestions.map((q) => ({ label: q.label, n: q.n }))} empty="No pending questions." />
              </div>
              <div className="apps-card apps-wide">
                <h2>By ATS</h2>
                <div className="apps-table-wrap"><table className="apps-table">
                  <thead><tr><th>ATS</th><th>Total</th><th>✓ Applied</th><th>! Needs review</th><th>✕ Failed</th><th>– Skipped</th><th>In progress</th></tr></thead>
                  <tbody>{data.byAts.map((a) => (
                    <tr key={a.ats}><td>{a.ats}</td><td>{a.total}</td><td>{a.APPLIED}</td><td>{a.NEEDS_REVIEW}</td><td>{a.FAILED}</td><td>{a.SKIPPED}</td><td>{a.other}</td></tr>
                  ))}</tbody>
                </table></div>
              </div>
            </section>

            <section className="apps-card apps-wide">
              <div className="apps-card-head">
                <h2>History</h2>
                <div className="apps-filters">
                  {(["ALL", "APPLIED", "NEEDS_REVIEW", "FAILED", "SKIPPED", "READY_TO_APPLY"] as const).map((s) => (
                    <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>{s === "ALL" ? "All" : STATUS_META[s].label}</button>
                  ))}
                  <input placeholder="Search company or role" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              </div>
              {history.length === 0 ? <p className="apps-empty">No applications match.</p> : (
                <div className="apps-table-wrap">
                  <table className="apps-table">
                    <thead><tr><th>Updated</th><th>Company</th><th>Role</th><th>ATS</th><th>Status</th><th>Details</th><th>Attempts</th><th /></tr></thead>
                    <tbody>{history.map((h) => (
                      <tr key={h.id}>
                        <td>{when(h.updatedAt)}</td>
                        <td>{h.company}</td>
                        <td>{h.title}</td>
                        <td>{h.ats ?? "—"}</td>
                        <td><StatusPill status={h.status} /></td>
                        <td className="apps-detail">
                          {h.status === "NEEDS_REVIEW" && <>{humanize(h.reviewReason ?? "")}{h.pending.length ? ` · ${h.pending.length} question(s)` : ""}</>}
                          {h.status === "FAILED" && <>{humanize(h.failureCode ?? "")}{h.failureMessage ? ` — ${h.failureMessage}` : ""}</>}
                          {h.status === "APPLIED" && <>by {h.submittedBy ?? "engine"} · {when(h.submittedAt)}</>}
                        </td>
                        <td>{h.attempts}</td>
                        <td><a href={h.url} target="_blank" rel="noreferrer">Open</a></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <p className="apps-sub">Review one: <code>npm run apply -- --application &lt;id&gt;</code> · ids: {history.slice(0, 1).map((h) => h.id).join("")}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
