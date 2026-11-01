import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { getTailorServerBase } from "../utils/tailorServer";
import { fetchJson, getJson, type ApiBody } from "./engine";
import { markRepliesSeen } from "./phoneSeen";
import "./phone.css";

// Activity on a phone: what happened, newest first — replies (from your inbox watcher or your own mark) and what you
// applied to. Tap one for its mail and to mark what happened yourself.

type Outcome = "assessment" | "interview" | "offer" | "rejected";
interface Row {
  key: string; company: string; title: string; location: string | null; appliedAt: string; via: string; postingUrl: string | null;
  outcome: { status: Outcome; at: string | null; manual?: boolean } | null; mailCount?: number; mail?: { at: string | null; kind: Outcome; subject: string | null }[];
}
interface List { counts: Record<string, number>; last7: number; rows: Row[] }
interface Item { id: string; kind: Outcome | "applied"; at: string; row: Row }

const LABEL: Record<Item["kind"], string> = { applied: "Applied", assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const MARKS: Outcome[] = ["interview", "assessment", "offer", "rejected"];
const DAYS = 30;

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(t) - start(d)) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function itemsFrom(replied: Row[], recent: Row[]): Item[] {
  const since = Date.now() - DAYS * 86_400_000, out = new Map<string, Item>();
  for (const r of replied) if (r.outcome?.at && Date.parse(r.outcome.at) >= since) out.set(`${r.key}:o`, { id: `${r.key}:o`, kind: r.outcome.status, at: r.outcome.at, row: r });
  for (const r of recent) if (Date.parse(r.appliedAt) >= since) out.set(`${r.key}:a`, { id: `${r.key}:a`, kind: "applied", at: r.appliedAt, row: r });
  return [...out.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const fetchActivity = () => Promise.all([
  getJson<List>("/applications/applied?outcome=replied&q=&skip=0&limit=100"),
  getJson<List>("/applications/applied?outcome=all&q=&skip=0&limit=40"),
]);

async function setOutcome(key: string, status: Outcome | "clear"): Promise<void> {
  const { res, json } = await fetchJson<ApiBody>(`${getTailorServerBase()}/applications/applied-outcome`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, status }) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `Not saved (${res.status})`);
}

export default function PhoneActivity({ header }: { header: ReactNode }) {
  const search = useLocation().search;
  const [onlyReplies, setOnlyReplies] = useState(() => new URLSearchParams(search).get("show") === "replies");
  const [replied, setReplied] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ replied: number; last7: number } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const show = useCallback(([r, a]: [List, List]) => {
    setReplied(r.rows); setRecent(a.rows); setMeta({ replied: r.counts.replied ?? 0, last7: a.last7 ?? 0 }); setError("");
    markRepliesSeen(r.counts.replied ?? 0);
  }, []);
  const load = useCallback(() => fetchActivity().then(show, (e) => setError(e instanceof Error ? e.message : String(e))), [show]);
  useEffect(() => {
    let alive = true;
    fetchActivity().then((x) => { if (alive) show(x); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [show]);

  const items = useMemo(() => (replied && recent ? itemsFrom(replied, onlyReplies ? [] : recent) : null), [replied, recent, onlyReplies]);
  const groups = useMemo(() => {
    const g: { day: string; items: Item[] }[] = [];
    for (const it of items ?? []) { const day = dayLabel(it.at); if (g.at(-1)?.day !== day) g.push({ day, items: [] }); g.at(-1)!.items.push(it); }
    return g;
  }, [items]);

  // After a mark, show it at once; the next load brings what the server worked out.
  const marked = (row: Row, status: Outcome | "clear") => {
    const next: Row = { ...row, outcome: status === "clear" ? null : { status, at: new Date().toISOString(), manual: true } };
    setReplied((rs) => { const rest = (rs ?? []).filter((r) => r.key !== row.key); return next.outcome ? [next, ...rest] : rest; });
    setRecent((rs) => (rs ?? []).map((r) => (r.key === row.key ? next : r)));
    setOpen((o) => (o && o.key === row.key ? { ...next, mail: o.mail } : o));
    if (status === "clear") void load();
  };

  return (
    <div className="ph-page">
      {header}
      <main className="ph-activity">
        <div className="ph-seg ph-seg-2" role="tablist" aria-label="What to show">
          <button type="button" role="tab" aria-selected={!onlyReplies} onClick={() => setOnlyReplies(false)}>Everything</button>
          <button type="button" role="tab" aria-selected={onlyReplies} onClick={() => setOnlyReplies(true)}>Replies{meta ? ` · ${meta.replied}` : ""}</button>
        </div>
        {meta && <p className="ph-triage-count">{meta.last7} applied this week · last {DAYS} days below</p>}
        {error && !items && <div className="ph-empty"><strong>Couldn't load activity</strong><span>{error}</span><button type="button" className="ph-btn" onClick={() => void load()}>Try again</button></div>}
        {!items && !error && <p className="ph-triage-count">Loading…</p>}
        {items && !items.length && <div className="ph-empty"><strong>Nothing yet</strong><span>{onlyReplies ? "No replies in the last 30 days." : "Nothing in the last 30 days."}</span></div>}
        {groups.map((g) => (
          <section key={g.day} className="ph-day" aria-label={g.day}>
            <h2>{g.day}</h2>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <button type="button" className={`ph-event is-${it.kind}`} onClick={() => setOpen(it.row)}>
                    <i aria-hidden="true" />
                    <span className="ph-event-main">
                      <b>{it.row.company || "Unknown company"}</b>
                      <small>{it.row.title}</small>
                    </span>
                    <span className="ph-event-side"><em>{LABEL[it.kind]}{it.kind !== "applied" && it.row.outcome?.manual ? " ✓" : ""}</em><small>{time(it.at)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      {open && <ActivitySheet row={open} onClose={() => setOpen(null)} onMarked={marked} />}
    </div>
  );
}

function ActivitySheet({ row, onClose, onMarked }: { row: Row; onClose: () => void; onMarked: (row: Row, status: Outcome | "clear") => void }) {
  const [mail, setMail] = useState<Row["mail"] | null>(row.mail ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    getJson<{ row: Row }>(`/applications/applied?key=${encodeURIComponent(row.key)}`).then((r) => { if (alive) setMail(r.row.mail ?? []); }, () => { if (alive) setMail([]); });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { alive = false; document.removeEventListener("keydown", key); };
  }, [row.key, onClose]);

  const mark = async (status: Outcome | "clear") => {
    setBusy(true); setNote("");
    try { await setOutcome(row.key, status); onMarked(row, status); setNote(status === "clear" ? "Your mark is cleared." : `Marked ${LABEL[status].toLowerCase()}.`); }
    catch (e) { setNote(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="ph-sheet-wrap" onClick={onClose}>
      <div className="ph-sheet ph-posting" role="dialog" aria-modal="true" aria-label={`${row.company}: ${row.title}`} onClick={(e) => e.stopPropagation()}>
        <i className="ph-grab" aria-hidden="true" />
        <p className="ph-company">{row.company}</p>
        <h2>{row.title}</h2>
        <p className="ph-meta">{[row.location, `Applied ${dayLabel(row.appliedAt).toLowerCase()}`, row.via].filter(Boolean).join(" · ")}</p>
        <h3>From the employer</h3>
        {mail == null ? <p className="ph-meta">Loading…</p> : mail.length ? (
          <ul className="ph-mail">{mail.slice().reverse().map((m, i) => <li key={i}><b>{LABEL[m.kind]}</b><span>{m.subject || "(no subject)"}</span>{m.at && <small>{dayLabel(m.at)}</small>}</li>)}</ul>
        ) : <p className="ph-meta">No mail linked to this one yet.</p>}
        <h3>What happened?</h3>
        <div className="ph-marks" role="group" aria-label="Mark what happened">
          {MARKS.map((s) => <button key={s} type="button" className="ph-btn" aria-pressed={row.outcome?.status === s} disabled={busy} onClick={() => void mark(s)}>{LABEL[s]}</button>)}
        </div>
        {row.outcome?.manual && <button type="button" className="ph-btn ph-clear" disabled={busy} onClick={() => void mark("clear")}>Clear my mark</button>}
        <p className="ph-note" role="status">{note}</p>
        {row.postingUrl && <a className="ph-btn" href={row.postingUrl} target="_blank" rel="noreferrer">Open the posting</a>}
      </div>
    </div>
  );
}
