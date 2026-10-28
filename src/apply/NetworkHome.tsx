import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ago, imageUrl, loadMaps, loadNetwork, loadWholeNetwork, post, setActiveMap, sourceLabel, type MapInfo, type NetworkData } from "./network";
import { previewSaved } from "./networkPicture";
import "./network.css";

// The Network home page: your maps as cards, New map, and Open a saved file (a copy made with Export becomes a new map).

type OpenResult = { map: { id: string; name: string }; summary: { people: { added: number; matched: number }; sources: { added: number; matched: number }; links: number; board: number; left: number } };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What opening a file did, in one sentence for the map it opens. */
function opened(r: OpenResult) {
  const s = r.summary, parts: string[] = [];
  if (s.people.added) parts.push(plural(s.people.added, "new person", "new people"));
  if (s.people.matched) parts.push(s.people.added ? `${s.people.matched} already in your network (left as they are)` : `${s.people.matched === 1 ? "the one person" : `all ${s.people.matched} people`} already in your network (left as they are)`);
  if (!parts.length) parts.push("nobody in it");
  if (s.sources.added) parts.push(plural(s.sources.added, "new source"));
  return `Opened ${r.map.name}: ${parts.join(", ")}.${s.left ? ` ${plural(s.left, "picture or item")} could not come with it.` : ""}`;
}

export default function NetworkHome({ header, onOpen }: { header?: ReactNode; onOpen: (id: string, message?: string) => void }) {
  setActiveMap("main");
  const [maps, setMaps] = useState<MapInfo[] | null>(null);
  const [error, setError] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try { await previewSaved(); setMaps(await loadMaps()); setError(""); } catch (e) { setError(String((e as Error).message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    const name = (naming ?? "").trim(); if (!name) return;
    setBusy("new");
    try { const r = await post<{ map: MapInfo }>("maps/save", { name }); onOpen(r.map.id, `${r.map.name} is ready. Add people from your network or new ones with +.`); }
    catch (e) { setError(String((e as Error).message)); setBusy(""); }
  }
  async function openFile(file: File) {
    setError(""); setBusy("open");
    try {
      if (file.size > 7_500_000) throw new Error("That file is too big to open here (over 7.5 MB).");
      let json: { type?: string; name?: string } & Record<string, unknown>;
      try { json = JSON.parse(await file.text()); } catch { throw new Error("That file is not a saved map. Pick a .json file made with Export, Save a copy."); }
      if (json?.type !== "atriveo-network") throw new Error("That file is not a saved map. Pick a .json file made with Export, Save a copy.");
      const name = file.name.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim() || json.name || "Opened map";
      const r = await post<OpenResult>("maps/open", { name, file: json });
      onOpen(r.map.id, opened(r));
    } catch (e) { setError(String((e as Error).message || e)); setBusy(""); }
  }
  async function rename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) { setRenaming(null); return; }
    try { await post("maps/save", { id: renaming.id, name }); setMaps((m) => m && m.map((x) => (x.id === renaming.id ? { ...x, name } : x))); } catch (e) { setError(String((e as Error).message)); }
    setRenaming(null);
  }
  async function remove(id: string) {
    try { await post("maps/remove", { id }); setMaps((m) => m && m.filter((x) => x.id !== id)); } catch (e) { setError(String((e as Error).message)); }
    setConfirm(null);
  }

  return (
    <div className="rv-page nw-page nwh-page" onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === "file")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void openFile(f); }}>
      {header}
      <main className="nwh">
        <section className="nwh-head">
          <div>
            <h1>Network</h1>
            <p>Maps of the people around your job search. My network holds everyone; make a map for one search, one event or one company.</p>
          </div>
          <div className="nwh-actions">
            <button type="button" className="nw-btn ghost" disabled={busy === "open"} onClick={() => fileInput.current?.click()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A1.5 1.5 0 015.5 6H10l2 2h6.5A1.5 1.5 0 0120 9.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" /></svg>
              {busy === "open" ? "Opening…" : "Open a saved file"}</button>
            <button type="button" className="nw-btn main" onClick={() => setNaming((n) => (n === null ? "" : n))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New map</button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openFile(f); }} />
          </div>
        </section>
        {error && <p className="nw-error" role="alert">{error}</p>}
        <ul className="nwh-grid" aria-label="Your maps">
          {naming !== null && (
            <li className="nwh-card nwh-new">
              <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
                <div className="nwh-thumb blank" aria-hidden="true"><span className="nwh-you">You</span></div>
                <div className="nwh-meta">
                  <input id="nwh-new-name" autoFocus aria-label="Name of the new map" placeholder="Fall 2026 search, All Things Open…" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }} />
                  <div className="nwh-row"><button type="button" className="nw-btn ghost" onClick={() => setNaming(null)}>Cancel</button><button type="submit" className="nw-btn main" disabled={!naming.trim() || busy === "new"}>Create</button></div>
                </div>
              </form>
            </li>
          )}
          {(maps ?? []).map((m) => (
            <li key={m.id} className="nwh-card">
              <button type="button" className="nwh-open" onClick={() => onOpen(m.id)} aria-label={`Open ${m.name}`}>
                <div className={`nwh-thumb${m.thumbId ? "" : " blank"}`}>{m.thumbId ? <img src={imageUrl(m.thumbId)} alt="" loading="lazy" /> : <span className="nwh-you" aria-hidden="true">You</span>}
                  {m.main && <span className="nwh-tag">Everyone</span>}</div>
              </button>
              <div className="nwh-meta">
                {renaming?.id === m.id
                  ? <input autoFocus aria-label="Map name" value={renaming.name} onChange={(e) => setRenaming({ id: m.id, name: e.target.value })} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(null); }} />
                  : <h2><button type="button" onClick={() => onOpen(m.id)}>{m.name}</button></h2>}
                <p>{plural(m.people, "person", "people")}{m.updatedAt ? ` · edited ${ago(m.updatedAt)}` : ""}</p>
                {confirm === m.id
                  ? <div className="nwh-row confirm"><span>Delete this map? Its people stay in your network.</span><button type="button" className="nw-btn danger" onClick={() => void remove(m.id)}>Delete</button><button type="button" className="nw-btn ghost" onClick={() => setConfirm(null)}>Keep</button></div>
                  : <div className="nwh-tools">
                    <button type="button" className="nw-chip" onClick={() => setRenaming({ id: m.id, name: m.name })}>Rename</button>
                    {!m.main && <button type="button" className="nw-chip" onClick={() => setConfirm(m.id)}>Delete</button>}
                  </div>}
              </div>
            </li>
          ))}
          {maps === null && !error && [0, 1, 2].map((i) => <li key={i} className="nwh-card loading" aria-hidden="true"><div className="nwh-thumb blank" /><div className="nwh-meta"><i /><i /></div></li>)}
        </ul>
        <p className="nwh-foot">Drop a saved .json file anywhere on this page to open it as a new map. People already in your network are matched by email, LinkedIn or name and left as they are.</p>
      </main>
      {dragging && <div className="nwh-drop" aria-hidden="true"><span>Drop to open as a new map</span></div>}
    </div>
  );
}

/** On a map: put people (or a whole source with its people) from your network on it. */
export function PickFromNetwork({ mapName, onClose, onDone }: { mapName: string; onClose: () => void; onDone: (n: number) => void }) {
  const [all, setAll] = useState<NetworkData | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    // What this map already has comes from the map's own view; everyone else is offered.
    void Promise.all([loadWholeNetwork(), loadNetwork()]).then(([w, here]) => { if (live) { setAll(w); setOn(new Set([...here.people.map((p) => p.id), ...(here.onMap ?? [])])); } })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const term = q.trim().toLowerCase(), hit = (s: string) => !term || s.toLowerCase().includes(term);
  const people = (all?.people ?? []).filter((p) => !on.has(p.id) && hit([p.name, p.role, p.company, p.city].join(" ")));
  const sources = (all?.sources ?? []).filter((s) => hit(s.name));
  const toggle = (ids: string[], value: boolean) => setPick((cur) => { const n = new Set(cur); for (const id of ids) { if (value) n.add(id); else n.delete(id); } return n; });
  async function add() {
    setBusy(true);
    try { await post("maps/add", { ids: [...pick] }); onDone(pick.size); } catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  return (
    <div className="nw-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nw-dialog wide nwh-pick" role="dialog" aria-modal="true" aria-label={`Add to ${mapName}`}>
        <div className="nw-dh"><div><h2>Add to {mapName}</h2><p>People and sources from your network. A source brings its people with it.</p></div><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
        <label className="nw-search"><span className="sr">Search</span><input id="nwh-pick-q" autoFocus type="search" placeholder="Name, company, city…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {!all ? <p className="nw-muted">{error || "Loading your network…"}</p> : <div className="nwh-pick-cols">
          <section><h3>Sources</h3><ul>{sources.map((s) => {
            const members = all.people.filter((p) => p.sourceId === s.id).map((p) => p.id), ids = [s.id, ...members], checked = ids.every((id) => pick.has(id) || on.has(id));
            return <li key={s.id}><label><input type="checkbox" checked={checked} disabled={ids.every((id) => on.has(id))} onChange={(e) => toggle(ids.filter((id) => !on.has(id)), e.target.checked)} /><span><b>{sourceLabel(s, all.sources, all.people)}</b><small>{plural(members.length, "person", "people")}</small></span></label></li>;
          })}{!sources.length && <li className="nw-muted">No sources match.</li>}</ul></section>
          <section><h3>People</h3><ul>{people.slice(0, 200).map((p) => (
            <li key={p.id}><label><input type="checkbox" checked={pick.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} /><span><b>{p.name}</b><small>{[p.role, p.company].filter(Boolean).join(" · ") || " "}</small></span></label></li>))}
            {!people.length && <li className="nw-muted">{term ? "Nobody matches." : "Everyone is on this map already."}</li>}{people.length > 200 && <li className="nw-muted">And {people.length - 200} more. Search to narrow it down.</li>}</ul></section>
        </div>}
        {error && all && <p className="nw-error" role="alert">{error}</p>}
        <div className="nw-df"><span className="grow nw-muted">{pick.size ? `${plural(pick.size, "card")} selected` : ""}</span><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={!pick.size || busy} onClick={() => void add()}>Add to this map</button></div>
      </div>
    </div>
  );
}
