import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import { getTailorServerBase } from "../utils/tailorServer";
import { getJson } from "./engine";
import "./applied.css";

type Outcome = "assessment" | "interview" | "offer" | "rejected";
interface Row {
  key: string; jobUrl: string | null; company: string; title: string; location: string | null; source: string | null; appliedAt: string; via: string;
  postingUrl: string | null; applyUrl: string | null; resume: { path: string | null; sha256: string | null };
  foundAt: string | null; resumeAt: string | null; outcome: { status: Outcome; at: string | null } | null; confirmed: boolean; mailCount?: number;
  mail?: { at: string | null; kind: Outcome; subject: string | null }[];
}
interface List { ok: true; total: number; counts: Record<string, number>; last7: number; allTime: number; rows: Row[] }
const FILTERS: [string, string][] = [["all", "All"], ["replied", "Replies"], ["interview", "Interviews"], ["assessment", "Assessments"], ["offer", "Offers"], ["rejected", "Rejected"], ["none", "No reply"]];
const LABEL: Record<Outcome, string> = { assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const PAGE = 40;

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const ago = (iso: string, now = Date.now()) => { const d = Math.floor((now - Date.parse(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
function weekLabel(iso: string, now = Date.now()) {
  const start = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const diff = Math.round((start(now) - start(Date.parse(iso))) / (7 * 86400000));
  if (diff <= 0) return "This week"; if (diff === 1) return "Last week";
  const s = new Date(start(Date.parse(iso))), e = new Date(s.getTime() + 6 * 86400000);
  return `${day(s.toISOString())} – ${day(e.toISOString())}`;
}
const resumeHref = (r: Row) => r.resume.sha256 ? `${getTailorServerBase()}/applications/resume-file?sha=${r.resume.sha256}&kind=pdf` : r.resume.path ? `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(r.resume.path)}` : null;
function Status({ r }: { r: Row }) {
  if (r.outcome) return <span className={`ap-status is-${r.outcome.status}`}><i />{LABEL[r.outcome.status]}{r.outcome.at ? <small> · {ago(r.outcome.at)}</small> : null}</span>;
  return <span className="ap-status is-none"><i />{r.confirmed ? "Confirmed" : "No reply yet"}<small> · {ago(r.appliedAt)}</small></span>;
}

function ListView({ header }: { header?: ReactNode }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Pick<List, "total" | "counts" | "last7" | "allTime"> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (skip: number, replace: boolean) => {
    setBusy(true); setError("");
    try {
      const r = await getJson<List>(`/applications/applied?${new URLSearchParams({ outcome: filter, q: q.trim(), skip: String(skip), limit: String(PAGE) })}`);
      setMeta({ total: r.total, counts: r.counts, last7: r.last7, allTime: r.allTime });
      setRows((cur) => (replace ? r.rows : [...cur, ...r.rows]));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [filter, q]);
  useEffect(() => { const t = setTimeout(() => void load(0, true), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  const groups = useMemo(() => { const out: [string, Row[]][] = []; for (const r of rows) { const w = weekLabel(r.appliedAt); const last = out[out.length - 1]; if (last && last[0] === w) last[1].push(r); else out.push([w, [r]]); } return out; }, [rows]);
  return (
    <div className="rv-page ap-page">
      {header}
      <main className="ap-main">
        <div className="ap-title">
          <div><h1>Applied</h1><p>{meta ? <><b>{meta.allTime}</b> applications · <b>{meta.last7}</b> in the last 7 days</> : "Everything you have applied to"}</p></div>
          <input className="ap-search" type="search" placeholder="Search company or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search applied jobs" />
        </div>
        <nav className="ap-filters" aria-label="Filter by reply">
          {FILTERS.map(([key, label]) => <button key={key} type="button" className={filter === key ? "on" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{meta ? <small>{meta.counts[key] ?? 0}</small> : null}</button>)}
        </nav>
        {error && <p className="ap-error" role="alert">{error} <button type="button" className="apps-link" onClick={() => void load(0, true)}>Retry</button></p>}
        {!error && !busy && rows.length === 0 && <p className="ap-empty">{q || filter !== "all" ? "Nothing matches this filter." : "Nothing applied yet. Applications show here once you apply or mark a job applied."}</p>}
        {groups.map(([week, items]) => (
          <section key={week} className="ap-group" aria-label={week}>
            <h2>{week}<small>{items.length}</small></h2>
            <ul>
              {items.map((r) => (
                <li key={r.key}>
                  <Link to={`/applied/${encodeURIComponent(r.key)}`} className="ap-row">
                    <CompanyLogo company={r.company} size="md" />
                    <span className="ap-who"><b>{r.company || "Unknown company"}</b><span>{r.title}</span></span>
                    <span className="ap-where">{r.location || r.via}</span>
                    <Status r={r} />
                    <time dateTime={r.appliedAt} title={new Date(r.appliedAt).toLocaleString()}>{day(r.appliedAt)}</time>
                    <span className="ap-go" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {meta && rows.length < meta.total && <button type="button" className="apps-btn ap-more" onClick={() => void load(rows.length, false)} disabled={busy}>{busy ? "Loading…" : `Show more (${meta.total - rows.length})`}</button>}
      </main>
    </div>
  );
}

function DetailView({ id, header }: { id: string; header?: ReactNode }) {
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setRow(null); setError(""); getJson<{ row: Row }>(`/applications/applied?key=${encodeURIComponent(id)}`).then((r) => setRow(r.row), (e) => setError(e instanceof Error ? e.message : String(e))); }, [id]);
  const steps = useMemo(() => {
    if (!row) return [];
    const out: { at: string | null; title: string; detail?: string; tone?: string }[] = [];
    if (row.foundAt) out.push({ at: row.foundAt, title: "Found", detail: row.source ? `On ${row.source}` : undefined });
    if (row.resumeAt) out.push({ at: row.resumeAt, title: "Resume tailored", detail: "Built for this posting" });
    out.push({ at: row.appliedAt, title: "Applied", detail: row.via, tone: "applied" });
    if (row.confirmed) out.push({ at: null, title: "Employer confirmed receipt", tone: "confirmed" });
    for (const m of row.mail ?? []) out.push({ at: m.at, title: LABEL[m.kind], detail: m.subject ?? undefined, tone: m.kind });
    return out;
  }, [row]);
  const href = row ? resumeHref(row) : null;
  return (
    <div className="rv-page ap-page">
      {header}
      <main className="ap-main ap-detail">
        <Link to="/applied" className="ap-back">← All applied</Link>
        {error && <p className="ap-error" role="alert">{error}</p>}
        {!row && !error && <p className="ap-empty">Loading…</p>}
        {row && (
          <>
            <div className="ap-dhead">
              <CompanyLogo company={row.company} size="lg" />
              <div><span>{row.company}</span><h1>{row.title}</h1><p>{[row.location, `Applied ${day(row.appliedAt)}`, row.via].filter(Boolean).join(" · ")}</p></div>
              <Status r={row} />
            </div>
            <div className="ap-actions">
              {row.postingUrl && <a className="apps-btn" href={row.postingUrl} target="_blank" rel="noreferrer">Job posting ↗</a>}
              {row.applyUrl && <a className="apps-btn" href={row.applyUrl} target="_blank" rel="noreferrer">Application page ↗</a>}
              {href && <a className="apps-btn" href={href} target="_blank" rel="noreferrer">Resume PDF ↗</a>}
            </div>
            <ol className="ap-timeline" aria-label="History">
              {steps.map((s, i) => (
                <li key={i} className={s.tone ? `is-${s.tone}` : ""}>
                  <i aria-hidden="true" />
                  <div><b>{s.title}</b>{s.detail && <span>{s.detail}</span>}</div>
                  {s.at && <time dateTime={s.at}>{new Date(s.at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</time>}
                </li>
              ))}
              {!row.outcome && <li className="is-wait"><i aria-hidden="true" /><div><b>No reply yet</b><span>{ago(row.appliedAt)}. Replies from the employer appear here when your inbox watcher links them.</span></div></li>}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}

export default function AppliedPage({ header }: { header?: ReactNode }) {
  const path = useLocation().pathname.replace(/\/+$/, "");
  const id = path.startsWith("/applied/") ? decodeURIComponent(path.slice("/applied/".length)) : "";
  return id ? <DetailView id={id} header={header} /> : <ListView header={header} />;
}
