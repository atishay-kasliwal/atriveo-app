import { useEffect, useRef, useState } from "react";
import { answerCheckIn, checkInToast, loadReminders, post, type BoardItem, type NetworkData, type Reminder, colorsFor } from "./network";

/** The bell: how many things need you, the most urgent one beside it, and the full list on click. Each can be opened or snoozed for a week. */
export default function NetworkBell({ data, board, colors, onPerson, onSource, onWork, say }: { data: NetworkData; board: BoardItem[]; colors: ReturnType<typeof colorsFor>; onPerson: (id: string) => void; onSource: (id: string) => void; onWork: (id: string) => void; say: (t: { text: string } | null) => void }) {
  const [list, setList] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Recount a moment after anything changes (a message logged, a follow-up moved).
  useEffect(() => { let on = true; const t = window.setTimeout(() => { loadReminders().then((r) => on && setList(r)).catch(() => { /* the bell keeps its last list */ }); }, 400); return () => { on = false; window.clearTimeout(t); }; }, [data, board]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const color = (r: Reminder) => (r.personId ? colors.person.get(r.personId) : r.sourceId ? colors.source.get(r.sourceId) : r.workId ? "var(--nw-accent)" : undefined) ?? "var(--nw-muted)";
  const go = (r: Reminder) => { setOpen(false); if (r.personId) onPerson(r.personId); else if (r.workId) onWork(r.workId); else if (r.sourceId) onSource(r.sourceId); };
  async function snooze(r: Reminder) {
    try { await post("reminders/snooze", { key: r.key, days: 7 }); setList((l) => l.filter((x) => x.key !== r.key)); say({ text: "Snoozed for a week." }); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function answer(r: Reminder, a: "accepted" | "replied" | "no" | "sent") {
    const name = data.people.find((p) => p.id === r.personId)?.name ?? "They";
    try { const res = await answerCheckIn(r.personId!, r.hour!, a); setList((l) => l.filter((x) => x.key !== r.key)); say({ text: checkInToast(name, res, a === "sent") }); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  const top = list[0];
  return (
    <div className="nw-bell" ref={box}>
      {top && <button type="button" className="nw-bell-top" onClick={() => go(top)} title={top.detail}><i style={{ background: color(top) }} /><span>{top.title}</span></button>}
      <button type="button" className="nw-bell-btn" aria-label={`Reminders: ${list.length}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0112 0v6l1.5 2h-15zM10 21a2 2 0 004 0" /></svg>
        {list.length > 0 && <b>{list.length > 99 ? "99+" : list.length}</b>}
      </button>
      {open && (
        <div className="nw-bell-pop" role="region" aria-label="Reminders">
          <h2>Reminders</h2>
          {!list.length && <p className="nw-muted">Nothing needs you right now.</p>}
          <ul>{list.map((r) => (
            <li key={r.key}>
              <button type="button" className="go" onClick={() => go(r)}><i style={{ background: color(r) }} /><span>{r.title}<small>{r.detail}</small></span></button>
              {r.kind === "outreach"
                ? <span className="nw-asks"><button type="button" onClick={() => void answer(r, "accepted")}>Accepted</button><button type="button" onClick={() => void answer(r, "replied")}>Replied</button><button type="button" onClick={() => void answer(r, "no")}>{r.last ? "No · archive" : "No · message again"}</button>{!r.last && <button type="button" onClick={() => void answer(r, "sent")}>No · I messaged again</button>}</span>
                : <button type="button" className="snz" onClick={() => void snooze(r)}>Snooze a week</button>}
            </li>))}</ul>
        </div>
      )}
    </div>
  );
}
