import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  HISTORY_TYPES, LINK_KINDS, PALETTE, SOURCE_TYPES, ago, colorsFor, followUp, imageUrl, initials, loadBoard, loadNetwork, plusDays, post, uploadPhoto,
  type BoardItem, type HistoryType, type JobRow, companyOfPerson, loadPersonJobs, type LinkKind, type ListRow, type NetworkData, type Person, type Source, type SourceType,
} from "./network";
import NetworkGraph from "./NetworkGraph";
import NetworkMail from "./NetworkMail";
import NetworkBell from "./NetworkBell";
import NetworkWork from "./NetworkWork";
import { BulkMail } from "./NetworkMail";
import { PersonJobs, WarmJobs } from "./NetworkJobs";
import "./network.css";

type View = { kind: "all" } | { kind: "source"; id: string | null } | { kind: "due" } | { kind: "never" } | { kind: "introduced" };
type Toast = { text: string; undo?: () => void } | null;
const EMPTY: NetworkData = { people: [], sources: [], links: [] };
const SORTS: [string, string][] = [["name", "Name"], ["recent", "Last contact"], ["follow", "Follow-up"]];

/** The people around your job search: who they are, where they came from, what happened, and when to follow up. */
export default function NetworkPage({ header }: { header?: ReactNode }) {
  const [data, setData] = useState<NetworkData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  type Mode = "graph" | "list" | "jobs";
  const [mode, setModeState] = useState<Mode>(() => { try { const m = localStorage.getItem("nw-mode"); return m === "list" || m === "jobs" ? m : "graph"; } catch { return "graph"; } });
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem("nw-mode", m); } catch { /* the choice just is not remembered */ } };
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "list" | "person" | { source: Source | null }>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [mailFor, setMailFor] = useState<{ id: string; job?: JobRow } | null>(null);
  const [bulkMail, setBulkMail] = useState<string[] | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [work, setWork] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((t: Toast) => { setToast(t); window.clearTimeout(toastTimer.current); if (t) toastTimer.current = window.setTimeout(() => setToast(null), t.undo ? 6000 : 3000); }, []);

  // A phone notification opens /network?person=…, ?work=… or ?view=due: honoured once, on the first load, then the address is tidied.
  const linked = useRef(false);
  const reload = useCallback(async () => {
    try {
      const [d, b] = await Promise.all([loadNetwork(), loadBoard().catch(() => null)]); setData({ people: d.people, sources: d.sources, links: d.links, you: d.you }); if (b) setBoard(b); setError("");
      if (!linked.current) {
        linked.current = true;
        const q = new URLSearchParams(window.location.search), person = q.get("person"), work = q.get("work");
        if (person && d.people.some((p) => p.id === person)) setSelected(person);
        else if (work && b?.some((x) => x.id === work)) setWork(work);
        else if (q.get("view") === "due") setView({ kind: "due" });
        if (q.get("view") === "jobs") setModeState("jobs");
        const jobUrl = q.get("job");
        if (person && jobUrl && d.people.some((p) => p.id === person)) void loadPersonJobs(person).then((r) => { const job = r.jobs.find((j) => j.url === jobUrl); if (job) setMailFor({ id: person, job }); }).catch(() => { /* the panel is open; the jobs show there */ });
        if ([...q.keys()].length) window.history.replaceState(null, "", "/network");
      }
    }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const colors = useMemo(() => colorsFor(data), [data]);
  const sourceById = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources]);
  const personById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const counts = useMemo(() => {
    const by = new Map<string | null, number>();
    for (const p of data.people) by.set(p.sourceId, (by.get(p.sourceId) ?? 0) + 1);
    return {
      by, all: data.people.length,
      due: data.people.filter((p) => followUp(p.nextFollowUp)?.due).length,
      never: data.people.filter((p) => !p.lastContact).length,
      introduced: data.people.filter((p) => p.via).length,
    };
  }, [data.people]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: Person) => {
      if (view.kind === "source" && p.sourceId !== view.id) return false;
      if (view.kind === "due" && !followUp(p.nextFollowUp)?.due) return false;
      if (view.kind === "never" && p.lastContact) return false;
      if (view.kind === "introduced" && !p.via) return false;
      if (!q) return true;
      const src = p.sourceId ? sourceById.get(p.sourceId)?.name ?? "" : "";
      return [p.name, p.role, p.city, p.email, src, ...p.tags].some((v) => v.toLowerCase().includes(q));
    };
    const list = data.people.filter(match);
    if (sort === "recent") list.sort((a, b) => (b.lastContact ?? "").localeCompare(a.lastContact ?? "") || a.name.localeCompare(b.name));
    if (sort === "follow") list.sort((a, b) => (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999") || a.name.localeCompare(b.name));
    return list;
  }, [data.people, view, query, sort, sourceById]);

  const visible = useMemo(() => (view.kind === "all" && !query.trim() ? null : new Set(shown.map((p) => p.id))), [view, query, shown]);
  const person = selected ? personById.get(selected) ?? null : null;
  const workItem = work ? board.find((b) => b.id === work && b.kind === "work") ?? null : null;
  const openPerson = (id: string | null) => { setWork(null); setSelected(id); };
  const openWork = (id: string) => { setSelected(null); setWork(id); };
  const replacePerson = (p: Person) => setData((d) => ({ ...d, people: d.people.map((x) => (x.id === p.id ? p : x)) }));
  const viewName = view.kind === "source" ? (view.id ? sourceById.get(view.id)?.name ?? "Source" : "No source") : view.kind === "due" ? "Follow-up due" : view.kind === "never" ? "Never contacted" : view.kind === "introduced" ? "Introduced by someone" : "Everyone";

  async function archive(p: Person) {
    try {
      await post("archive", { id: p.id, archived: true });
      setData((d) => ({ ...d, people: d.people.filter((x) => x.id !== p.id) })); setSelected(null);
      say({ text: `${p.name} archived.`, undo: async () => { await post("archive", { id: p.id, archived: false }).catch(() => {}); say(null); void reload(); } });
    } catch (e) { say({ text: String((e as Error).message) }); }
  }

  return (
    <div className="rv-page nw-page">
      {header}
      <main className="nw-main">
        <div className="nw-top">
          <div className="nw-title">
            <h1>Network</h1>
            <p>{loaded ? <><b>{counts.all}</b> {counts.all === 1 ? "person" : "people"} · <b>{data.sources.length}</b> {data.sources.length === 1 ? "source" : "sources"} · <b className={counts.due ? "due" : ""}>{counts.due}</b> to follow up</> : "Loading your network…"}</p>
          </div>
          <div className="nw-actions">
            <label className="nw-search"><span className="sr">Search people</span><input id="nw-search" type="search" placeholder="Search name, company, city, email" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <button type="button" className="nw-btn" onClick={() => setDialog({ source: null })}>New source</button>
            <button type="button" className="nw-btn" onClick={() => setDialog("person")}>Add person</button>
            <button type="button" className="nw-btn main" onClick={() => setDialog("list")}>Add a list</button>
            {loaded && <NetworkBell data={data} board={board} colors={colors} onPerson={(id) => openPerson(id)} onWork={openWork} onSource={(id) => { openPerson(null); setView({ kind: "source", id }); }} say={say} />}
          </div>
        </div>
        {error && <p className="nw-error" role="alert">{error} <button type="button" onClick={() => void reload()}>Try again</button></p>}
        <div className={`nw-body${person || workItem ? " has-panel" : ""}`}>
          <nav className="nw-rail" aria-label="Show">
            <h2>Show</h2>
            <RailItem on={view.kind === "all"} color="var(--nw-muted)" label="Everyone" n={counts.all} onClick={() => setView({ kind: "all" })} />
            <RailItem on={view.kind === "due"} color="var(--nw-warn)" label="Follow-up due" n={counts.due} onClick={() => setView({ kind: "due" })} />
            <RailItem on={view.kind === "never"} color="var(--nw-muted)" label="Never contacted" n={counts.never} onClick={() => setView({ kind: "never" })} />
            <RailItem on={view.kind === "introduced"} color="var(--nw-accent)" label="Introduced by someone" n={counts.introduced} onClick={() => setView({ kind: "introduced" })} />
            <h2>Sources</h2>
            <div className="nw-rail-scroll">
              {data.sources.map((s) => (
                <div key={s.id} className="nw-rail-row">
                  <RailItem on={view.kind === "source" && view.id === s.id} color={colors.source.get(s.id) ?? ""} label={s.name} n={counts.by.get(s.id) ?? 0} onClick={() => setView({ kind: "source", id: s.id })} />
                  <button type="button" className="nw-edit" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => setDialog({ source: s })}>⋯</button>
                </div>
              ))}
              {(counts.by.get(null) ?? 0) > 0 && <RailItem on={view.kind === "source" && view.id === null} color="var(--nw-line-strong)" label="No source" n={counts.by.get(null) ?? 0} onClick={() => setView({ kind: "source", id: null })} />}
              {loaded && !data.sources.length && <p className="nw-hint">A source is where people come from: a company, an event, family. Make one, or add a list.</p>}
            </div>
          </nav>

          <section className="nw-list" aria-label={viewName}>
            <div className="nw-list-head">
              <h2>{viewName} <span>{shown.length}</span></h2>
              <div className="nw-head-r">
                {mode === "list" && <label className="nw-sort">Sort <select id="nw-sort" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
                <div className="nw-mode" role="group" aria-label="Show as">
                  <button type="button" aria-pressed={mode === "graph"} onClick={() => setMode("graph")}>Map</button>
                  <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button>
                  <button type="button" aria-pressed={mode === "jobs"} onClick={() => setMode("jobs")}>Jobs</button>
                </div>
              </div>
            </div>
            {loaded && mode === "jobs" ? (
              <WarmJobs colors={colors.person} onPerson={(id) => openPerson(id)} onReferral={(id, job) => setMailFor({ id, job })}
                onWatch={(id, on) => { void post<{ person: Person }>("person", { id, watchJobs: on }).then((r) => replacePerson(r.person)).catch((e: Error) => say({ text: e.message })); }} />
            ) : loaded && data.people.length > 0 && mode === "graph" ? (
              <NetworkGraph data={data} colors={colors} visible={visible} selected={selected} selectedWork={work} board={board} setBoard={setBoard}
                onPerson={(id) => openPerson(id === selected ? null : id)} onWork={openWork}
                onSource={(id) => { openPerson(null); setView(view.kind === "source" && view.id === id ? { kind: "all" } : { kind: "source", id }); }}
                onLinks={(links) => setData((d) => ({ ...d, links }))} onPeople={(list) => setData((d) => ({ ...d, people: d.people.map((p) => list.find((x) => x.id === p.id) ?? p) }))}
                onBulkMail={setBulkMail} say={say} />
            ) : loaded && !data.people.length ? (
              <div className="nw-empty">
                <h3>Start with the people you already talk to</h3>
                <p>Paste a list of names from LinkedIn, pick where they come from, and each one becomes a person you can keep notes on and follow up with.</p>
                <button type="button" className="nw-btn main" onClick={() => setDialog("list")}>Add a list</button>
              </div>
            ) : loaded && !shown.length ? (
              <p className="nw-none">Nobody here{query ? ` matches "${query}"` : ""}.</p>
            ) : (
              <ul className="nw-rows">
                {shown.map((p) => {
                  const f = followUp(p.nextFollowUp), src = p.sourceId ? sourceById.get(p.sourceId) : null, via = p.via ? personById.get(p.via) : null;
                  return (
                    <li key={p.id}>
                      <button type="button" className={`nw-row${p.id === selected ? " on" : ""}`} onClick={() => openPerson(p.id === selected ? null : p.id)} aria-pressed={p.id === selected}>
                        <Avatar name={p.name} photo={p.photoId} color={colors.person.get(p.id) ?? ""} source={via && src ? colors.source.get(src.id) : undefined} />
                        <span className="who"><b>{p.name}</b><small>{p.role || (via ? `Introduced by ${via.name}` : "\u00a0")}</small></span>
                        <span className="src">{src ? <><i style={{ background: colors.source.get(src.id) }} />{src.name}</> : <em>No source</em>}</span>
                        <span className="city">{p.city}</span>
                        <span className="last">{ago(p.lastContact)}</span>
                        <span className={`fu${f?.due ? " due" : ""}`}>{f ? f.text : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {workItem && <NetworkWork key={workItem.id} item={workItem} data={data} colors={colors} onClose={() => setWork(null)} onOpen={openPerson} say={say}
            onChange={(it) => setBoard((b) => b.map((x) => (x.id === it.id ? it : x)))} onRemove={(id) => { setBoard((b) => b.filter((x) => x.id !== id)); setWork(null); }}
            onWrite={(id) => setMailFor({ id })} />}
          {person && (
            <PersonPanel key={person.id} person={person} data={data} colors={colors} sourceById={sourceById} personById={personById}
              onClose={() => setSelected(null)} onChange={replacePerson} onOpen={setSelected} onArchive={() => void archive(person)} onWrite={() => setMailFor({ id: person.id })} onReferral={(job) => setMailFor({ id: person.id, job })} say={say}
              onLinks={(links) => setData((d) => ({ ...d, links }))} />
          )}
        </div>
      </main>

      {dialog === "list" && <BulkAdd sources={data.sources} onClose={() => setDialog(null)} onDone={async (msg, sourceId) => { setDialog(null); await reload(); if (sourceId) setView({ kind: "source", id: sourceId }); say({ text: msg }); }} />}
      {dialog === "person" && <AddPerson sources={data.sources} people={data.people} onClose={() => setDialog(null)} onDone={async (p) => { setDialog(null); await reload(); setSelected(p.id); say({ text: `${p.name} added.` }); }} />}
      {dialog && typeof dialog === "object" && <SourceEditor source={dialog.source} count={dialog.source ? counts.by.get(dialog.source.id) ?? 0 : 0} color={dialog.source ? colors.source.get(dialog.source.id) ?? PALETTE[0] : PALETTE[0]} onClose={() => setDialog(null)}
        onDone={async (msg, removed) => { setDialog(null); if (removed && view.kind === "source" && view.id === removed) setView({ kind: "all" }); await reload(); say({ text: msg }); }} />}
      {bulkMail && <BulkMail people={bulkMail.map((id) => personById.get(id)).filter((p): p is Person => Boolean(p))} onClose={() => setBulkMail(null)} onSent={replacePerson} say={say} />}
      {mailFor && personById.get(mailFor.id) && <NetworkMail key={`${mailFor.id}|${mailFor.job?.url ?? ""}`} person={personById.get(mailFor.id)!} job={mailFor.job} color={colors.person.get(mailFor.id) ?? ""} onClose={() => setMailFor(null)} onSent={replacePerson} say={say} />}
      {toast && <div className="nw-toast" role="status"><span>{toast.text}</span>{toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}<button type="button" className="x" aria-label="Close" onClick={() => say(null)}>×</button></div>}
    </div>
  );
}

function RailItem({ on, color, label, sub, n, onClick }: { on: boolean; color: string; label: string; sub?: string; n: number; onClick: () => void }) {
  return <button type="button" className={`nw-rail-item${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}><i style={{ background: color }} /><span>{label}{sub && <small>{sub}</small>}</span><b>{n}</b></button>;
}

function Avatar({ name, color, source, big, photo }: { name: string; color: string; source?: string; big?: boolean; photo?: string | null }) {
  return <span className={`nw-av${big ? " big" : ""}${photo ? " ph" : ""}`} style={{ "--c": color } as CSSProperties} aria-hidden="true">{photo ? <img src={imageUrl(photo)} alt="" /> : initials(name)}{source && <i style={{ background: source }} />}</span>;
}

function Swatches({ value, fallback, onPick, label }: { value: string | null; fallback: string; onPick: (c: string | null) => void; label: string }) {
  const random = () => onPick(`#${[0, 0, 0].map(() => Math.floor(80 + Math.random() * 160).toString(16).padStart(2, "0")).join("")}`);
  return (
    <div className="nw-sw" role="group" aria-label={label}>
      {PALETTE.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={value === c} onClick={() => onPick(c)} />)}
      <input type="color" aria-label="Pick any colour" value={value ?? fallback} onChange={(e) => onPick(e.target.value)} />
      <button type="button" className="txt" onClick={random}>Random</button>
      {value && <button type="button" className="txt" onClick={() => onPick(null)}>Reset</button>}
    </div>
  );
}

function PersonPanel({ person: p, data, colors, sourceById, personById, onClose, onChange, onOpen, onArchive, onWrite, onReferral, say, onLinks }: {
  person: Person; data: NetworkData; colors: ReturnType<typeof colorsFor>; sourceById: Map<string, Source>; personById: Map<string, Person>;
  onClose: () => void; onChange: (p: Person) => void; onOpen: (id: string) => void; onArchive: () => void; onWrite: () => void; onReferral: (job: JobRow) => void; say: (t: Toast) => void; onLinks: (l: NetworkData["links"]) => void;
}) {
  const [draft, setDraft] = useState(p);
  const [saving, setSaving] = useState("");
  const [hType, setHType] = useState<HistoryType>("note");
  const [hText, setHText] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkKind, setLinkKind] = useState<LinkKind>("other");
  const [linkLabel, setLinkLabel] = useState("");
  // A save (or a reload) brings a new copy of this person: start editing from it.
  const [seen, setSeen] = useState(p);
  if (seen !== p) { setSeen(p); setDraft(p); }

  async function save(fields: Partial<Person>) {
    setSaving("Saving…");
    try { const r = await post<{ person: Person }>("person", { id: p.id, ...fields }); onChange(r.person); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); setDraft(p); say({ text: String((e as Error).message) }); }
  }
  const field = (k: "name" | "role" | "city" | "email" | "linkedin" | "phone", label: string, type = "text") => (
    <label className="nw-f"><span>{label}</span><input id={`nw-${k}`} type={type} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      onBlur={() => { if (draft[k] !== p[k]) void save({ [k]: draft[k] }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
  );
  async function addHistory() {
    try { const r = await post<{ person: Person }>("history", { id: p.id, type: hType, text: hText }); onChange(r.person); setHText(""); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function dropHistory(entryId: string) {
    try { const r = await post<{ person: Person }>("history/remove", { id: p.id, entryId }); onChange(r.person); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function connect() {
    if (!linkTo) return;
    try { await post("link", { a: p.id, b: linkTo, kind: linkKind, label: linkLabel }); const d = await loadNetwork(); onLinks(d.links); setLinkTo(""); setLinkLabel(""); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function disconnect(id: string) {
    try { await post("link/remove", { id }); onLinks(data.links.filter((l) => l.id !== id)); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  const src = p.sourceId ? sourceById.get(p.sourceId) : null, via = p.via ? personById.get(p.via) : null;
  const color = colors.person.get(p.id) ?? "";
  const links = data.links.filter((l) => l.a === p.id || l.b === p.id).map((l) => {
    const other = l.a === p.id ? l.b : l.a;
    return { l, name: personById.get(other)?.name ?? sourceById.get(other)?.name ?? "Someone archived", id: other, isPerson: personById.has(other) };
  });
  const f = followUp(p.nextFollowUp);
  const others = [...data.people.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name })), ...data.sources.map((s) => ({ id: s.id, name: `${s.name} (source)` }))];
  return (
    <aside className="nw-panel" aria-label={p.name}>
      <div className="nw-ph">
        <label className="nw-photo" title={p.photoId ? "Change the photo" : "Add a photo"}>
          <Avatar big name={draft.name || p.name} photo={p.photoId} color={color} source={via && src ? colors.source.get(src.id) : undefined} />
          <span className="nw-photo-tip">{p.photoId ? "Change" : "+ Photo"}</span>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setSaving("Uploading…"); uploadPhoto(f).then((id) => save({ photoId: id })).catch((err: Error) => { setSaving(""); say({ text: err.message }); }); } }} />
        </label>
        <div className="nw-ph-text">
          <input className="nw-name" aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => { if (draft.name.trim() && draft.name !== p.name) void save({ name: draft.name }); else setDraft({ ...draft, name: p.name }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <input className="nw-role" aria-label="Role" placeholder="Role, like Senior recruiter" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} onBlur={() => { if (draft.role !== p.role) void save({ role: draft.role }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
        <span className="nw-saving" aria-live="polite">{saving}</span>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="nw-scroll">
        <div className="nw-pair">
          <label className="nw-f"><span>Belongs to</span>
            <select id="nw-source" value={p.sourceId ?? ""} onChange={(e) => void save({ sourceId: e.target.value || null })}>
              <option value="">No source</option>{data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="nw-f"><span>Introduced by</span>
            <select id="nw-via" value={p.via ?? ""} onChange={(e) => void save({ via: e.target.value || null })}>
              <option value="">Nobody (a first connection)</option>{data.people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
        </div>
        {via && <p className="nw-lineage"><i style={{ background: src ? colors.source.get(src.id) : "var(--nw-muted)" }} />{src ? <>Belongs to <b>{src.name}</b>, </> : null}introduced by <button type="button" onClick={() => onOpen(via.id)}>{via.name}</button>. Their own colour starts a new branch.</p>}
        {p.photoId && <button type="button" className="nw-chip nw-photo-rm" onClick={() => void save({ photoId: null })}>Remove photo</button>}
        <div className="nw-lab">Colour</div>
        <Swatches value={p.color} fallback={color} label="Colour" onPick={(c) => void save({ color: c })} />
        <div className="nw-grid">
          {field("city", "City")}{field("email", "Email", "email")}{field("linkedin", "LinkedIn")}{field("phone", "Phone", "tel")}
        </div>
        {p.linkedin && <a className="nw-out" href={p.linkedin} target="_blank" rel="noreferrer">Open LinkedIn profile ↗</a>}
        <label className="nw-f nw-works"><span>Works at</span><input id="nw-company" value={draft.company} placeholder={companyOfPerson({ ...p, company: "" }, sourceById) || "Company"}
          onChange={(e) => setDraft({ ...draft, company: e.target.value })} onBlur={() => { if (draft.company !== p.company) void save({ company: draft.company }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
        <div className="nw-lab">Jobs at {companyOfPerson(p, sourceById) || "their company"}</div>
        <PersonJobs person={p} company={companyOfPerson(p, sourceById)} onReferral={onReferral} watching={p.watchJobs} onWatch={(on) => void save({ watchJobs: on })} />
        <div className="nw-lab">Follow up</div>
        <div className="nw-fu">
          <input id="nw-followup" type="date" aria-label="Follow-up date" value={p.nextFollowUp ?? ""} onChange={(e) => void save({ nextFollowUp: e.target.value || null })} />
          {[["+3 days", 3], ["+1 week", 7], ["+2 weeks", 14]].map(([l, n]) => <button key={l} type="button" className="nw-chip" onClick={() => void save({ nextFollowUp: plusDays(n as number) })}>{l}</button>)}
          {p.nextFollowUp && <button type="button" className="nw-chip" onClick={() => void save({ nextFollowUp: null })}>Clear</button>}
          <span className={`nw-fu-say${f?.due ? " due" : ""}`}>{f ? `Due ${f.text}` : "Not set"} · last contact {ago(p.lastContact)}</span>
        </div>
        <div className="nw-lab">Connected to</div>
        <ul className="nw-links">
          {links.map(({ l, name, id, isPerson }) => (
            <li key={l.id}><i style={{ background: l.color ?? (isPerson ? colors.person.get(id) : colors.source.get(id)) }} />
              {isPerson ? <button type="button" className="nw-linkname" onClick={() => onOpen(id)}>{name}</button> : <span className="nw-linkname">{name}</span>}
              <small>{l.label || LINK_KINDS.find(([k]) => k === l.kind)?.[1]}</small>
              <button type="button" className="nw-x small" aria-label={`Remove the connection to ${name}`} onClick={() => void disconnect(l.id)}>×</button></li>
          ))}
          {!links.length && <li className="nw-muted">No other connections yet.</li>}
        </ul>
        <div className="nw-connect">
          <select id="nw-link-to" aria-label="Connect to" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}><option value="">Connect to…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select id="nw-link-kind" aria-label="Kind of connection" value={linkKind} onChange={(e) => setLinkKind(e.target.value as LinkKind)}>{LINK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input id="nw-link-label" aria-label="What is it" placeholder="What is it, like same office" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
          <button type="button" className="nw-btn" disabled={!linkTo} onClick={() => void connect()}>Connect</button>
        </div>
        <div className="nw-lab">Notes</div>
        <textarea id="nw-notes" className="nw-notes" aria-label="Notes" placeholder="What they said, what they prefer, what you promised." value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} onBlur={() => { if (draft.notes !== p.notes) void save({ notes: draft.notes }); }} />
        <div className="nw-lab">History</div>
        <div className="nw-hadd">
          <select id="nw-htype" aria-label="What happened" value={hType} onChange={(e) => setHType(e.target.value as HistoryType)}>{HISTORY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input id="nw-htext" aria-label="Details" placeholder={hType === "note" ? "Write a note" : "Details (optional)"} value={hText} onChange={(e) => setHText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addHistory(); }} />
          <button type="button" className="nw-btn" onClick={() => void addHistory()}>Add to history</button>
        </div>
        <ul className="nw-hist">
          {[...p.history].reverse().map((h) => (
            <li key={h.id}><time dateTime={h.at}>{new Date(h.at).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
              <span><b>{HISTORY_TYPES.find(([k]) => k === h.type)?.[1]}</b>{h.text ? ` · ${h.text}` : ""}</span>
              <button type="button" className="nw-x small" aria-label="Remove this entry" onClick={() => void dropHistory(h.id)}>×</button></li>
          ))}
          {!p.history.length && <li className="nw-muted">Nothing yet. Log a message, call or note above.</li>}
        </ul>
      </div>
      <div className="nw-pf">
        <button type="button" className="nw-btn main nw-write" onClick={onWrite}>Write email to {p.name.split(" ")[0]}</button>
        <button type="button" className="nw-btn ghost" onClick={onArchive}>Archive</button>
      </div>
    </aside>
  );
}

function Dialog({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="nw-dim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`nw-dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="nw-dh"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

function SourcePicker({ sources, value, onChange, newName, setNewName, newType, setNewType }: { sources: Source[]; value: string; onChange: (v: string) => void; newName: string; setNewName: (v: string) => void; newType: SourceType; setNewType: (v: SourceType) => void }) {
  return (
    <div className="nw-pick">
      <label className="nw-f"><span>They belong to</span>
        <select id="nw-pick-source" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="__new">A new source…</option><option value="">No source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      {value === "__new" && <>
        <label className="nw-f"><span>Source name</span><input id="nw-new-source" placeholder="Randstad, All Things Open, Family…" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="nw-f"><span>Kind</span><select id="nw-new-type" value={newType} onChange={(e) => setNewType(e.target.value as SourceType)}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
      </>}
    </div>
  );
}

function BulkAdd({ sources, onClose, onDone }: { sources: Source[]; onClose: () => void; onDone: (msg: string, sourceId: string | null) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [source, setSource] = useState(sources.length ? sources[0].id : "__new");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<SourceType>("company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!text.trim()) return;
    let on = true;
    const t = window.setTimeout(() => { setChecking(true); post<{ rows: ListRow[] }>("preview", { text }).then((r) => on && setRows(r.rows)).catch((e) => on && setError(String(e.message))).finally(() => on && setChecking(false)); }, 350);
    return () => { on = false; window.clearTimeout(t); };
  }, [text]);
  const listed = text.trim() ? rows : [];
  const fresh = listed.filter((r) => !r.exists && !r.repeat);
  const ready = fresh.length > 0 && (source !== "__new" || newName.trim().length > 0) && !busy;
  async function add() {
    setBusy(true); setError("");
    try {
      const r = await post<{ added: Person[]; skipped: string[]; sourceId: string | null }>("people", { rows: fresh.map(({ name, city }) => ({ name, city })), ...(source === "__new" ? { newSource: { name: newName, type: newType } } : { sourceId: source || null }) });
      const where = source === "__new" ? newName.trim() : sources.find((s) => s.id === source)?.name;
      onDone(`Added ${r.added.length} ${r.added.length === 1 ? "person" : "people"}${where ? ` to ${where}` : ""}.${r.skipped.length ? ` Skipped ${r.skipped.length} already here.` : ""}`, r.sourceId);
    } catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  return (
    <Dialog wide title="Add a list" sub="One name per line. Anything after a dash becomes the city. Names already in your network are skipped." onClose={onClose}>
      <div className="nw-bulk">
        <textarea id="nw-bulk-text" autoFocus spellCheck={false} aria-label="Names, one per line" placeholder={"Dana Whitlock\nMarco Lindt - Durham, NC\nPriya Okafor"} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="nw-prev" aria-live="polite">
          {!listed.length ? <p className="nw-muted">{checking ? "Reading the list…" : "Each name shows here before anything is saved."}</p> : listed.map((r, i) => (
            <div key={i} className={r.exists || r.repeat ? "skip" : ""}><span>{r.name}</span><small>{r.exists ? "already here" : r.repeat ? "repeated" : r.city}</small></div>
          ))}
        </div>
      </div>
      <SourcePicker sources={sources} value={source} onChange={setSource} newName={newName} setNewName={setNewName} newType={newType} setNewType={setNewType} />
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df"><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={!ready} onClick={() => void add()}>{busy ? "Adding…" : fresh.length ? `Add ${fresh.length} ${fresh.length === 1 ? "person" : "people"}` : "Add"}</button></div>
    </Dialog>
  );
}

function AddPerson({ sources, people, onClose, onDone }: { sources: Source[]; people: Person[]; onClose: () => void; onDone: (p: Person) => void }) {
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState("");
  const [source, setSource] = useState(sources.length ? sources[0].id : "");
  const [newName, setNewName] = useState(""); const [newType, setNewType] = useState<SourceType>("company");
  const [via, setVia] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true); setError("");
    try {
      let sourceId: string | null = source || null;
      if (source === "__new") sourceId = (await post<{ source: Source }>("source", { name: newName, type: newType })).source.id;
      const r = await post<{ person: Person }>("person", { name, role, email, sourceId, via: via || null });
      onDone(r.person);
    } catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  return (
    <Dialog title="Add person" onClose={onClose}>
      <div className="nw-form">
        <label className="nw-f"><span>Name</span><input id="nw-add-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" /></label>
        <label className="nw-f"><span>Role</span><input id="nw-add-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior recruiter" /></label>
        <label className="nw-f"><span>Email</span><input id="nw-add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" /></label>
        <SourcePicker sources={sources} value={source} onChange={setSource} newName={newName} setNewName={setNewName} newType={newType} setNewType={setNewType} />
        <label className="nw-f"><span>Introduced by</span><select id="nw-add-via" value={via} onChange={(e) => setVia(e.target.value)}><option value="">Nobody (a first connection)</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df"><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={!name.trim() || busy || (source === "__new" && !newName.trim())} onClick={() => void add()}>{busy ? "Adding…" : "Add person"}</button></div>
    </Dialog>
  );
}

function SourceEditor({ source, count, color, onClose, onDone }: { source: Source | null; count: number; color: string; onClose: () => void; onDone: (msg: string, removed?: string) => void }) {
  const [name, setName] = useState(source?.name ?? ""); const [type, setType] = useState<SourceType>(source?.type ?? "company");
  const [about, setAbout] = useState(source?.about ?? ""); const [pick, setPick] = useState<string | null>(source?.color ?? null);
  const [confirm, setConfirm] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError("");
    try { const r = await post<{ source: Source & { existed?: boolean } }>("source", { ...(source ? { id: source.id } : {}), name, type, about, color: pick }); onDone(source ? `${name.trim()} saved.` : r.source.existed ? `You already have ${r.source.name}. Nothing new was made.` : `${name.trim()} added. Add people to it with Add a list.`); }
    catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  async function remove() {
    if (!source) return;
    try { await post("source/remove", { id: source.id }); onDone(`${source.name} removed. Its ${count} ${count === 1 ? "person stays" : "people stay"}, with no source.`, source.id); }
    catch (e) { setError(String((e as Error).message)); }
  }
  return (
    <Dialog title={source ? `Edit ${source.name}` : "New source"} sub="Where people come from. Everyone you reach through it shares its colour." onClose={onClose}>
      <div className="nw-form">
        <label className="nw-f"><span>Name</span><input id="nw-src-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Randstad, All Things Open, Family…" /></label>
        <label className="nw-f"><span>Kind</span><select id="nw-src-type" value={type} onChange={(e) => setType(e.target.value as SourceType)}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
        <label className="nw-f"><span>About</span><input id="nw-src-about" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Staffing agency, open-source conference…" /></label>
        <div className="nw-lab">Colour</div>
        <Swatches value={pick} fallback={color} label="Source colour" onPick={setPick} />
      </div>
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df">
        {source && (confirm ? <span className="nw-confirm">Remove {source.name}? <button type="button" className="nw-btn danger" onClick={() => void remove()}>Remove</button><button type="button" className="nw-btn" onClick={() => setConfirm(false)}>Keep</button></span>
          : <button type="button" className="nw-btn ghost" onClick={() => setConfirm(true)}>Remove source</button>)}
        <span className="grow" />
        <button type="button" className="nw-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="nw-btn main" disabled={!name.trim() || busy} onClick={() => void save()}>{source ? "Save" : "Create source"}</button>
      </div>
    </Dialog>
  );
}
