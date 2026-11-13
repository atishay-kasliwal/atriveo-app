import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ATO_DAYS, ATO_SESSIONS, type AtoSession } from "./atoSchedule";
import { followUp, loadEverything, type Person } from "./network";
import "./review-pages.css";
import "./day-plan.css";

// Day plan (/day-plan): the All Things Open program as room lanes across the day, with a time cursor. Your people from Network are
// marked on the talks they give (Priority A/B and any follow-up), and companies hiring at the job board get a dot. The schedule is
// public and ships with the app; everything about people is read from Network (Mongo, including people kept off My network) and never stored here. Your agenda lives in
// this browser.

const AGENDA_KEY = "ato-day-plan-agenda";
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clock = (m: number) => `${Math.floor(m / 60) % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""} ${m >= 720 ? "PM" : "AM"}`;
const tierOf = (p: Person) => (p.tags.find((t) => /^Priority /i.test(t)) ?? "").replace(/^Priority /i, "");
const rank = (t: string) => (t === "A" ? 0 : t ? 1 : 2);
const readAgenda = (): string[] => { try { return JSON.parse(localStorage.getItem(AGENDA_KEY) || "[]"); } catch { return []; } };

export default function DayPlanPage({ header }: { header: React.ReactNode }) {
  const [day, setDay] = useState(ATO_DAYS[1][0]);
  const [minute, setMinute] = useState(10 * 60 + 30);
  const [agenda, setAgenda] = useState<string[]>(readAgenda);
  const [selected, setSelected] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [hiring, setHiring] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    loadEverything().then((n) => {
      if (!live) return;
      setPeople(n.people.filter((p) => !p.archived));
      setHiring(new Set(n.sources.filter((s) => /^hiring/i.test(s.about ?? "")).map((s) => fold(s.name))));
    }).catch(() => live && setNote("Network didn't load, so your people aren't marked. The schedule still works."));
    return () => { live = false; };
  }, []);

  const byName = useMemo(() => new Map(people.map((p) => [fold(p.name), p])), [people]);
  const sessions = useMemo(() => ATO_SESSIONS.filter((s) => s.date === day), [day]);
  const lo = Math.floor(Math.min(...ATO_SESSIONS.map((s) => s.start)) / 60) * 60, hi = Math.ceil(Math.max(...ATO_SESSIONS.map((s) => s.end)) / 60) * 60, span = hi - lo;
  const pct = (m: number) => `${((m - lo) / span) * 100}%`;
  const rooms = useMemo(() => [...new Set(sessions.map((s) => s.room || "Room not listed"))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [sessions]);
  const mine = (s: AtoSession) => s.speakers.map((n) => byName.get(fold(n))).filter((p): p is Person => !!p);
  const top = (s: AtoSession) => mine(s).some((p) => tierOf(p));
  const hires = (s: AtoSession) => !!s.company && hiring.has(fold(s.company));
  const now = sessions.filter((s) => s.start <= minute && minute < s.end);
  const meet = useMemo(() => sessions.flatMap((s) => s.speakers.map((n) => ({ s, p: byName.get(fold(n)) })).filter((r): r is { s: AtoSession; p: Person } => !!r.p))
    .sort((a, b) => a.s.start - b.s.start || rank(tierOf(a.p)) - rank(tierOf(b.p))), [sessions, byName]);
  const saved = sessions.filter((s) => agenda.includes(s.id));
  const clashes = saved.flatMap((a, i) => saved.slice(i + 1).filter((b) => a.start < b.end && b.start < a.end && !(/lightning/i.test(a.track) && /lightning/i.test(b.track))).map((b) => [a, b] as const));
  const sel = ATO_SESSIONS.find((s) => s.id === selected) ?? null;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => lo + i * 60);

  function toggle(id: string) {
    const next = agenda.includes(id) ? agenda.filter((x) => x !== id) : [...agenda, id];
    setAgenda(next);
    try { localStorage.setItem(AGENDA_KEY, JSON.stringify(next)); } catch { /* private window */ }
  }
  const person = (p: Person) => {
    const t = tierOf(p), f = followUp(p.nextFollowUp);
    return <Link key={p.id} className="dp-person" to={`/network?person=${encodeURIComponent(p.id)}`}>{t ? <b className={`dp-tier is-${t[0]}`}>{t}</b> : null}<span>{p.name}<small>{[p.role, f ? `follow up ${f.text}` : ""].filter(Boolean).join(" · ")}</small></span></Link>;
  };

  return (
    <div className="rv-page dp-page">
      {header}
      <div className="rv-bar dp-bar">
        <div className="rv-bar-title"><h1>Day plan</h1><span className="apps-muted">All Things Open 2026 · Raleigh Convention Center</span></div>
        <div className="dp-controls">
          <div className="dp-days" role="group" aria-label="Day">{ATO_DAYS.map(([d, label]) => <button key={d} type="button" className={day === d ? "is-on" : ""} aria-pressed={day === d} onClick={() => { setDay(d); setSelected(null); }}>{label}</button>)}</div>
          <label className="dp-time">Time <b>{clock(minute)}</b><input type="range" min={lo} max={hi - 15} step={15} value={minute} onChange={(e) => setMinute(Number(e.target.value))} aria-label="Time of day" /></label>
        </div>
      </div>
      <div className="dp-main">
        <section className="dp-board" aria-label="Rooms by time">
          {note ? <p className="dp-note" role="status">{note}</p> : null}
          <div className="dp-scroll">
            <div className="dp-axis">{hours.map((h) => <span key={h} style={{ left: pct(h) }}>{clock(h).replace(":00", "")}</span>)}</div>
            {rooms.map((r) => (
              <div className="dp-lane" key={r}>
                <span className="dp-room">{r}</span>
                <div className="dp-track">
                  {hours.map((h) => <i key={h} className="dp-grid" style={{ left: pct(h) }} />)}
                  {sessions.filter((s) => (s.room || "Room not listed") === r).map((s) => (
                    <button key={s.id} type="button" className={`dp-block${agenda.includes(s.id) ? " is-mine" : ""}${top(s) ? " is-top" : ""}${s.id === selected ? " is-sel" : ""}${s.start <= minute && minute < s.end ? " is-live" : ""}`}
                      style={{ left: pct(s.start), width: `calc(${((s.end - s.start) / span) * 100}% - 2px)` }} title={`${s.title} · ${clock(s.start)} to ${clock(s.end)}${s.speakers.length ? " · " + s.speakers.join(", ") : ""}`} onClick={() => setSelected(s.id)}>
                      <span>{hires(s) ? <b className="dp-hire" aria-label="Company is hiring" /> : null}{s.title}</span>
                    </button>
                  ))}
                  <i className="dp-cursor" style={{ left: pct(minute) }} />
                </div>
              </div>
            ))}
          </div>
          <p className="dp-legend"><i className="is-mine" />In your agenda <i className="is-top" />Someone from your Network speaks <i className="is-hire" />Company is hiring <i className="is-live" />On at the chosen time</p>
          <div className="dp-now">
            <h2>At {clock(minute)} <span>{now.length}</span></h2>
            {now.length === 0 ? <p className="apps-muted">Nothing scheduled at this time.</p> : (
              <ul>{now.map((s) => <li key={s.id}><button type="button" onClick={() => setSelected(s.id)}><span className="dp-r">{s.room}</span><span>{s.title}<small>{[s.company, ...s.speakers].filter(Boolean).join(" · ")}</small></span>{top(s) ? <b className="dp-star" aria-label="Someone from your Network">★</b> : null}</button></li>)}</ul>
            )}
          </div>
        </section>
        <aside className="dp-side" aria-label="Meet today and details">
          {sel ? (
            <div className="dp-card">
              <div className="dp-card-head"><span className="dp-kind">{sel.kind === "workshop" ? "WORKSHOP" : "SESSION"}</span><button type="button" className="dp-x" aria-label="Close details" onClick={() => setSelected(null)}>✕</button></div>
              <h2>{sel.title}</h2>
              <dl><dt>When</dt><dd>{ATO_DAYS.find(([d]) => d === sel.date)?.[1]} · {clock(sel.start)} to {clock(sel.end)}</dd><dt>Where</dt><dd>{sel.room || "Room not listed"}{sel.track ? ` · ${sel.track}` : ""}</dd>{sel.company ? <><dt>Company</dt><dd>{sel.company}{hires(sel) ? " · hiring at the job board" : ""}</dd></> : null}{sel.speakers.length ? <><dt>Speakers</dt><dd>{sel.speakers.join(", ")}</dd></> : null}{sel.link ? <><dt>Official page</dt><dd><a href={sel.link} target="_blank" rel="noreferrer">allthingsopen.org</a></dd></> : null}</dl>
              {mine(sel).length ? <section><h3>From your Network</h3>{mine(sel).map(person)}</section> : null}
              <button type="button" className="dp-btn" aria-pressed={agenda.includes(sel.id)} onClick={() => toggle(sel.id)}>{agenda.includes(sel.id) ? "✓ In your agenda" : "Add to agenda"}</button>
            </div>
          ) : (
            <div className="dp-card">
              <span className="dp-kind">MEET TODAY</span>
              <h2>{ATO_DAYS.find(([d]) => d === day)?.[1]}</h2>
              {meet.length === 0 ? <p className="apps-muted">None of your Network people speak this day.</p> : <div className="dp-meet">{meet.map(({ s, p }) => <button key={s.id + p.id} type="button" className="dp-meet-row" onClick={() => setSelected(s.id)}>{tierOf(p) ? <b className={`dp-tier is-${tierOf(p)[0]}`}>{tierOf(p)}</b> : null}<span>{p.name}<small>{clock(s.start)} · {s.room} · {s.title}</small></span></button>)}</div>}
              {clashes.length ? <section><h3>Agenda overlaps <span>{clashes.length}</span></h3>{clashes.map(([a, b]) => <p className="dp-clash" key={a.id + b.id}>{a.title} overlaps {b.title}</p>)}</section> : null}
              <p className="apps-muted dp-foot">Your agenda is saved in this browser. People come from Network.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
