import { useState, type CSSProperties } from "react";
import { initials, post, workProgress, type BoardItem, type NetworkData, colorsFor } from "./network";

const fmt = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/** A piece of work with people (a contribution, a review, a project): its dates, how far along it is, who is involved and what is next. */
export default function NetworkWork({ item, data, colors, onClose, onChange, onRemove, onOpen, onWrite, say }: {
  item: BoardItem; data: NetworkData; colors: ReturnType<typeof colorsFor>; onClose: () => void; onChange: (it: BoardItem) => void; onRemove: (id: string) => void;
  onOpen: (id: string) => void; onWrite: (personId: string) => void; say: (t: { text: string } | null) => void;
}) {
  const [draft, setDraft] = useState({ title: item.title ?? "", next: item.next ?? "", notes: item.notes ?? "" });
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState("");
  async function save(fields: Partial<BoardItem>) {
    try { const r = await post<{ item: BoardItem }>("board/save", { id: item.id, ...fields }); onChange(r.item); }
    catch (e) { say({ text: String((e as Error).message) }); setDraft({ title: item.title ?? "", next: item.next ?? "", notes: item.notes ?? "" }); }
  }
  async function remove() { try { await post("board/remove", { id: item.id }); onRemove(item.id); say({ text: `${item.title} removed.` }); } catch (e) { say({ text: String((e as Error).message) }); } }
  const pr = workProgress(item), people = (item.people ?? []).map((id) => data.people.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const state = item.done ? "Done" : pr.late ? `${-pr.left} day${pr.left === -1 ? "" : "s"} past the end` : pr.ending ? (pr.left === 0 ? "Ends today" : `Ends in ${pr.left} day${pr.left === 1 ? "" : "s"}`) : "In progress";
  const tone = item.done ? "ok" : pr.late ? "bad" : pr.ending ? "warn" : "";
  const blur = (k: "title" | "next" | "notes") => () => { if (draft[k] !== (item[k] ?? "")) { if (k === "title" && !draft.title.trim()) { setDraft({ ...draft, title: item.title ?? "" }); return; } void save({ [k]: draft[k] }); } };
  return (
    <aside className="nw-panel nw-work" aria-label={item.title}>
      <div className="nw-ph">
        <span className={`nw-wicon ${tone}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8.5A1.5 1.5 0 014.5 7h15A1.5 1.5 0 0121 8.5v10a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5zM9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M3 13h18" /></svg></span>
        <div className="nw-ph-text">
          <input className="nw-name" aria-label="Name of the work" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={blur("title")} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <span className={`nw-wstate ${tone}`}>{state}</span>
        </div>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="nw-scroll">
        <div className="nw-lab">Timeframe</div>
        <div className="nw-pair">
          <label className="nw-f"><span>Starts</span><input id="nw-work-start" type="date" value={item.start ?? ""} onChange={(e) => e.target.value && void save({ start: e.target.value })} /></label>
          <label className="nw-f"><span>Ends</span><input id="nw-work-end" type="date" value={item.end ?? ""} onChange={(e) => e.target.value && void save({ end: e.target.value })} /></label>
        </div>
        <div className={`nw-bar ${tone}`} role="img" aria-label={`Day ${pr.day} of ${pr.total}`}><i style={{ width: `${(item.done ? 1 : pr.f) * 100}%` }} /><u style={{ left: `calc(${pr.f * 100}% - 1px)` }} /></div>
        <div className="nw-bar-l"><span>{fmt(item.start)}</span><span>{item.done ? "finished" : `day ${pr.day} of ${pr.total} · ${Math.max(0, pr.left)} left`}</span><span>{fmt(item.end)}</span></div>
        <div className="nw-lab">Who is involved</div>
        <ul className="nw-links">
          {people.map((p) => (
            <li key={p.id}><span className="nw-av" style={{ "--c": colors.person.get(p.id) } as CSSProperties}>{initials(p.name)}</span>
              <button type="button" className="nw-linkname" onClick={() => onOpen(p.id)}>{p.name}</button>
              <button type="button" className="nw-chip" onClick={() => onWrite(p.id)}>Write</button>
              <button type="button" className="nw-x small" aria-label={`Take ${p.name} off this work`} onClick={() => void save({ people: (item.people ?? []).filter((x) => x !== p.id) })}>×</button></li>
          ))}
          {!people.length && <li className="nw-muted">Nobody yet. Add the people you do this with.</li>}
        </ul>
        <div className="nw-connect">
          <select id="nw-work-add" aria-label="Add a person" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a person…</option>{data.people.filter((p) => !(item.people ?? []).includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="nw-btn" disabled={!adding} onClick={() => { void save({ people: [...(item.people ?? []), adding] }); setAdding(""); }}>Add</button>
        </div>
        <div className="nw-lab">Next step</div>
        <input id="nw-work-next" className="nw-wnext" placeholder="Open the pull request, send the second draft…" value={draft.next} onChange={(e) => setDraft({ ...draft, next: e.target.value })} onBlur={blur("next")} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        <div className="nw-lab">Notes</div>
        <textarea id="nw-work-notes" className="nw-notes" value={draft.notes} placeholder="What was agreed, links, who reviews what." onChange={(e) => setDraft({ ...draft, notes: e.target.value })} onBlur={blur("notes")} />
        <p className="nw-muted" style={{ marginTop: 10 }}>The bell reminds you a week before it ends, and again if it runs over.</p>
      </div>
      <div className="nw-pf">
        <button type="button" className={`nw-btn ${item.done ? "" : "main"} nw-write`} onClick={() => void save({ done: !item.done })}>{item.done ? "Reopen" : "Mark done"}</button>
        {confirm ? <><button type="button" className="nw-btn danger" onClick={() => void remove()}>Remove</button><button type="button" className="nw-btn" onClick={() => setConfirm(false)}>Keep</button></>
          : <button type="button" className="nw-btn ghost" onClick={() => setConfirm(true)}>Remove</button>}
      </div>
    </aside>
  );
}
