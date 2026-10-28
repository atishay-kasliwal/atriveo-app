import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { LINK_KINDS, PALETTE, autoLayout, edgesFor, followUp, initials, post, type Edge, type Link, type LinkKind, type NetworkData, type Point, colorsFor } from "./network";

type Colors = ReturnType<typeof colorsFor>;
type View = { x: number; y: number; k: number };
const PERSON = { w: 196, h: 52 }, YOU = { w: 246, h: 80 };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sourceSize = (name: string, about: string) => ({ w: Math.round(Math.max(180, 86 + Math.max(name.length * 9.6, about.length * 6.8))), h: 68 });
const DASH: Record<string, string | undefined> = { via: "7 5", intro: "7 5", family: "2 5", other: "10 3 2 3" };

/**
 * The Network as a canvas: you in the middle, sources around you, people around their source. Drag cards (positions are saved), drag the
 * background to pan, scroll or pinch to zoom. Clicking a person opens them; clicking a source shows only its people; clicking a line you
 * made lets you name it, recolour it or remove it.
 */
export default function NetworkGraph({ data, colors, visible, selected, onPerson, onSource, onLinks, say }: {
  data: NetworkData; colors: Colors; visible: Set<string> | null; selected: string | null;
  onPerson: (id: string) => void; onSource: (id: string) => void; onLinks: (links: Link[]) => void; say: (t: { text: string } | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const base = useMemo(() => autoLayout(data), [data]);
  const [moved, setMoved] = useState<Map<string, Point>>(new Map());
  const pos = useCallback((id: string) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 }, [moved, base]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ edge: Edge; at: Point } | null>(null);
  const gesture = useRef<null | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean } | { kind: "drag"; id: string; dx: number; dy: number; moved: boolean; sx: number; sy: number }>(null);
  const edges = useMemo(() => edgesFor(data, colors), [data, colors]);
  const peopleCount = useMemo(() => { const m = new Map<string, number>(); for (const p of data.people) if (p.sourceId && !p.via) m.set(p.sourceId, (m.get(p.sourceId) ?? 0) + 1); return m; }, [data.people]);

  const fit = useCallback(() => {
    const el = stage.current; if (!el) return;
    const pts = ["you", ...data.sources.map((s) => s.id), ...data.people.map((p) => p.id)].map((id) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // Leave the bottom strip (zoom and legend) clear.
    const w = el.clientWidth, h = el.clientHeight - 56, bw = Math.max(...xs) - Math.min(...xs) + 320, bh = Math.max(...ys) - Math.min(...ys) + 160;
    const k = Math.max(0.25, Math.min(1.1, w / bw, h / bh));
    setView({ k, x: w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k });
  }, [data.sources, data.people, moved, base]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && stage.current) { fitted.current = true; fit(); } }, [fit]);

  // Zoom around the pointer; native listener so the page itself never scrolls.
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      setView((v) => { const k = Math.max(0.2, Math.min(2.5, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)))), f = k / v.k; return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }; });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const zoomBy = (f: number) => { const el = stage.current; if (!el) return; const cx = el.clientWidth / 2, cy = el.clientHeight / 2; setView((v) => { const k = Math.max(0.2, Math.min(2.5, v.k * f)), g = k / v.k; return { k, x: cx - (cx - v.x) * g, y: cy - (cy - v.y) * g }; }); };

  const world = (e: { clientX: number; clientY: number }) => { const r = stage.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };
  function down(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const t = e.target as Element;
    if (t.closest(".nwg-ui")) return;
    const node = t.closest<SVGGElement>("[data-node]"), line = t.closest<SVGPathElement>("[data-edge]");
    stage.current?.setPointerCapture(e.pointerId);
    setEditing(null);
    if (line && !node) { const edge = edges.find((x) => x.key === line.dataset.edge); if (edge?.link) { const r = stage.current!.getBoundingClientRect(); setEditing({ edge, at: { x: e.clientX - r.left, y: e.clientY - r.top } }); } gesture.current = null; return; }
    if (node) { const id = node.dataset.node!, p = pos(id), w = world(e); gesture.current = { kind: "drag", id, dx: w.x - p.x, dy: w.y - p.y, moved: false, sx: e.clientX, sy: e.clientY }; return; }
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    if (g.kind === "pan") { if (Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3) g.moved = true; setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy })); return; }
    if (!g.moved && Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) < 4) return;
    g.moved = true; const w = world(e);
    setMoved((m) => new Map(m).set(g.id, { x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) }));
  }
  function up() {
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.kind === "drag") {
      if (g.moved) { const p = moved.get(g.id); if (p) post("positions", { items: [{ id: g.id, ...p }] }).catch((err: Error) => say({ text: `That position was not saved: ${err.message}` })); return; }
      if (g.id === "you") return;
      if (data.people.some((p) => p.id === g.id)) onPerson(g.id); else onSource(g.id);
    }
  }

  // What stays bright: the filter's people (and their sources), or the person you opened and everyone directly linked to them.
  const lit = useMemo(() => {
    if (selected) { const s = new Set([selected]); for (const e of edges) { if (e.a === selected) s.add(e.b); if (e.b === selected) s.add(e.a); } return s; }
    if (!visible) return null;
    const s = new Set<string>(["you", ...visible]);
    for (const p of data.people) if (visible.has(p.id) && p.sourceId) s.add(p.sourceId);
    return s;
  }, [selected, visible, edges, data.people]);
  const focus = selected ?? hover;

  const path = (e: Edge) => {
    const a = pos(e.a), b = pos(e.b), dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, c = Math.min(60, d * 0.12);
    const cx = (a.x + b.x) / 2 - (dy / d) * c, cy = (a.y + b.y) / 2 + (dx / d) * c;
    return { d: `M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`, mx: (a.x + 2 * cx + b.x) / 4, my: (a.y + 2 * cy + b.y) / 4 };
  };
  const card = "var(--nw-card)", bg = "var(--nw-bg)";
  const youSub = `${data.people.length} ${data.people.length === 1 ? "person" : "people"} · ${data.sources.length} ${data.sources.length === 1 ? "source" : "sources"}`;
  const youPos = pos("you");

  return (
    <div ref={stage} className="nwg" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="application" aria-label="Your network as a map. Drag cards to arrange them; Enter opens the focused card.">
      <svg className="nwg-svg" style={{ backgroundSize: `${28 * view.k}px ${28 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g>
            {edges.map((e) => {
              const p = path(e), hot = focus != null && (e.a === focus || e.b === focus), dim = lit && !(lit.has(e.a) && lit.has(e.b));
              return (
                <g key={e.key} className={`nwg-edge${hot ? " hot" : ""}`} style={{ opacity: dim ? 0.07 : hot ? 1 : e.kind === "you" ? 0.45 : 0.7 }}>
                  <path d={p.d} stroke={e.color} strokeDasharray={DASH[e.kind]} strokeWidth={hot ? 3 : e.kind === "you" ? 1.4 : 1.9} fill="none" strokeLinecap="round" />
                  {e.link && <path d={p.d} className="nwg-hit" data-edge={e.key}><title>{`${e.label} (click to edit)`}</title></path>}
                  {hot && <text x={p.mx} y={p.my} className="nwg-elabel" fill={e.color}>{e.label}</text>}
                </g>
              );
            })}
          </g>
          <g>
            <g data-node="you" className="nwg-node" transform={`translate(${youPos.x} ${youPos.y})`} tabIndex={0} role="button" aria-label="You">
              <rect x={-YOU.w / 2} y={-YOU.h / 2} width={YOU.w} height={YOU.h} rx={18} className="nwg-you" />
              <circle cx={-YOU.w / 2 + 44} r={28} className="nwg-you-av" />
              <text x={-YOU.w / 2 + 44} y={1} className="nwg-you-ini">YOU</text>
              <text x={-YOU.w / 2 + 86} y={-4} className="nwg-you-name">You</text>
              <text x={-YOU.w / 2 + 86} y={16} className="nwg-you-sub">{youSub}</text>
            </g>
            {data.sources.map((s) => {
              const p = pos(s.id), c = colors.source.get(s.id) ?? PALETTE[0], sz = sourceSize(s.name, s.about || s.type), n = peopleCount.get(s.id) ?? 0, dim = lit && !lit.has(s.id);
              return (
                <g key={s.id} data-node={s.id} className="nwg-node" transform={`translate(${p.x} ${p.y})`} style={{ opacity: dim ? 0.18 : 1 }} tabIndex={0} role="button" aria-label={`${s.name}: show only its people`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSource(s.id); } }} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
                  <rect x={-sz.w / 2 - 5} y={-sz.h / 2 - 5} width={sz.w + 10} height={sz.h + 10} rx={19} className="nwg-halo" />
                  <rect x={-sz.w / 2} y={-sz.h / 2} width={sz.w} height={sz.h} rx={14} fill={card} stroke={c} strokeWidth={1.8} />
                  <rect x={-sz.w / 2 + 14} y={-22} width={44} height={44} rx={11} fill={c} fillOpacity={0.16} stroke={c} strokeWidth={1.5} />
                  <text x={-sz.w / 2 + 36} y={1} className="nwg-tile" fill={c}>{s.name[0]?.toUpperCase()}</text>
                  <text x={-sz.w / 2 + 72} y={-3} className="nwg-sname">{clip(s.name, 26)}</text>
                  <text x={-sz.w / 2 + 72} y={16} className="nwg-sub">{clip(s.about || s.type, 30)}</text>
                  {n > 0 && <><circle cx={sz.w / 2 - 4} cy={-sz.h / 2 + 4} r={12} fill={c} stroke={bg} strokeWidth={3} /><text x={sz.w / 2 - 4} y={-sz.h / 2 + 4.5} className="nwg-badge">{n}</text></>}
                </g>
              );
            })}
            {data.people.map((p) => {
              const at = pos(p.id), c = colors.person.get(p.id) ?? "#8a919c", dim = lit && !lit.has(p.id), ax = -PERSON.w / 2 + 28;
              const due = followUp(p.nextFollowUp)?.due, replied = p.history.length > 0 && p.history[p.history.length - 1].type === "reply";
              const lineage = p.via && p.sourceId ? colors.source.get(p.sourceId) : undefined;
              return (
                <g key={p.id} data-node={p.id} className={`nwg-node${p.id === selected ? " sel" : ""}`} transform={`translate(${at.x} ${at.y})`} style={{ opacity: dim ? 0.16 : 1 }} tabIndex={0} role="button" aria-label={`${p.name}${p.role ? `, ${p.role}` : ""}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPerson(p.id); } }} onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}>
                  <rect x={-PERSON.w / 2 - 5} y={-PERSON.h / 2 - 5} width={PERSON.w + 10} height={PERSON.h + 10} rx={17} className="nwg-halo" />
                  <rect x={-PERSON.w / 2} y={-PERSON.h / 2} width={PERSON.w} height={PERSON.h} rx={13} fill={card} stroke={c} strokeWidth={p.id === selected ? 3 : 1.6} />
                  <circle cx={ax} r={19} fill={c} fillOpacity={0.15} stroke={c} strokeWidth={1.8} />
                  <text x={ax} y={1} className="nwg-ini" fill={c}>{initials(p.name)}</text>
                  {(due || replied) && <circle cx={ax + 14} cy={14} r={6} fill={due ? "var(--nw-warn)" : "var(--nw-ok)"} stroke={card} strokeWidth={2.5}><title>{due ? "Follow-up due" : "They replied"}</title></circle>}
                  {lineage && <circle cx={PERSON.w / 2 - 2} cy={-PERSON.h / 2 + 2} r={7} fill={lineage} stroke={bg} strokeWidth={2.5}><title>Belongs to {data.sources.find((s) => s.id === p.sourceId)?.name}, introduced by {data.people.find((q) => q.id === p.via)?.name}</title></circle>}
                  <text x={ax + 30} y={p.role ? -3 : 5} className="nwg-pname">{clip(p.name, 20)}</text>
                  {p.role && <text x={ax + 30} y={13} className="nwg-sub">{clip(p.role, 22)}</text>}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="nwg-ui nwg-zoom"><button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button><span>{Math.round(view.k * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button><button type="button" className="txt" onClick={fit}>Fit</button></div>
      <div className="nwg-ui nwg-legend" aria-hidden="true">
        <span><svg viewBox="0 0 30 6"><path d="M0 3H30" /></svg>first connection</span>
        <span><svg viewBox="0 0 30 6"><path d="M0 3H30" strokeDasharray="7 5" /></svg>introduced</span>
        <span><svg viewBox="0 0 30 6"><path d="M0 3H30" strokeDasharray="2 5" strokeLinecap="round" /></svg>family</span>
        <span>colour = where they came from</span>
      </div>
      {editing?.edge.link && <LinkEditor key={editing.edge.key} link={editing.edge.link} at={editing.at} names={[name(data, editing.edge.a), name(data, editing.edge.b)]} color={editing.edge.color}
        onClose={() => setEditing(null)} onSaved={(l) => { onLinks(data.links.map((x) => (x.id === l.id ? l : x))); }} onRemoved={(id) => { onLinks(data.links.filter((x) => x.id !== id)); setEditing(null); }} say={say} />}
    </div>
  );
}

const name = (d: NetworkData, id: string) => d.people.find((p) => p.id === id)?.name ?? d.sources.find((s) => s.id === id)?.name ?? "You";

function LinkEditor({ link, at, names, color, onClose, onSaved, onRemoved, say }: { link: Link; at: Point; names: string[]; color: string; onClose: () => void; onSaved: (l: Link) => void; onRemoved: (id: string) => void; say: (t: { text: string } | null) => void }) {
  const [label, setLabel] = useState(link.label);
  async function save(fields: Partial<Link>) {
    try { const r = await post<{ link: Link }>("link", { id: link.id, kind: link.kind, label: link.label, color: link.color, ...fields }); onSaved(r.link); }
    catch (e) { say({ text: String((e as Error).message) }); }
  }
  async function remove() { try { await post("link/remove", { id: link.id }); onRemoved(link.id); } catch (e) { say({ text: String((e as Error).message) }); } }
  const random = () => `#${[0, 0, 0].map(() => Math.floor(80 + Math.random() * 160).toString(16).padStart(2, "0")).join("")}`;
  return (
    <div className="nwg-ui nwg-rel" role="dialog" aria-label="Edit this connection" style={{ left: Math.max(10, at.x + 14), top: Math.max(10, at.y - 20) }}>
      <div className="nwg-rel-h"><b>{names[0]} — {names[1]}</b><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
      <label className="nw-f"><span>What is it</span><input id="nwg-rel-label" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (label !== link.label) void save({ label }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
      <label className="nw-f"><span>Kind</span><select id="nwg-rel-kind" value={link.kind} onChange={(e) => void save({ kind: e.target.value as LinkKind })}>{LINK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <div className="nw-lab">Colour of this connection</div>
      <div className="nw-sw" role="group" aria-label="Connection colour">
        {PALETTE.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={link.color === c} onClick={() => void save({ color: c })} />)}
        <input type="color" aria-label="Pick any colour" value={link.color ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : "#6d7bff")} onChange={(e) => void save({ color: e.target.value })} />
        <button type="button" className="txt" onClick={() => void save({ color: random() })}>Random</button>
        {link.color && <button type="button" className="txt" onClick={() => void save({ color: null })}>Reset</button>}
      </div>
      <button type="button" className="nw-btn ghost" onClick={() => void remove()}>Remove this connection</button>
    </div>
  );
}
