import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  sourceLabel, throughFields, throughValue, introducersOf, HISTORY_TYPES, LINK_KINDS, PALETTE, SOURCE_TYPES, ago, colorsFor, followUp, imageUrl, initials, loadBoard, loadNetwork, plusDays, post, uploadPhoto,
  type BoardItem, type HistoryType, type JobRow, companyOfPerson, loadPersonJobs, type LinkKind, type ListRow, type NetworkData, type Person, type Source, type SourceType,
} from "./network";
import NetworkGraph from "./NetworkGraph";
import NetworkSourceContext from "./NetworkSourceContext";
import { CanvasButton, CanvasIcon, CanvasMenuAction } from "./NetworkCanvasControls";
import { DEFAULT_CANVAS_LAYERS, type CanvasLayers } from "./network";
import NetworkMail from "./NetworkMail";
import NetworkBell from "./NetworkBell";
import NetworkWork from "./NetworkWork";
import { BulkMail } from "./NetworkMail";
import { PersonJobs, WarmJobs } from "./NetworkJobs";
import NetworkImport from "./NetworkImport";
import { SourcePanel, YouPanel } from "./NetworkSidePanels";
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
  const [drawer, setDrawer] = useState<null | "layers" | "search" | "add">(null);
  const [layers, setLayers] = useState<CanvasLayers>({ ...DEFAULT_CANVAS_LAYERS });
  const [stackPeople, setStackPeople] = useState(false);
  const toggleDrawer = (next: "layers" | "search" | "add") => setDrawer((current) => current === next ? null : next);
  useEffect(() => {
    if (!drawer) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest('[data-canvas-controls]')) setDrawer(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null); };
    document.addEventListener('pointerdown', away); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', escape); };
  }, [drawer]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "list" | "person" | "import" | { source: Source | null }>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [mailFor, setMailFor] = useState<{ id: string; job?: JobRow } | null>(null);
  const [bulkMail, setBulkMail] = useState<string[] | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [work, setWork] = useState<string | null>(null);
  // The other things the panel can show: you, or a source.
  const [side, setSide] = useState<null | "you" | { source: string }>(null);
  const [bulkSource, setBulkSource] = useState<string | null>(null);
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
        const fromLinkedIn = q.get("linkedin");
        if (fromLinkedIn) {
          // The extension's LinkedIn button, when no Atriveo tab was open: add the person it read, then open them.
          let profile: unknown = null; try { profile = JSON.parse(fromLinkedIn); } catch { /* a broken link adds nobody */ }
          if (profile && typeof profile === "object") void post<{ person: Person; existed: boolean }>("linkedin", profile).then(async (r) => {
            const fresh = await loadNetwork(); setData({ people: fresh.people, sources: fresh.sources, links: fresh.links, you: fresh.you });
            setSelected(r.person.id); say({ text: r.existed ? `${r.person.name} is already in your Network.` : `Added ${r.person.name} from LinkedIn.` });
          }).catch((e: Error) => say({ text: e.message }));
        }
        if (person && jobUrl && d.people.some((p) => p.id === person)) void loadPersonJobs(person).then((r) => { const job = r.jobs.find((j) => j.url === jobUrl); if (job) setMailFor({ id: person, job }); }).catch(() => { /* the panel is open; the jobs show there */ });
        if ([...q.keys()].length) window.history.replaceState(null, "", "/network");
      }
    }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoaded(true); }
  }, [say]);
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
      return [p.name, p.role, p.company, p.city, p.email, src, ...p.tags].some((v) => v.toLowerCase().includes(q));
    };
    const list = data.people.filter(match);
    if (sort === "recent") list.sort((a, b) => (b.lastContact ?? "").localeCompare(a.lastContact ?? "") || a.name.localeCompare(b.name));
    if (sort === "follow") list.sort((a, b) => (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999") || a.name.localeCompare(b.name));
    return list;
  }, [data.people, view, query, sort, sourceById]);

  const visible = useMemo(() => (view.kind === "all" && !query.trim() ? null : new Set(shown.map((p) => p.id))), [view, query, shown]);
  const person = selected ? personById.get(selected) ?? null : null;
  const workItem = work ? board.find((b) => b.id === work && b.kind === "work") ?? null : null;
  const openPerson = (id: string | null) => { setWork(null); setSide(null); setSelected(id); };
  const openWork = (id: string) => { setSelected(null); setSide(null); setWork(id); };
  const openSource = (id: string) => { setSelected(null); setWork(null); setSide({ source: id }); setView({ kind: "source", id }); };
  const openYou = () => { setSelected(null); setWork(null); setSide("you"); };
  const sideSource = side && typeof side === "object" ? sourceById.get(side.source) ?? null : null;
  const replacePerson = (p: Person) => setData((d) => ({ ...d, people: d.people.map((x) => (x.id === p.id ? p : x)) }));
  const viewName = view.kind === "source" ? (view.id ? (sourceById.has(view.id) ? sourceLabel(sourceById.get(view.id)!, data.sources, data.people) : "Source") : "No source") : view.kind === "due" ? "Follow-up due" : view.kind === "never" ? "Never contacted" : view.kind === "introduced" ? "Introduced by someone" : "Everyone";

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
        <div className="nw-top" data-canvas-controls>
          <div className="nw-canvas-island nw-canvas-left" role="toolbar" aria-label="Network controls">
            <h1 className="nw-canvas-title" title={`${counts.all} people · ${data.sources.length} sources`}>Network<span>{counts.all}</span></h1>
            <CanvasButton label="Show layers and filters" icon="layers" expanded={drawer === 'layers'} controls="nw-canvas-layers" onClick={() => toggleDrawer('layers')} />
            <CanvasButton label="Search network" icon="search" expanded={drawer === 'search'} controls="nw-canvas-search" onClick={() => toggleDrawer('search')} />
            <CanvasButton label="Add to network" icon="add" expanded={drawer === 'add'} controls="nw-canvas-add" onClick={() => toggleDrawer('add')} />
          </div>
          <div className="nw-canvas-island nw-canvas-right" role="toolbar" aria-label="Network views">
            <CanvasButton label="Map view" icon="map" active={mode === 'graph'} onClick={() => setMode('graph')} />
            <CanvasButton label="People list" icon="list" active={mode === 'list'} onClick={() => setMode(mode === 'list' ? 'graph' : 'list')} />
            <CanvasButton label="Jobs view" icon="jobs" active={mode === 'jobs'} onClick={() => setMode(mode === 'jobs' ? 'graph' : 'jobs')} />
            {loaded && <NetworkBell data={data} board={board} colors={colors} onPerson={openPerson} onWork={openWork} onSource={(id) => { openPerson(null); setView({ kind: 'source', id }); }} say={say} />}
          </div>
        </div>
        {drawer === 'search' && <div id="nw-canvas-search" className="nw-canvas-popover nw-canvas-search" data-canvas-controls>
          <CanvasIcon name="search" /><label className="nw-search"><span className="sr">Search people</span><input id="nw-search" autoFocus type="search" placeholder="Name, company, city…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          {query && <button type="button" className="nw-x" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}
        </div>}
        {drawer === 'add' && <div id="nw-canvas-add" className="nw-canvas-popover nw-canvas-add" role="group" aria-label="Add to network" data-canvas-controls>
          <CanvasMenuAction icon="person" onClick={() => { setDialog('person'); setDrawer(null); }}>Add person</CanvasMenuAction>
          <CanvasMenuAction icon="source" onClick={() => { setDialog({ source: null }); setDrawer(null); }}>New source</CanvasMenuAction>
          <CanvasMenuAction icon="list" onClick={() => { setDialog('list'); setDrawer(null); }}>Add a list</CanvasMenuAction>
          <CanvasMenuAction icon="import" onClick={() => { setDialog('import'); setDrawer(null); }}>Import contacts</CanvasMenuAction>
        </div>}
        {error && <p className="nw-error" role="alert">{error} <button type="button" onClick={() => void reload()}>Try again</button></p>}
        <div className={`nw-body${person || workItem || side ? " has-panel" : ""}`}>
          {drawer === 'layers' && <nav id="nw-canvas-layers" className="nw-rail nw-canvas-popover" aria-label="Show layers and filters" data-canvas-controls>
            <div className="nw-canvas-panel-head"><b>Show on canvas</b><button type="button" className="nw-x" aria-label="Close layers" onClick={() => setDrawer(null)}>×</button></div>
            <div className="nw-canvas-layers">
              {([['people', 'People'], ['sources', 'Sources & companies'], ['connections', 'Connection lines'], ['board', 'Notes, images & drawings'], ['work', 'Work cards']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((old) => ({ ...old, [key]: e.target.checked }))} /><span>{label}</span></label>)}
              <label className="nw-canvas-stack-toggle"><input type="checkbox" checked={stackPeople} onChange={(e) => setStackPeople(e.target.checked)} /><CanvasIcon name="stack" /><span>Stack people by source</span></label>
            </div>
            <h2>Filter people</h2>
            <RailItem on={view.kind === "all"} color="var(--nw-muted)" label="Everyone" n={counts.all} onClick={() => setView({ kind: "all" })} />
            <RailItem on={view.kind === "due"} color="var(--nw-warn)" label="Follow-up due" n={counts.due} onClick={() => setView({ kind: "due" })} />
            <RailItem on={view.kind === "never"} color="var(--nw-muted)" label="Never contacted" n={counts.never} onClick={() => setView({ kind: "never" })} />
            <RailItem on={view.kind === "introduced"} color="var(--nw-accent)" label="Introduced by someone" n={counts.introduced} onClick={() => setView({ kind: "introduced" })} />
            <h2>Sources</h2>
            <div className="nw-rail-scroll">
              {data.sources.map((s) => (
                <div key={s.id} className="nw-rail-row">
                  <RailItem on={view.kind === "source" && view.id === s.id} color={colors.source.get(s.id) ?? ""} label={sourceLabel(s, data.sources, data.people)} n={counts.by.get(s.id) ?? 0} onClick={() => setView({ kind: "source", id: s.id })} />
                  <button type="button" className="nw-edit" aria-label={`Edit ${sourceLabel(s, data.sources, data.people)}`} title="Edit" onClick={() => setDialog({ source: s })}>⋯</button>
                </div>
              ))}
              {(counts.by.get(null) ?? 0) > 0 && <RailItem on={view.kind === "source" && view.id === null} color="var(--nw-line-strong)" label="No source" n={counts.by.get(null) ?? 0} onClick={() => setView({ kind: "source", id: null })} />}
              {loaded && !data.sources.length && <p className="nw-hint">A source is where people come from: a company, an event, family. Make one, or add a list.</p>}
            </div>
          </nav>}

          <section className="nw-list nw-canvas" aria-label="Network canvas">
            {loaded ? <NetworkGraph data={data} layers={layers} stackPeople={stackPeople} onRevealLayer={(key) => setLayers((old) => ({ ...old, [key]: true }))} colors={colors} visible={visible} selected={selected} selectedWork={work} board={board} setBoard={setBoard}
                onPerson={(id) => openPerson(id === selected ? null : id)} onWork={openWork}
                onSource={(id) => { if (sideSource?.id === id) { setSide(null); setView({ kind: "all" }); } else openSource(id); }} onYou={() => (side === "you" ? setSide(null) : openYou())}
                onLinks={(links) => setData((d) => ({ ...d, links }))} onPeople={(list) => setData((d) => ({ ...d, people: d.people.map((p) => list.find((x) => x.id === p.id) ?? p) }))}
                onBulkMail={setBulkMail} say={say} /> : <p className="nw-canvas-loading" role="status">Loading your network…</p>}
            {loaded && !data.people.length && mode === 'graph' && <div className="nw-canvas-welcome"><h2>Your network starts here</h2><p>Add a person, drop a note, or import your contacts.</p><button type="button" className="nw-btn" onClick={() => setDialog('person')}>Add your first person</button></div>}
          </section>
          {mode !== 'graph' && <section className="nw-view-surface" aria-label={mode === 'list' ? 'People list' : 'Jobs where you know someone'}>
            <div className="nw-list-head"><h2>{mode === 'list' ? viewName : 'Jobs'} <span>{mode === 'list' ? shown.length : ''}</span></h2><div className="nw-head-r">
              {mode === 'list' && <label className="nw-sort">Sort <select id="nw-sort" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
              <button type="button" className="nw-x" aria-label="Close view" onClick={() => setMode('graph')}>×</button>
            </div></div>
            {mode === 'jobs' ? <WarmJobs colors={colors.person} onPerson={openPerson} onReferral={(id, job) => setMailFor({ id, job })} onWatch={(id, on) => { void post<{ person: Person }>('person', { id, watchJobs: on }).then((r) => replacePerson(r.person)).catch((e: Error) => say({ text: e.message })); }} /> : !shown.length ? <p className="nw-none">{loaded ? 'No people match this view.' : 'Loading people…'}</p> : (
              <ul className="nw-rows">
                {shown.map((p) => {
                  const f = followUp(p.nextFollowUp), src = p.sourceId ? sourceById.get(p.sourceId) : null, via = p.via ? personById.get(p.via) : null;
                  return (
                    <li key={p.id}>
                      <button type="button" className={`nw-row${p.id === selected ? " on" : ""}`} onClick={() => openPerson(p.id === selected ? null : p.id)} aria-pressed={p.id === selected}>
                        <Avatar name={p.name} photo={p.photoId} color={colors.person.get(p.id) ?? ""} source={via && src ? colors.source.get(src.id) : undefined} />
                        <span className="who"><b>{p.name}</b><small>{p.role || (via ? `Introduced by ${via.name}` : "\u00a0")}</small></span>
                        <span className="src">{src ? <><i style={{ background: colors.source.get(src.id) }} />{sourceLabel(src, data.sources, data.people)}</> : <em>No source</em>}</span>
                        <span className="city">{p.city}</span>
                        <span className="last">{ago(p.lastContact)}</span>
                        <span className={`fu${f?.due ? " due" : ""}`}>{f ? f.text : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>}


          {side === "you" && <YouPanel data={data} onChange={(you) => setData((d) => ({ ...d, you }))} onClose={() => setSide(null)} say={say} />}
          {sideSource && <SourcePanel key={sideSource.id} source={sideSource} data={data} colors={colors} onChange={(s) => setData((d) => ({ ...d, sources: d.sources.map((x) => (x.id === s.id ? { ...x, ...s } : x)) }))}
            onClose={() => { setSide(null); setView({ kind: "all" }); }} onPerson={(id) => openPerson(id)} onAddPeople={() => { setBulkSource(sideSource.id); setDialog("list"); }} onReferral={(id, job) => setMailFor({ id, job })} say={say} />}
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

      {dialog === "list" && <BulkAdd sources={data.sources} people={data.people} initialSource={bulkSource} onClose={() => { setDialog(null); setBulkSource(null); }} onDone={async (msg, sourceId) => { setDialog(null); await reload(); if (sourceId) setView({ kind: "source", id: sourceId }); say({ text: msg }); }} />}
      {dialog === "import" && <NetworkImport sources={data.sources} people={data.people} onClose={() => setDialog(null)} onDone={async (msg, sourceId) => { setDialog(null); await reload(); if (sourceId) setView({ kind: "source", id: sourceId }); say({ text: msg }); }} />}
      {dialog === "person" && <AddPerson sources={data.sources} people={data.people} onClose={() => setDialog(null)} onDone={async (p) => { setDialog(null); await reload(); setSelected(p.id); say({ text: `${p.name} added.` }); }} />}
      {dialog && typeof dialog === "object" && <SourceEditor source={dialog.source} sources={data.sources} people={data.people} count={dialog.source ? counts.by.get(dialog.source.id) ?? 0 : 0} color={dialog.source ? colors.source.get(dialog.source.id) ?? PALETTE[0] : PALETTE[0]} onClose={() => setDialog(null)}
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

type PanelTab = "overview" | "jobs" | "history" | "details";
const TABS: [PanelTab, string][] = [["overview", "Overview"], ["jobs", "Jobs"], ["history", "History"], ["details", "Details"]];
// Fewer entries per page on a short screen, so the panel never scrolls.
const historyPage = () => (typeof window !== "undefined" && window.innerHeight < 800 ? 4 : 6);

/**
 * One person, on one screen: who they are, how they reached you (a trail you can follow back), one row of actions, and four tabs so
 * nothing scrolls: an overview, the jobs at their company, everything that happened, and their details.
 */
function PersonPanel({ person: p, data, colors, sourceById, personById, onClose, onChange, onOpen, onArchive, onWrite, onReferral, say, onLinks }: {
  person: Person; data: NetworkData; colors: ReturnType<typeof colorsFor>; sourceById: Map<string, Source>; personById: Map<string, Person>;
  onClose: () => void; onChange: (p: Person) => void; onOpen: (id: string) => void; onArchive: () => void; onWrite: () => void; onReferral: (job: JobRow) => void; say: (t: Toast) => void; onLinks: (l: NetworkData["links"]) => void;
}) {
  const [draft, setDraft] = useState(p);
  const [saving, setSaving] = useState("");
  const [tab, setTab] = useState<PanelTab>("overview");
  const [pop, setPop] = useState<null | "follow" | "log" | "more" | "connect" | "colour">(null);
  const [hType, setHType] = useState<HistoryType>("note");
  const [hText, setHText] = useState("");
  const [hPage, setHPage] = useState(0);
  const [linkTo, setLinkTo] = useState("");
  const [linkKind, setLinkKind] = useState<LinkKind>("other");
  const [linkLabel, setLinkLabel] = useState("");
  const [addVia, setAddVia] = useState("");
  // A save (or a reload) brings a new copy of this person: start editing from it.
  const [seen, setSeen] = useState(p);
  if (seen !== p) { setSeen(p); setDraft(p); }
  useEffect(() => {
    if (!pop) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.(".pp-pop,.pp-popbtn")) setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    document.addEventListener("pointerdown", away); window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [pop]);

  async function save(fields: Partial<Person>) {
    setSaving("Saving…");
    try { const r = await post<{ person: Person }>("person", { id: p.id, ...fields }); onChange(r.person); setSaving("Saved"); window.setTimeout(() => setSaving(""), 1200); }
    catch (e) { setSaving(""); setDraft(p); say({ text: String((e as Error).message) }); }
  }
  const text = (k: "name" | "role" | "city" | "email" | "linkedin" | "phone" | "company", label: string, type = "text", placeholder = "") => (
    <label className="nw-f"><span>{label}</span><input id={`nw-${k}`} type={type} value={draft[k]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      onBlur={() => { if (draft[k] !== p[k]) void save({ [k]: draft[k] }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
  );
  async function addHistory() {
    try { const r = await post<{ person: Person }>("history", { id: p.id, type: hType, text: hText }); onChange(r.person); setHText(""); setPop(null); setHPage(0); say({ text: "Added to their history." }); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function dropHistory(entryId: string) {
    try { const r = await post<{ person: Person }>("history/remove", { id: p.id, entryId }); onChange(r.person); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function connect() {
    if (!linkTo) return;
    try { await post("link", { a: p.id, b: linkTo, kind: linkKind, label: linkLabel }); const d = await loadNetwork(); onLinks(d.links); setLinkTo(""); setLinkLabel(""); setPop(null); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function disconnect(id: string) {
    try { await post("link/remove", { id }); onLinks(data.links.filter((l) => l.id !== id)); } catch (e) { say({ text: String((e as Error).message) }); }
  }
  const introducers = introducersOf(p).map((id) => personById.get(id)).filter((x): x is Person => Boolean(x));
  const saveIntroducers = (ids: string[]) => save({ via: ids[0] ?? null, alsoVia: ids.slice(1) });
  const src = p.sourceId ? sourceById.get(p.sourceId) : null;
  const color = colors.person.get(p.id) ?? "";
  const company = companyOfPerson(p, sourceById);
  const links = data.links.filter((l) => l.a === p.id || l.b === p.id).map((l) => {
    const other = l.a === p.id ? l.b : l.a;
    return { l, name: personById.get(other)?.name ?? sourceById.get(other)?.name ?? "Someone archived", id: other, isPerson: personById.has(other) };
  });
  const f = followUp(p.nextFollowUp);
  const replied = p.history.length > 0 && p.history[p.history.length - 1].type === "reply";
  const per = historyPage(), history = [...p.history].reverse(), pages = Math.max(1, Math.ceil(history.length / per)), page = Math.min(hPage, pages - 1);
  const others = [...data.people.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name })), ...data.sources.map((s) => ({ id: s.id, name: `${s.name} (source)` }))];
  // The trail back to you: what brought their source (a parent source or a person), the source, who introduced them, then them.
  const upstream: { id: string; name: string; color?: string; person?: boolean }[] = [];
  for (let s = src ?? undefined, guard = 0; s && guard < 6; guard++) {
    upstream.unshift({ id: s.id, name: s.name, color: colors.source.get(s.id) });
    if (s.viaPersonId && personById.has(s.viaPersonId)) { const who = personById.get(s.viaPersonId)!; upstream.unshift({ id: who.id, name: who.name, color: colors.person.get(who.id), person: true }); break; }
    s = s.parentSourceId ? sourceById.get(s.parentSourceId) : undefined;
  }
  const tabCount: Record<PanelTab, string> = { overview: "", jobs: "", history: p.history.length ? String(p.history.length) : "", details: "" };
  const keyTabs = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex(([t]) => t === tab), n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!n) return; e.preventDefault(); const next = TABS[(i + n + TABS.length) % TABS.length][0]; setTab(next); document.getElementById(`pp-tab-${next}`)?.focus();
  };
  return (
    <aside className="nw-panel pp" aria-label={p.name}>
      <header className="pp-head">
        <label className="nw-photo" title={p.photoId ? "Change the photo" : "Add a photo"}>
          <Avatar big name={draft.name || p.name} photo={p.photoId} color={color} source={introducers.length && src ? colors.source.get(src.id) : undefined} />
          <span className="nw-photo-tip">{p.photoId ? "Change" : "+ Photo"}</span>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { setSaving("Uploading…"); uploadPhoto(file).then((id) => save({ photoId: id })).catch((err: Error) => { setSaving(""); say({ text: err.message }); }); } }} />
        </label>
        <div className="pp-id">
          <input className="nw-name" aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => { if (draft.name.trim() && draft.name !== p.name) void save({ name: draft.name }); else setDraft({ ...draft, name: p.name }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <input className="nw-role" aria-label="Role" placeholder="Add their role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} onBlur={() => { if (draft.role !== p.role) void save({ role: draft.role }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <p className="pp-where">{[company, p.city].filter(Boolean).join(" · ") || <button type="button" className="pp-link" onClick={() => setTab("details")}>Add where they work</button>}</p>
        </div>
        <span className="nw-saving" aria-live="polite">{saving}</span>
        <button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button>
      </header>

      <nav className="pp-trail" aria-label="How they reached you">
        <span className="pp-step you">You</span>
        {upstream.map((s) => <span key={s.id} className="pp-hop"><i aria-hidden="true">›</i>{s.person ? <button type="button" className="pp-step" onClick={() => onOpen(s.id)} style={{ "--c": s.color } as CSSProperties}>{s.name}</button> : <span className="pp-step" style={{ "--c": s.color } as CSSProperties}>{s.name}</span>}</span>)}
        {introducers.length > 0 && <span className="pp-hop"><i aria-hidden="true">›</i><span className="pp-group">{introducers.map((x, n) => <span key={x.id}>{n > 0 && <em>+</em>}<button type="button" className="pp-step" onClick={() => onOpen(x.id)} style={{ "--c": colors.person.get(x.id) } as CSSProperties}>{x.name}</button></span>)}</span></span>}
        <span className="pp-hop"><i aria-hidden="true">›</i><span className="pp-step me" style={{ "--c": color } as CSSProperties}>{p.name.split(" ")[0]}</span></span>
      </nav>

      <div className="pp-actions">
        <button type="button" className="nw-btn main" onClick={onWrite}>Write email</button>
        <div className="pp-popwrap">
          <button type="button" className={`pp-pill pp-popbtn${f?.due ? " due" : f ? " set" : ""}`} aria-expanded={pop === "follow"} onClick={() => setPop(pop === "follow" ? null : "follow")}>{f ? `Follow up ${f.text}` : "Set follow-up"}</button>
          {pop === "follow" && <div className="pp-pop" role="dialog" aria-label="Follow-up">
            <div className="pp-pop-row">{[["In 3 days", 3], ["In a week", 7], ["In 2 weeks", 14]].map(([l, n]) => <button key={l} type="button" className="nw-chip" onClick={() => { void save({ nextFollowUp: plusDays(n as number) }); setPop(null); }}>{l}</button>)}</div>
            <label className="nw-f"><span>Or a date</span><input id="nw-followup" type="date" value={p.nextFollowUp ?? ""} onChange={(e) => { void save({ nextFollowUp: e.target.value || null }); setPop(null); }} /></label>
            {p.nextFollowUp && <button type="button" className="pp-link" onClick={() => { void save({ nextFollowUp: null }); setPop(null); }}>Clear the follow-up</button>}
          </div>}
        </div>
        <div className="pp-popwrap">
          <button type="button" className="pp-pill pp-popbtn" aria-expanded={pop === "log"} onClick={() => setPop(pop === "log" ? null : "log")}>Log</button>
          {pop === "log" && <div className="pp-pop" role="dialog" aria-label="Log something">
            <div className="pp-types" role="radiogroup" aria-label="What happened">{HISTORY_TYPES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={hType === k} onClick={() => setHType(k)}>{l}</button>)}</div>
            <input id="nw-htext" aria-label="Details" autoFocus placeholder={hType === "note" ? "Write a note" : "Details (optional)"} value={hText} onChange={(e) => setHText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addHistory(); }} />
            <button type="button" className="nw-btn main" onClick={() => void addHistory()}>Add to history</button>
          </div>}
        </div>
        <span className="grow" />
        <div className="pp-popwrap">
          <button type="button" className="pp-icon pp-popbtn" aria-label="More" aria-expanded={pop === "more"} onClick={() => setPop(pop === "more" ? null : "more")}>⋯</button>
          {pop === "more" && <div className="pp-pop right" role="menu">
            {p.linkedin && <a role="menuitem" className="pp-mi" href={p.linkedin} target="_blank" rel="noreferrer">Open LinkedIn profile ↗</a>}
            {p.photoId && <button type="button" role="menuitem" className="pp-mi" onClick={() => { void save({ photoId: null }); setPop(null); }}>Remove photo</button>}
            <button type="button" role="menuitem" className="pp-mi danger" onClick={() => { setPop(null); onArchive(); }}>Archive</button>
          </div>}
        </div>
      </div>

      <div className="pp-tabs" role="tablist" aria-label="About them" onKeyDown={keyTabs}>
        {TABS.map(([t, l]) => <button key={t} id={`pp-tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls="pp-panel" tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{l}{tabCount[t] && <small>{tabCount[t]}</small>}</button>)}
      </div>

      <div id="pp-panel" key={tab} className={`pp-body pp-${tab}`} role="tabpanel" aria-labelledby={`pp-tab-${tab}`}>
        {tab === "overview" && <>
          <div className="pp-status">
            <span>Last contact <b>{ago(p.lastContact)}</b></span>
            <span className={f?.due ? "due" : ""}>Follow-up <b>{f ? f.text : "not set"}</b></span>
            {replied && <span className="ok"><b>They replied</b></span>}
          </div>
          <label className="pp-notes"><span className="pp-h">Notes</span><textarea id="nw-notes" aria-label="Notes" placeholder="What they said, what they prefer, what you promised." value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} onBlur={() => { if (draft.notes !== p.notes) void save({ notes: draft.notes }); }} /></label>
          <section className="pp-sec">
            <div className="pp-sec-h"><span className="pp-h">Connected to</span><button type="button" className="pp-link pp-popbtn" onClick={() => setPop(pop === "connect" ? null : "connect")}>+ Connect</button></div>
            {pop === "connect" ? <div className="pp-pop inline" role="group" aria-label="Connect">
              <select id="nw-link-to" aria-label="Connect to" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}><option value="">Who…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              <select id="nw-link-kind" aria-label="Kind of connection" value={linkKind} onChange={(e) => setLinkKind(e.target.value as LinkKind)}>{LINK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input id="nw-link-label" aria-label="What is it" placeholder="Same office…" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
              <button type="button" className="nw-btn" disabled={!linkTo} onClick={() => void connect()}>Connect</button>
            </div> : <div className="pp-chips">
              {links.map(({ l, name, id, isPerson }) => (
                <span key={l.id} className="pp-chip" style={{ "--c": l.color ?? (isPerson ? colors.person.get(id) : colors.source.get(id)) } as CSSProperties}>
                  {isPerson ? <button type="button" onClick={() => onOpen(id)}>{name}</button> : <span>{name}</span>}<small>{l.label || LINK_KINDS.find(([k]) => k === l.kind)?.[1]}</small>
                  <button type="button" className="x" aria-label={`Remove the connection to ${name}`} onClick={() => void disconnect(l.id)}>×</button></span>
              ))}
              {!links.length && <span className="nw-muted">Nobody else yet.</span>}
            </div>}
          </section>
          <section className="pp-sec">
            <div className="pp-sec-h"><span className="pp-h">Latest</span>{history.length > 3 && <button type="button" className="pp-link" onClick={() => setTab("history")}>All {history.length}</button>}</div>
            <ul className="pp-tl">{history.slice(0, 3).map((h) => <li key={h.id}><time dateTime={h.at}>{new Date(h.at).toLocaleDateString([], { month: "short", day: "numeric" })}</time><span><b>{HISTORY_TYPES.find(([k]) => k === h.type)?.[1]}</b>{h.text ? ` · ${h.text}` : ""}</span></li>)}
              {!history.length && <li className="nw-muted">Nothing yet. Use Log above after a message, call or meeting.</li>}</ul>
          </section>
        </>}

        {tab === "jobs" && <PersonJobs person={p} company={company} onReferral={onReferral} watching={p.watchJobs} onWatch={(on) => void save({ watchJobs: on })} pageSize={4} />}

        {tab === "history" && <>
          <ul className="pp-tl long">{history.slice(page * per, page * per + per).map((h) => (
            <li key={h.id}><time dateTime={h.at}>{new Date(h.at).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(h.at).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}</time>
              <span><b>{HISTORY_TYPES.find(([k]) => k === h.type)?.[1]}</b>{h.text ? ` · ${h.text}` : ""}</span>
              <button type="button" className="nw-x small" aria-label="Remove this entry" onClick={() => void dropHistory(h.id)}>×</button></li>))}
            {!history.length && <li className="nw-muted">Nothing yet. Use Log above after a message, call or meeting.</li>}</ul>
          {pages > 1 && <div className="pp-pager"><button type="button" className="nw-chip" disabled={page === 0} onClick={() => setHPage(page - 1)}>Newer</button><span>{page + 1} of {pages}</span><button type="button" className="nw-chip" disabled={page >= pages - 1} onClick={() => setHPage(page + 1)}>Older</button></div>}
        </>}

        {tab === "details" && <>
          <div className="pp-grid">
            {text("company", "Works at", "text", companyOfPerson({ ...p, company: "" }, sourceById) || "Company")}{text("city", "City")}
            {text("email", "Email", "email")}{text("phone", "Phone", "tel")}
            <div className="pp-span">{text("linkedin", "LinkedIn", "url", "linkedin.com/in/…")}</div>
            <label className="nw-f"><span>Met through</span>
              <select id="nw-source" value={p.sourceId ?? ""} onChange={(e) => void save({ sourceId: e.target.value || null })}>
                <option value="">No source</option>{data.sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s, data.sources, data.people)}</option>)}
              </select></label>
            <div className="nw-f"><span>Introduced by</span>
              <div className="pp-vias">
                {introducers.map((x) => <span key={x.id} className="pp-chip" style={{ "--c": colors.person.get(x.id) } as CSSProperties}><button type="button" onClick={() => onOpen(x.id)}>{x.name}</button><button type="button" className="x" aria-label={`${x.name} did not introduce them`} onClick={() => void saveIntroducers(introducersOf(p).filter((id) => id !== x.id))}>×</button></span>)}
                <select id="nw-via-add" aria-label="Add who introduced them" value={addVia} onChange={(e) => { const id = e.target.value; setAddVia(""); if (id) void saveIntroducers([...introducersOf(p), id]); }}>
                  <option value="">{introducers.length ? "+ Another person" : "Nobody (a first connection)"}</option>
                  {data.people.filter((x) => x.id !== p.id && !introducersOf(p).includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div></div>
          </div>
          <div className="pp-colourrow">
            <span className="pp-h">Colour</span>
            <div className="pp-popwrap">
              <button type="button" className="pp-dot pp-popbtn" style={{ background: color }} aria-label="Change their colour" aria-expanded={pop === "colour"} onClick={() => setPop(pop === "colour" ? null : "colour")} />
              {pop === "colour" && <div className="pp-pop up" role="dialog" aria-label="Colour"><Swatches value={p.color} fallback={color} label="Colour" onPick={(c) => void save({ color: c })} /></div>}
            </div>
            <small>{p.color ? "One you picked" : introducers.length ? "Their own branch, since someone introduced them" : src ? `The colour of where you met: ${src.name}` : "No source yet"}</small>
          </div>
        </>}
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

function SourcePicker({ sources, people, value, onChange, newName, setNewName, newType, setNewType, newParent, setNewParent, newContext, setNewContext }: { sources: Source[]; people: Person[]; value: string; onChange: (v: string) => void; newName: string; setNewName: (v: string) => void; newType: SourceType; setNewType: (v: SourceType) => void; newParent: string; setNewParent: (value: string) => void; newContext: string; setNewContext: (value: string) => void }) {
  return (
    <div className="nw-pick">
      <label className="nw-f"><span>Where you met them</span>
        <select id="nw-pick-source" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="__new">A new source…</option><option value="">No source</option>{sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s, sources)}</option>)}
        </select></label>
      {value === "__new" && <>
        <label className="nw-f"><span>Source name</span><input id="nw-new-source" placeholder="Randstad, All Things Open, Family…" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="nw-f"><span>Kind</span><select id="nw-new-type" value={newType} onChange={(e) => setNewType(e.target.value as SourceType)}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
        <NetworkSourceContext sources={sources} people={people} parentSourceId={newParent} onParent={setNewParent} context={newContext} onContext={setNewContext} prefix="nw-new" />
      </>}
    </div>
  );
}

function BulkAdd({ sources, people, initialSource, onClose, onDone }: { sources: Source[]; people: Person[]; initialSource?: string | null; onClose: () => void; onDone: (msg: string, sourceId: string | null) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [source, setSource] = useState(initialSource || (sources.length ? sources[0].id : "__new"));
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState(""); const [newContext, setNewContext] = useState("");
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
      const r = await post<{ added: Person[]; skipped: string[]; sourceId: string | null }>("people", { rows: fresh.map(({ name, city }) => ({ name, city })), ...(source === "__new" ? { newSource: { name: newName, type: newType, ...throughFields(newParent), context: newContext } } : { sourceId: source || null }) });
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
      <SourcePicker sources={sources} people={people} value={source} onChange={setSource} newName={newName} setNewName={setNewName} newType={newType} setNewType={setNewType} newParent={newParent} setNewParent={setNewParent} newContext={newContext} setNewContext={setNewContext} />
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df"><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={!ready} onClick={() => void add()}>{busy ? "Adding…" : fresh.length ? `Add ${fresh.length} ${fresh.length === 1 ? "person" : "people"}` : "Add"}</button></div>
    </Dialog>
  );
}

function AddPerson({ sources, people, onClose, onDone }: { sources: Source[]; people: Person[]; onClose: () => void; onDone: (p: Person) => void }) {
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState(""); const [company, setCompany] = useState("");
  const [source, setSource] = useState(sources.length ? sources[0].id : "");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState(""); const [newContext, setNewContext] = useState(""); const [newType, setNewType] = useState<SourceType>("company");
  const [via, setVia] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true); setError("");
    try {
      let sourceId: string | null = source || null;
      if (source === "__new") sourceId = (await post<{ source: Source }>("source", { name: newName, type: newType, ...throughFields(newParent), context: newContext })).source.id;
      const r = await post<{ person: Person }>("person", { name, role, email, company, sourceId, via: via || null });
      onDone(r.person);
    } catch (e) { setError(String((e as Error).message)); setBusy(false); }
  }
  return (
    <Dialog title="Add person" onClose={onClose}>
      <div className="nw-form">
        <label className="nw-f"><span>Name</span><input id="nw-add-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" /></label>
        <label className="nw-f"><span>Role</span><input id="nw-add-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior recruiter" /></label>
        <label className="nw-f"><span>Company / employer</span><input id="nw-add-company" list="nw-company-options" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Where they currently work" /><small>Used to match jobs and applications. Separate from how you know them.</small></label>
        <datalist id="nw-company-options">{[...new Set([...people.map((p) => p.company), ...sources.filter((s) => s.type === 'company' || s.type === 'staffing').map((s) => s.name)].filter(Boolean))].map((name) => <option key={name} value={name} />)}</datalist>
        <label className="nw-f"><span>Email</span><input id="nw-add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" /></label>
        <SourcePicker sources={sources} people={people} value={source} onChange={setSource} newName={newName} setNewName={setNewName} newType={newType} setNewType={setNewType} newParent={newParent} setNewParent={setNewParent} newContext={newContext} setNewContext={setNewContext} />
        <label className="nw-f"><span>Introduced by</span><select id="nw-add-via" value={via} onChange={(e) => setVia(e.target.value)}><option value="">Nobody (a first connection)</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      {error && <p className="nw-error" role="alert">{error}</p>}
      <div className="nw-df"><button type="button" className="nw-btn" onClick={onClose}>Cancel</button><button type="button" className="nw-btn main" disabled={!name.trim() || busy || (source === "__new" && !newName.trim())} onClick={() => void add()}>{busy ? "Adding…" : "Add person"}</button></div>
    </Dialog>
  );
}

function SourceEditor({ source, sources, people, count, color, onClose, onDone }: { source: Source | null; sources: Source[]; people: Person[]; count: number; color: string; onClose: () => void; onDone: (msg: string, removed?: string) => void }) {
  const [name, setName] = useState(source?.name ?? ""); const [type, setType] = useState<SourceType>(source?.type ?? "company");
  const [parentSourceId, setParentSourceId] = useState(throughValue(source));
  const [context, setContext] = useState(source?.context ?? "");
  const [about, setAbout] = useState(source?.about ?? ""); const [pick, setPick] = useState<string | null>(source?.color ?? null);
  const [confirm, setConfirm] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError("");
    try { const r = await post<{ source: Source & { existed?: boolean } }>("source", { ...(source ? { id: source.id } : {}), name, type, about, color: pick, ...throughFields(parentSourceId), context }); onDone(source ? `${name.trim()} saved.` : r.source.existed ? `You already have ${r.source.name} in that context.` : `${name.trim()} added. Add people to it with Add a list.`); }
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
        <NetworkSourceContext sources={sources} people={people} parentSourceId={parentSourceId} onParent={setParentSourceId} context={context} onContext={setContext} excludeId={source?.id} prefix="nw-src" />
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
