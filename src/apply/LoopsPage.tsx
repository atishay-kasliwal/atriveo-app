import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { audioUrl, clock, getLoop, listLoops, loopConfirm, loopDismiss, loopDone, loopEdit, loopReopen, loopRetry, loopSnooze, loopsSummary, loopTranscript, type Loop, type LoopEvent, type LoopLinked, type LoopStatus } from "./loops";
import "./loops-page.css";

// Loops: every thought you captured and where it stands. Unfinished intentions first; opening one tells its story:
// what you said, what Atriveo understood, and what happened since (docs/loops.md).
const TZ = "America/New_York";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const span = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${Math.max(1, m)} min` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

const SECTIONS: Array<{ key: string; label: string; statuses: LoopStatus[]; hint: string }> = [
  { key: "action", label: "Needs action", statuses: ["ACTIVE", "SNOOZED"], hint: "Confirmed, and still open. These keep coming back until you finish them." },
  { key: "review", label: "Needs review", statuses: ["NEEDS_REVIEW"], hint: "Read by your Mac. Check it and confirm to start the reminders." },
  { key: "waiting", label: "Waiting for your Mac", statuses: ["RECORDED", "TRANSCRIBING", "WAITING_FOR_CODEX", "PROCESSING", "FAILED"], hint: "Saved. They are read when your Mac is next on." },
  { key: "done", label: "Completed", statuses: ["COMPLETED"], hint: "" },
  { key: "dismissed", label: "Dismissed", statuses: ["DISMISSED"], hint: "" },
];
const STATUSES: LoopStatus[] = ["ACTIVE", "SNOOZED", "NEEDS_REVIEW", "WAITING_FOR_CODEX", "PROCESSING", "RECORDED", "TRANSCRIBING", "FAILED", "COMPLETED", "DISMISSED"];
const STATUS_LABEL: Record<LoopStatus, string> = { RECORDED: "Recorded", TRANSCRIBING: "Transcribing", WAITING_FOR_CODEX: "Waiting for your Mac", PROCESSING: "Your Mac is reading it", NEEDS_REVIEW: "Needs review", ACTIVE: "Open", SNOOZED: "Snoozed", COMPLETED: "Completed", DISMISSED: "Dismissed", FAILED: "Needs a retry" };

const title = (c: Loop) => [c.view?.company, c.view?.position].filter(Boolean).join(" · ") || c.view?.summary || (c.text ?? "").slice(0, 70) || (c.audio ? `Recording · ${clock(c.audio.durationMs)}` : "Capture");
const sub = (c: Loop) => c.tasks.find((t) => !t.done)?.title ?? (c.view?.company || c.view?.position ? c.view.summary : c.view ? "" : c.audio ? "Voice" : "Text");

function age(c: Loop, now: number) {
  if (c.status === "ACTIVE" || c.status === "SNOOZED") return `Waiting ${span(now - Date.parse(c.confirmedAt ?? c.createdAt))}`;
  if (c.status === "COMPLETED" && c.completedAt) return `Done ${when(c.completedAt)}`;
  return when(c.createdAt);
}

export default function LoopsPage({ header }: { header: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const [loops, setLoops] = useState<Loop[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState(""), [status, setStatus] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [filters, setFilters] = useState(false);
  const [mac, setMac] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const search = useRef<HTMLInputElement>(null);
  const searching = Boolean(q.trim() || status || from || to);

  const load = useCallback(async () => {
    try {
      const r = await listLoops({ q: q.trim(), status, from: from ? new Date(`${from}T00:00:00-04:00`).toISOString() : "", to: to ? new Date(`${to}T23:59:59-04:00`).toISOString() : "" });
      setLoops(r.captures); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Loops could not be reached."); setLoops((l) => l ?? []); }
    loopsSummary().then((s) => setMac(s.worker.lastSeenAt), () => {});
  }, [q, status, from, to]);
  useEffect(() => { const t = window.setTimeout(() => void load(), q ? 250 : 0); return () => window.clearTimeout(t); }, [load, q]);
  useEffect(() => { const t = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void load(); }, 30_000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null, typing = el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (id: string | null) => setParams(id ? { id } : {}, { replace: true });
  const grouped = useMemo(() => SECTIONS.map((s) => ({ ...s, items: (loops ?? []).filter((c) => s.statuses.includes(c.status)).sort((a, b) => s.key === "action" ? Date.parse(a.confirmedAt ?? a.createdAt) - Date.parse(b.confirmedAt ?? b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)) })), [loops]);
  const open = grouped[0]!.items.length, review = grouped[1]!.items.length, waitingN = grouped[2]!.items.length;
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);
  const macText = mac === undefined ? "" : mac ? `Your Mac was last seen ${span(now - Date.parse(mac))} ago` : "Your Mac hasn't connected yet";
  const lede = loops == null ? "" : [open ? `${open} still open` : "Nothing is waiting on you", review ? `${review} to review` : "", waitingN ? `${waitingN} waiting for your Mac` : ""].filter(Boolean).join(" · ");

  const moveSel = (dir: 1 | -1) => { const i = flat.findIndex((c) => c.id === selected); const next = flat[Math.min(flat.length - 1, Math.max(0, (i < 0 ? (dir > 0 ? -1 : flat.length) : i) + dir))]; if (next) pick(next.id); };

  return (
    <div className="rv-page lp-page">
      {header}
      <main className={`lp-main ${selected ? "is-detail" : ""}`}>
        <section className="lp-list" aria-label="Loops">
          <div className="lp-title">
            <h1>Loops</h1>
            <p aria-live="polite">{lede}{lede && macText ? <><span aria-hidden="true"> · </span><span className="lp-mac">{macText}</span></> : macText}</p>
          </div>
          <div className="lp-search">
            <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, person, role or words" aria-label="Search loops" onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }} />
            <button type="button" className={`lp-filter-btn ${filters || status || from || to ? "is-on" : ""}`} aria-expanded={filters} onClick={() => setFilters((v) => !v)}>Filters</button>
          </div>
          {filters && (
            <div className="lp-filters">
              <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
              <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              {(status || from || to) && <button type="button" className="lp-link" onClick={() => { setStatus(""); setFrom(""); setTo(""); }}>Clear</button>}
            </div>
          )}
          {error && <p className="lp-note" role="alert">{error}</p>}
          <div className="lp-scroll" role="listbox" aria-label="Captured thoughts" onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); moveSel(1); } else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); moveSel(-1); } }}>
            {loops == null && <p className="lp-empty">Loading…</p>}
            {loops != null && loops.length === 0 && !error && (
              <div className="lp-empty">
                <b>{searching ? "Nothing matches that." : "Nothing captured yet."}</b>
                <span>{searching ? "Try a company or a person's name." : "Press Ctrl/⌘ Shift Space anywhere in Atriveo and say or type a thought. It will wait here."}</span>
              </div>
            )}
            {searching
              ? flat.length > 0 && <Rows items={flat} selected={selected} now={now} pick={pick} showStatus />
              : grouped.filter((g) => g.items.length > 0).map((g) => (
                <div key={g.key} className="lp-group">
                  <h2>{g.label}<span>{g.items.length}</span></h2>
                  {g.hint && <p className="lp-hint">{g.hint}</p>}
                  <Rows items={g.items} selected={selected} now={now} pick={pick} />
                </div>
              ))}
          </div>
        </section>
        <section className="lp-detail" aria-label="Capture">
          {selected ? <Detail key={selected} id={selected} now={now} mac={mac ?? null} onChanged={load} onClose={() => pick(null)} />
            : <div className="lp-detail-empty"><p>{open ? "Pick one to see its story." : "Calm. Nothing needs you right now."}</p></div>}
        </section>
      </main>
    </div>
  );
}

function Rows({ items, selected, now, pick, showStatus = false }: { items: Loop[]; selected: string | null; now: number; pick: (id: string) => void; showStatus?: boolean }) {
  return <>{items.map((c) => (
    <button key={c.id} type="button" role="option" aria-selected={c.id === selected} className={`lp-row ${c.id === selected ? "is-on" : ""} lp-${c.status.toLowerCase()}`} onClick={() => pick(c.id)}>
      <span className="lp-row-main"><b>{title(c)}</b>{sub(c) && <span>{sub(c)}</span>}</span>
      <span className="lp-row-meta">{showStatus ? STATUS_LABEL[c.status] : age(c, now)}{showStatus && <small>{age(c, now)}</small>}</span>
    </button>
  ))}</>;
}

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  captured: (d) => (d.inputType === "VOICE" ? "Captured by voice" : "Captured"),
  transcribed: (d) => (d.provider === "typed" ? "Transcript typed by you" : "Transcribed"),
  transcription_failed: () => "Transcription failed; the recording is kept",
  claimed: () => "Picked up by your Mac",
  processed: () => "Read by Codex on your Mac",
  malformed: () => "The reading wasn't usable, so it was tried again",
  codex_failed: (d) => (d.retrying ? "Reading failed, trying again" : "Reading failed"),
  edited: (d) => `You changed ${Object.keys(d).map((k) => ({ reminderHours: "the reminder", personId: "the person link", sourceId: "the company link", jobUrl: "the job link" } as Record<string, string>)[k] ?? k).join(", ")}`,
  confirmed: (d) => `Confirmed. Reminding every ${d.intervalHours} hours`,
  reminder_sent: () => "Reminder sent",
  reminder_failed: () => "Reminder couldn't be delivered, trying again soon",
  reminder_skipped: () => "Reminder skipped: no device is subscribed to notifications",
  snoozed: (d) => `Snoozed for ${d.hours} hours`,
  task_done: () => "One task done",
  completed: () => "Completed",
  dismissed: () => "Dismissed",
  reopened: () => "Reopened",
  retried: () => "Sent back to be read again",
};

function Detail({ id, now, mac, onChanged, onClose }: { id: string; now: number; mac: string | null; onChanged: () => void; onClose: () => void }) {
  const [data, setData] = useState<{ capture: Loop; events: LoopEvent[]; linked: LoopLinked } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const reload = useCallback(async () => { try { setData(await getLoop(id)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "That capture could not be opened."); } }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError("");
    try { await fn(); await reload(); onChanged(); after?.(); } catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); } finally { setBusy(false); }
  };
  if (error && !data) return <div className="lp-detail-in"><button className="lp-back" onClick={onClose}>← Loops</button><p className="lp-note" role="alert">{error}</p></div>;
  if (!data) return <div className="lp-detail-in"><button className="lp-back" onClick={onClose}>← Loops</button><p className="lp-empty">Loading…</p></div>;
  const c = data.capture, v = c.view, linked = data.linked ?? {};
  const reviewing = c.status === "NEEDS_REVIEW", live = c.status === "ACTIVE" || c.status === "SNOOZED";
  return (
    <article className={`lp-detail-in ${celebrate ? "is-done-now" : ""}`}>
      <button type="button" className="lp-back" onClick={onClose}>← Loops</button>
      <header className="lp-head">
        <p className="lp-state"><i className={`lp-pip lp-pip-${c.status.toLowerCase()}`} aria-hidden="true" />{STATUS_LABEL[c.status]}{live && c.reminder.nextAt && <span> · next nudge {Date.parse(c.reminder.nextAt) <= now ? "any minute" : `in ${span(Date.parse(c.reminder.nextAt) - now)}`}</span>}{c.status === "COMPLETED" && c.completedAt && <span> · {when(c.completedAt)}</span>}</p>
        <h2>{title(c)}</h2>
        {v?.person && <p className="lp-person">{v.person}{v.intent ? ` · ${v.intent}` : ""}</p>}
        {v && (v.company || v.position) && v.summary && <p className="lp-summary">{v.summary}</p>}
      </header>
      {error && <p className="lp-note" role="alert">{error}</p>}

      {reviewing && <Review key={c.updatedAt} c={c} busy={busy} onSave={(patch, hours) => run(async () => { if (Object.keys(patch).length) await loopEdit(c.id, patch); await loopConfirm(c.id, hours); })} onReread={() => run(() => loopRetry(c.id))} onDismiss={() => run(() => loopDismiss(c.id))} />}

      {live && (
        <section className="lp-block" aria-label="What to do">
          <h3>To do</h3>
          <ul className="lp-tasks">{c.tasks.map((t) => (
            <li key={t.id} className={t.done ? "is-done" : ""}>
              <button type="button" className="lp-check" disabled={busy || t.done} aria-label={t.done ? `${t.title}, done` : `Mark done: ${t.title}`} onClick={() => run(() => loopDone(c.id, t.id), () => { if (c.tasks.filter((x) => !x.done).length === 1) { setCelebrate(true); window.setTimeout(() => setCelebrate(false), 1400); } })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg></button>
              <span><b>{t.title}</b>{t.description && <small>{t.description}</small>}</span>
            </li>))}</ul>
          <div className="lp-actions">
            <button type="button" className="lp-btn lp-primary" disabled={busy} onClick={() => run(() => loopDone(c.id), () => { setCelebrate(true); window.setTimeout(() => setCelebrate(false), 1400); })}>Done</button>
            <Snooze disabled={busy} onPick={(h) => run(() => loopSnooze(c.id, h))} />
            <button type="button" className="lp-btn" disabled={busy} onClick={() => run(() => loopDismiss(c.id))}>Not doing this</button>
          </div>
        </section>
      )}

      {(c.status === "RECORDED" || c.status === "TRANSCRIBING" || c.status === "WAITING_FOR_CODEX" || c.status === "PROCESSING") && (
        <section className="lp-block lp-wait" aria-label="Status">
          <p><b>{c.status === "RECORDED" ? "Recording saved." : c.status === "TRANSCRIBING" ? "Turning your recording into text." : c.status === "PROCESSING" ? "Your Mac is reading it now." : "Waiting for your Mac."}</b>{" "}
            {c.status === "RECORDED" ? "It will be transcribed in the background. Nothing is lost; you can also type what you said below." : c.status === "WAITING_FOR_CODEX" ? (mac ? `Last seen ${span(now - Date.parse(mac))} ago. It is read next time the worker runs.` : "It is read the next time your Mac's worker runs.") : "This usually takes a minute."}</p>
          {c.status === "RECORDED" && <TypeIt busy={busy} onSave={(t) => run(() => loopTranscript(c.id, t))} />}
          <div className="lp-actions"><button type="button" className="lp-btn" disabled={busy} onClick={() => run(() => loopDismiss(c.id))}>Discard</button></div>
        </section>
      )}

      {c.status === "FAILED" && (
        <section className="lp-block lp-wait" aria-label="Status">
          <p><b>{c.error?.stage === "transcribe" ? "It couldn't be transcribed." : "It couldn't be read."}</b> {c.error?.message} The original is safe.</p>
          {c.error?.stage === "transcribe" && <TypeIt busy={busy} onSave={(t) => run(() => loopTranscript(c.id, t))} />}
          <div className="lp-actions"><button type="button" className="lp-btn lp-primary" disabled={busy} onClick={() => run(() => loopRetry(c.id))}>Try again</button><button type="button" className="lp-btn" disabled={busy} onClick={() => run(() => loopDismiss(c.id))}>Discard</button></div>
        </section>
      )}

      {(c.status === "COMPLETED" || c.status === "DISMISSED") && (
        <section className="lp-block"><div className="lp-actions"><button type="button" className="lp-btn" disabled={busy} onClick={() => run(() => loopReopen(c.id))}>{c.status === "COMPLETED" ? "Reopen" : "Bring it back"}</button></div></section>
      )}

      <section className="lp-block" aria-label="Original thought">
        <h3>{c.inputType === "VOICE" ? `Original thought · ${c.audio ? clock(c.audio.durationMs) : ""}` : "Original thought"}<span>{when(c.createdAt)}</span></h3>
        {c.audio && <audio className="lp-audio" controls preload="none" src={audioUrl(c.id)} aria-label="Original recording" />}
        {c.text ? (c.inputType === "VOICE" ? <details className="lp-transcript"><summary>View transcript</summary><blockquote>{c.text}</blockquote></details> : <blockquote>{c.text}</blockquote>) : c.audio ? <p className="lp-hint">No transcript yet.</p> : null}
      </section>

      {v && !reviewing && (
        <section className="lp-block" aria-label="Understood as">
          <h3>Understood as</h3>
          <dl className="lp-kv">{([["Company", v.company], ["Role", v.position], ["Person", v.person], ["Intent", v.intent]] as const).filter(([, x]) => x).map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
          {v.context.length > 0 && <ul className="lp-context">{v.context.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {(linked.person || linked.company || linked.job) && <p className="lp-hint lp-linked">Linked in Atriveo: {[linked.person && `${linked.person.name} in your Network`, linked.company && linked.company.name, linked.job && (linked.job.title ? `${linked.job.title} job` : "a job")].filter(Boolean).join(" · ")}</p>}
        </section>
      )}

      <section className="lp-block" aria-label="Activity">
        <h3>Activity</h3>
        <ol className="lp-timeline">{data.events.map((e, i) => {
          const text = (EVENT_TEXT[e.type] ?? (() => e.type.replace(/_/g, " ")))(e.data ?? {});
          const newDay = i === 0 || dayLabel(data.events[i - 1]!.at) !== dayLabel(e.at);
          return <li key={i} className={`lp-ev lp-ev-${e.type}`}>{newDay && <span className="lp-ev-day">{dayLabel(e.at)}</span>}<time dateTime={e.at}>{clockTime(e.at)}</time><span>{text}</span></li>;
        })}</ol>
      </section>
    </article>
  );
}

function Snooze({ disabled, onPick }: { disabled: boolean; onPick: (hours: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className="lp-snooze" ref={ref}>
      <button type="button" className="lp-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Remind me in…</button>
      {open && <div className="lp-menu" role="menu">{[[1, "1 hour"], [3, "3 hours"], [6, "6 hours"], [24, "Tomorrow"], [72, "3 days"]].map(([h, label]) => <button key={h} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(h as number); }}>{label}</button>)}</div>}
    </div>
  );
}

function TypeIt({ busy, onSave }: { busy: boolean; onSave: (text: string) => void }) {
  const [t, setT] = useState("");
  return <div className="lp-typeit"><label htmlFor="lp-typeit">Type what you said</label><textarea id="lp-typeit" rows={3} value={t} onChange={(e) => setT(e.target.value)} /><button type="button" className="lp-btn" disabled={busy || !t.trim()} onClick={() => onSave(t)}>Use this text</button></div>;
}

const HOURS = [1, 3, 6, 12, 24, 48, 72];
function Review({ c, busy, onSave, onReread, onDismiss }: { c: Loop; busy: boolean; onSave: (patch: object, hours: number) => void; onReread: () => void; onDismiss: () => void }) {
  const v = c.view!;
  const [f, setF] = useState({ company: v.company ?? "", position: v.position ?? "", person: v.person ?? "", summary: v.summary });
  const [tasks, setTasks] = useState(c.tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, priority: t.priority })));
  const [hours, setHours] = useState(c.reminder.intervalHours ?? 6);
  const [link, setLink] = useState<Record<string, string | null>>({});
  const cand = c.links?.candidates, linked = c.links?.linked ?? {};
  const submit = () => {
    const patch: Record<string, unknown> = {};
    for (const k of ["company", "position", "person", "summary"] as const) if (f[k].trim() !== (v[k] ?? "")) patch[k] = f[k].trim() || null;
    const clean = tasks.map((t) => ({ ...t, title: t.title.trim() })).filter((t) => t.title);
    if (JSON.stringify(clean.map((t) => t.title)) !== JSON.stringify(c.tasks.map((t) => t.title))) patch.tasks = clean;
    if (Object.keys(link).length) patch.link = link;
    onSave(patch, hours);
  };
  const ready = tasks.some((t) => t.title.trim());
  return (
    <form className="lp-block lp-review" aria-label="Review" onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
      <h3>Check what I understood</h3>
      <div className="lp-fields">
        <label>Company<input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label>Role<input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></label>
        <label>Person<input value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} /></label>
        <label className="lp-wide">Summary<input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
      </div>
      {cand && (cand.people.length > 0 || cand.jobs.length > 0 || cand.companies.length > 0) && (
        <div className="lp-matches" aria-label="Matches in Atriveo">
          {cand.people.length > 0 && <Match label="Person in your Network" options={cand.people.map((p) => ({ value: p.id, text: `${p.name}${p.company ? ` · ${p.company}` : ""}` }))} current={link.personId !== undefined ? link.personId : linked.personId ?? null} onPick={(x) => setLink({ ...link, personId: x })} />}
          {cand.companies.length > 0 && <Match label="Company" options={cand.companies.map((p) => ({ value: p.id, text: p.name }))} current={link.sourceId !== undefined ? link.sourceId : linked.sourceId ?? null} onPick={(x) => setLink({ ...link, sourceId: x })} />}
          {cand.jobs.length > 0 && <Match label="Job" options={cand.jobs.map((p) => ({ value: p.url, text: `${p.title} · ${p.company}` }))} current={link.jobUrl !== undefined ? link.jobUrl : linked.jobUrl ?? null} onPick={(x) => setLink({ ...link, jobUrl: x })} />}
        </div>
      )}
      {v.context.length > 0 && <div><p className="lp-sub">What you told me</p><ul className="lp-context">{v.context.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      <div>
        <p className="lp-sub">What to do</p>
        {tasks.map((t, i) => (
          <div key={t.id} className="lp-task-edit">
            <input value={t.title} aria-label={`Task ${i + 1}`} onChange={(e) => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, title: e.target.value } : x)))} />
            <button type="button" className="lp-link" aria-label={`Remove task ${i + 1}`} onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))}>Remove</button>
          </div>))}
        {tasks.length < 8 && <button type="button" className="lp-link" onClick={() => setTasks([...tasks, { id: `new${tasks.length}${Date.now()}`, title: "", description: null, priority: "medium" }])}>+ Add a task</button>}
      </div>
      <label className="lp-remind">Remind me every<select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[...new Set([...HOURS, hours])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{h === 1 ? "hour" : h < 24 ? `${h} hours` : h === 24 ? "day" : `${h / 24} days`}</option>)}</select><small>Quiet from 10 pm to 8 am.</small></label>
      <div className="lp-actions">
        <button type="submit" className="lp-btn lp-primary" disabled={busy || !ready}>Confirm</button>
        <button type="button" className="lp-btn" disabled={busy} onClick={onReread}>Read again</button>
        <button type="button" className="lp-btn" disabled={busy} onClick={onDismiss}>Dismiss</button>
      </div>
    </form>
  );
}
function Match({ label, options, current, onPick }: { label: string; options: Array<{ value: string; text: string }>; current: string | null; onPick: (v: string | null) => void }) {
  return <label className="lp-match">{label}<select value={current ?? ""} onChange={(e) => onPick(e.target.value || null)}><option value="">Not linked</option>{options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}</select></label>;
}
