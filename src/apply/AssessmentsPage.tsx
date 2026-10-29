import { useLocation } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchJson, getJson, type ApiBody } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";
import "./assessments.css";

interface Row { id: string; company: string; subject: string; receivedAt: string; deadlineAt: string | null; deadlineText: string | null; deadlineSource: "mail" | "you" | null; state: "unknown" | "overdue" | "today" | "soon" | "later"; when: string }
const TZ = "America/New_York";
const STATE_LABEL: Record<Row["state"], string> = { unknown: "Needs a deadline", overdue: "Overdue", today: "Due today", soon: "Due soon", later: "Later" };

/** The wall clock in New York as an input value ("2026-10-30T23:59"), and back to the real moment. */
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const shown = (iso: string) => { const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export function nyToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const want = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = want;
  for (let i = 0; i < 3; i += 1) { const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value])); guess += want - Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!); }
  return new Date(guess).toISOString();
}
const received = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const absolute = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function update(body: object) {
  const { res, json } = await fetchJson<ApiBody>(`${getTailorServerBase()}/applications/assessment-update`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
}

const DAY = 86_400_000, SPAN_DAYS = 8;
const URGENT: Record<Row["state"], string> = { unknown: "#f0b75e", overdue: "#ee5d52", today: "#ee5d52", soon: "#f0b75e", later: "#2fb87a" };
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
/** 2d 4h, 11h 24m, 42m 10s: the time left, in the largest two units that matter. */
export function countdown(ms: number): string {
  if (ms <= 0) return "Overdue";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d >= 1 ? `${d}d ${h}h` : h >= 1 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Assessments waiting on you: a live countdown to the next one, a seven-day runway showing where each lands, and the list to act on. */
export default function AssessmentsPage({ header }: { header?: ReactNode }) {
  const { hash } = useLocation();
  const handledHash = useRef('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const d = await getJson<{ rows: Row[] }>("/applications/assessments"); setRows(d.rows); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { const t = window.setInterval(() => document.visibilityState === "visible" && setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!rows || !hash || handledHash.current === hash) return;
    let id: string; try { id = decodeURIComponent(hash.slice(1)).replace(/^as-/, ''); } catch { return; }
    if (!rows.some(r => r.id === id)) return;
    const element = document.getElementById(`as-${id}`); if (!element) return;
    handledHash.current = hash; setFocus(id);
    element.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }, [rows,hash]);
  const run = async (what: () => Promise<void>, ok: string) => { try { await what(); setNotice(ok); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } };
  const save = (r: Row) => { const iso = nyToIso(edit[r.id] ?? ""); if (!iso) { setNotice("Pick a date and time first."); return; } void run(() => update({ id: r.id, deadlineAt: iso }), `Deadline saved for ${r.company || "the assessment"}.`).then(() => setEdit((e) => { const n = { ...e }; delete n[r.id]; return n; })); };

  const view = useMemo(() => {
    const list = rows ?? [];
    const dated = list.filter((r) => r.deadlineAt).sort((a, b) => Date.parse(a.deadlineAt!) - Date.parse(b.deadlineAt!));
    const next = dated.find((r) => Date.parse(r.deadlineAt!) > now) ?? null;
    const unknown = list.filter((r) => !r.deadlineAt);
    const startIso = nyToIso(`${dayKey(now)}T00:00`) ?? new Date(now).toISOString(), start = Date.parse(startIso);
    const days = Array.from({ length: SPAN_DAYS }, (_, i) => { const at = start + i * DAY + DAY / 2; return { label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(at).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }) }; });
    const pins = dated.map((r, i) => { const x = Math.min(99, Math.max(1, ((Date.parse(r.deadlineAt!) - start) / (SPAN_DAYS * DAY)) * 100)); return { r, x, lane: i % 3, clipped: Date.parse(r.deadlineAt!) > start + SPAN_DAYS * DAY }; });
    const nowX = Math.min(100, Math.max(0, ((now - start) / (SPAN_DAYS * DAY)) * 100));
    return { list, next, unknown, days, pins, nowX };
  }, [rows, now]);

  const left = view.next ? Date.parse(view.next.deadlineAt!) - now : 0;
  const span = view.next ? Math.max(1, Date.parse(view.next.deadlineAt!) - Date.parse(view.next.receivedAt)) : 1;
  const remaining = view.next ? Math.min(1, Math.max(0, left / span)) : 0;
  const tone = view.next ? (left < DAY ? URGENT.today : left < 3 * DAY ? URGENT.soon : URGENT.later) : "#4a505b";
  const R = 92, C = 2 * Math.PI * R;
  return (
    <div className="rv-page as-page">
      {header}
      <main className="as-main">
        <div className="as-title"><div><h1>Assessments</h1><p>Read from your mail within 15 minutes of arrival. Times are New York. A phone message at 9 a.m. lists what is due, and at 3 p.m. one more for anything due that day.</p></div>{rows && <div className="as-count"><b>{rows.length}</b><span>waiting</span></div>}</div>
        {error && <p className="as-note" role="alert">Could not load assessments ({error}).</p>}
        {notice && <p className="as-note as-ok" role="status">{notice}</p>}
        {rows && (
          <section className="as-hero" aria-label="Next deadline and the week ahead">
            <div className="as-dial-card" style={{ ["--tone" as string]: tone }}>
              <div className="as-dial" role="img" aria-label={view.next ? `${countdown(left)} left for ${view.next.company}` : "Nothing due"}>
                <svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r={R} className="track" /><circle cx="110" cy="110" r={R} className="fill" strokeDasharray={C} strokeDashoffset={C * (1 - remaining)} transform="rotate(-90 110 110)" /></svg>
                <div className="as-dial-text"><b>{view.next ? countdown(left) : "Clear"}</b><span>{view.next ? "left" : rows.length ? "nothing dated" : "nothing waiting"}</span></div>
              </div>
              <div className="as-next">
                <small>{view.next ? "Next due" : view.unknown.length ? "Needs a date" : "All done"}</small>
                <strong>{view.next ? view.next.company || "An assessment" : view.unknown.length ? `${view.unknown.length} without a deadline` : "Nothing waiting"}</strong>
                <span>{view.next ? absolute(view.next.deadlineAt!) : view.unknown.length ? "Add a date below and it joins the runway." : "A new assessment mail appears here within 15 minutes."}</span>
              </div>
            </div>
            <div className="as-runway">
              <div className="as-days" aria-hidden="true">{view.days.map((d) => <span key={d.label}>{d.label}</span>)}</div>
              <div className="as-track">
                <i className="as-now" style={{ left: `${view.nowX}%` }} aria-hidden="true"><em>now</em></i>
                {view.pins.map((p, i) => (
                  <button key={p.r.id} type="button" className={`as-pin is-${p.r.state}${focus === p.r.id ? " on" : ""}${p.x > 78 ? " flip" : ""}`} style={{ left: `${p.x}%`, top: `${14 + p.lane * 30}%`, animationDelay: `${i * 70}ms`, ["--pin" as string]: URGENT[p.r.state] }} onClick={() => { setFocus(p.r.id); document.getElementById(`as-${p.r.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }} title={`${p.r.company}: ${absolute(p.r.deadlineAt!)}`}>
                    <span className="dot" aria-hidden="true" /><span className="lab"><b>{p.r.company || "Assessment"}</b><small>{p.clipped ? "later" : new Date(p.r.deadlineAt!).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}</small></span>
                  </button>))}
                {view.pins.length === 0 && <p className="as-track-empty">{view.unknown.length ? "No dated assessments yet." : "Nothing on the runway."}</p>}
              </div>
              {view.unknown.length > 0 && <div className="as-undated"><span>No date yet</span>{view.unknown.map((r) => <button key={r.id} type="button" onClick={() => { setFocus(r.id); document.getElementById(`as-${r.id}`)?.querySelector("input")?.focus(); }}>{r.company || "Assessment"}</button>)}</div>}
            </div>
          </section>)}
        {rows && rows.length === 0 && !error && <p className="as-empty">Nothing waiting. A new assessment mail appears here within 15 minutes, with its deadline when the mail gives one.</p>}
        {rows && rows.length > 0 && (
          <section className="as-card" aria-label="Assessments waiting">
            <ul className="as-list">
              {view.list.map((r) => (
                <li key={r.id} id={`as-${r.id}`} className={`is-${r.state}${focus === r.id ? " on" : ""}`}>
                  <div className="as-who"><b title={r.company}>{r.company || "Unknown company"}</b><small title={r.subject}>{r.subject}<i> · mail of {received(r.receivedAt)}</i></small></div>
                  <div className="as-when"><span className={`as-chip is-${r.state}`}>{STATE_LABEL[r.state]}</span><b>{r.when}</b>{r.deadlineText && r.deadlineSource === "mail" && <small className="as-quote" title={r.deadlineText}>"{r.deadlineText}"</small>}{r.deadlineSource === "you" && <small>you set it</small>}</div>
                  <div className="as-set">
                    <label><span className="as-sr">Deadline for {r.company}</span><input type="datetime-local" value={edit[r.id] ?? (r.deadlineAt ? shown(r.deadlineAt) : "")} onChange={(e) => setEdit((x) => ({ ...x, [r.id]: e.target.value }))} /></label>
                    <button type="button" className="as-save" onClick={() => save(r)} disabled={!edit[r.id]}>{r.deadlineAt ? "Change" : "Set"}</button>
                  </div>
                  <div className="as-act"><button type="button" className="as-done" onClick={() => void run(() => update({ id: r.id, status: "done" }), `Marked ${r.company || "it"} done.`)}>Done ✓</button><button type="button" className="as-x" aria-label={`Dismiss ${r.company}`} title="Not an assessment I need" onClick={() => void run(() => update({ id: r.id, status: "dismissed" }), "Dismissed.")}>✕</button></div>
                </li>))}
            </ul>
          </section>)}
      </main>
    </div>
  );
}
