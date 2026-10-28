import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  LINK_KINDS, PALETTE, TOOL_KEYS, autoLayout, edgesFor, followUp, imageUrl, initials, loadBoard, post, smoothPath, thinPoints,
  type BoardItem, type Edge, type Link, type LinkKind, type NetworkData, type Pen, type Point, type Tool, colorsFor,
} from "./network";
import { BoardBox, PenBar, Toolbar } from "./NetworkBoard";

type Colors = ReturnType<typeof colorsFor>;
type View = { x: number; y: number; k: number };
type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "drag"; id: string; dx: number; dy: number; moved: boolean; sx: number; sy: number }
  | { kind: "box"; id: string; mode: "move" | "size"; dx: number; dy: number; moved: boolean }
  | { kind: "pen"; points: [number, number][] }
  | { kind: "erase" };
const PERSON = { w: 196, h: 52 }, YOU = { w: 246, h: 80 };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sourceSize = (name: string, about: string) => ({ w: Math.round(Math.max(180, 86 + Math.max(name.length * 9.6, about.length * 6.8))), h: 68 });
const DASH: Record<string, string | undefined> = { via: "7 5", intro: "7 5", family: "2 5", other: "10 3 2 3" };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const inkOf = (c?: string) => (!c || c === "ink" ? "var(--nw-ink)" : c);

/**
 * The Network as a canvas: you in the middle, sources around you, people around their source, and a free board on top (text boxes,
 * sticky notes, pen strokes, images). Drag cards (positions are saved), drag the background to pan, scroll to zoom. Clicking a person
 * opens them; a source shows only its people; one of your own links can be renamed, recoloured or removed.
 */
export default function NetworkGraph({ data, colors, visible, selected, onPerson, onSource, onLinks, say }: {
  data: NetworkData; colors: Colors; visible: Set<string> | null; selected: string | null;
  onPerson: (id: string) => void; onSource: (id: string) => void; onLinks: (links: Link[]) => void; say: (t: { text: string } | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = useMemo(() => autoLayout(data), [data]);
  const [moved, setMoved] = useState<Map<string, Point>>(new Map());
  const pos = useCallback((id: string) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 }, [moved, base]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ edge: Edge; at: Point } | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [pen, setPen] = useState<Pen>({ color: "ink", width: 4.5, opacity: 0.9 });
  const [picked, setPicked] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const edges = useMemo(() => edgesFor(data, colors), [data, colors]);
  const peopleCount = useMemo(() => { const m = new Map<string, number>(); for (const p of data.people) if (p.sourceId && !p.via) m.set(p.sourceId, (m.get(p.sourceId) ?? 0) + 1); return m; }, [data.people]);
  const people = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);

  useEffect(() => { let on = true; loadBoard().then((b) => on && setBoard(b)).catch(() => { /* the map works without its board */ }); return () => { on = false; }; }, []);

  // Where a board item is drawn: a pinned note follows its card; anything else stays where it was put.
  const at = useCallback((it: BoardItem): Point => {
    if (it.pin && (people.has(it.pin.id) || data.sources.some((s) => s.id === it.pin!.id))) { const c = pos(it.pin.id); return { x: c.x + it.pin.dx, y: c.y + it.pin.dy }; }
    return { x: it.x, y: it.y };
  }, [pos, people, data.sources]);

  const fit = useCallback(() => {
    const el = stage.current; if (!el) return;
    const pts = ["you", ...data.sources.map((s) => s.id), ...data.people.map((p) => p.id)].map((id) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 });
    for (const it of board) { if (it.kind === "stroke") continue; const p = at(it); pts.push(p, { x: p.x + (it.w ?? 0), y: p.y + (it.h ?? 0) }); }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // Leave the strips at the top (tools) and bottom (zoom and legend) clear.
    const w = el.clientWidth, h = el.clientHeight - 112, bw = Math.max(...xs) - Math.min(...xs) + 320, bh = Math.max(...ys) - Math.min(...ys) + 160;
    const k = Math.max(0.25, Math.min(1.1, w / bw, h / bh));
    setView({ k, x: w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: 56 + h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k });
  }, [data.sources, data.people, moved, base, board, at]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && stage.current) { fitted.current = true; fit(); } }, [fit]);

  useEffect(() => {
    const el = stage.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".nwgb-body,.nwg-ui")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      setView((v) => { const k = Math.max(0.2, Math.min(2.5, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)))), f = k / v.k; return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }; });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const zoomBy = (f: number) => { const el = stage.current; if (!el) return; const cx = el.clientWidth / 2, cy = el.clientHeight / 2; setView((v) => { const k = Math.max(0.2, Math.min(2.5, v.k * f)), g = k / v.k; return { k, x: cx - (cx - v.x) * g, y: cy - (cy - v.y) * g }; }); };
  const world = (e: { clientX: number; clientY: number }) => { const r = stage.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };

  /* ---------- board saving ---------- */
  const replace = (it: BoardItem) => setBoard((b) => b.map((x) => (x.id === it.id ? it : x)));
  const saveItem = useCallback(async (fields: Partial<BoardItem> & { id?: string; kind?: BoardItem["kind"] }) => {
    try { const r = await post<{ item: BoardItem }>("board/save", fields); return r.item; } catch (e) { say({ text: String((e as Error).message) }); return null; }
  }, [say]);
  async function create(fields: Partial<BoardItem> & { kind: BoardItem["kind"] }) {
    const item = await saveItem(fields);
    if (item) { setBoard((b) => [...b, item]); setAdded((a) => [...a, item.id]); }
    return item;
  }
  const remove = useCallback(async (id: string) => {
    setBoard((b) => b.filter((x) => x.id !== id)); setAdded((a) => a.filter((x) => x !== id)); setPicked((p) => (p === id ? null : p));
    try { await post("board/remove", { id }); } catch (e) { say({ text: String((e as Error).message) }); }
  }, [say]);
  const undo = useCallback(() => { const id = added[added.length - 1]; if (id) void remove(id); else say({ text: "Nothing to undo." }); }, [added, remove, say]);

  async function addImage(file: File) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { say({ text: "Add a PNG, JPEG, GIF or WebP image." }); return; }
    try {
      const { blob, w, h } = await shrink(file);
      if (blob.size > 2_500_000) { say({ text: "That image is over 2.5 MB. Pick a smaller one." }); return; }
      const base64 = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => bad(new Error("The image could not be read")); r.readAsDataURL(blob); });
      const { id } = await post<{ id: string }>("board/image", { type: blob.type, base64 });
      const el = stage.current!, cx = (el.clientWidth / 2 - view.x) / view.k, cy = (el.clientHeight / 2 - view.y) / view.k;
      const scale = Math.min(1, 320 / w), iw = Math.round(w * scale), ih = Math.round(h * scale);
      const item = await create({ kind: "image", imageId: id, x: Math.round(cx - iw / 2 + (Math.random() - 0.5) * 120), y: Math.round(cy - ih / 2 + (Math.random() - 0.5) * 90), w: iw, h: ih });
      if (item) { setTool("select"); setPicked(item.id); say({ text: "Image added. It is not linked to anything. Drag to move, pull the corner to resize, Delete to remove." }); }
    } catch (e) { say({ text: String((e as Error).message) }); }
  }

  // Keys: tool letters, Delete for the picked board item, Ctrl/Cmd+Z to undo, I for an image. Ignored while typing or in a dialog.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || document.querySelector(".nw-dim")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "Delete" || e.key === "Backspace") && picked) { e.preventDefault(); void remove(picked); return; }
      if (e.key === "Escape") { setTool("select"); setPicked(null); return; }
      const k = e.key.toLowerCase();
      if (k === "i") { fileInput.current?.click(); return; }
      if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picked, undo, remove]);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { if (typing(e.target) || document.querySelector(".nw-dim")) return; const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); void addImage(f); } };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  /* ---------- pointer ---------- */
  function eraseAt(e: { clientX: number; clientY: number }) {
    for (const n of document.elementsFromPoint(e.clientX, e.clientY)) { const id = (n as Element).getAttribute?.("data-stroke"); if (id) void remove(id); }
  }
  function down(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const t = e.target as Element;
    if (t.closest(".nwg-ui")) return;
    const boxEl = t.closest<SVGForeignObjectElement>("[data-board]");
    // Typing, clicking a note's buttons: let the box have the event.
    if (boxEl && !t.closest(".nwgb-grip,.nwgb-rz") && boxEl.getAttribute("data-kind") !== "image") return;
    if (boxEl && t.closest("button")) return;
    stage.current?.setPointerCapture(e.pointerId);
    setEditing(null);
    const w = world(e);
    if (tool === "pen") { gesture.current = { kind: "pen", points: [[w.x, w.y]] }; setDrawing([[w.x, w.y]]); return; }
    if (tool === "eraser") { gesture.current = { kind: "erase" }; eraseAt(e); return; }
    if (tool === "text" || tool === "note") {
      const note = tool === "note";
      void create({ kind: tool, x: Math.round(w.x - 20), y: Math.round(w.y - 12), w: note ? 190 : 230, h: note ? 150 : 70, text: "", ...(note ? { color: "#fbbf24" } : {}) }).then((it) => {
        if (!it) return; setPicked(it.id);
        window.setTimeout(() => (document.querySelector(`[data-board="${it.id}"] .nwgb-body`) as HTMLElement | null)?.focus(), 30);
      });
      setTool("select"); gesture.current = null; return;
    }
    if (boxEl && tool === "select") {
      const id = boxEl.getAttribute("data-board")!, it = board.find((x) => x.id === id)!, p = at(it);
      setPicked(id);
      gesture.current = { kind: "box", id, mode: t.closest(".nwgb-rz") ? "size" : "move", dx: w.x - p.x, dy: w.y - p.y, moved: false };
      return;
    }
    setPicked(null);
    const line = t.closest<SVGPathElement>("[data-edge]"), node = t.closest<SVGGElement>("[data-node]");
    if (tool === "select" && line && !node) { const edge = edges.find((x) => x.key === line.dataset.edge); if (edge?.link) { const r = stage.current!.getBoundingClientRect(); setEditing({ edge, at: { x: e.clientX - r.left, y: e.clientY - r.top } }); } gesture.current = null; return; }
    if (tool === "select" && node) { const id = node.dataset.node!, p = pos(id); gesture.current = { kind: "drag", id, dx: w.x - p.x, dy: w.y - p.y, moved: false, sx: e.clientX, sy: e.clientY }; return; }
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    if (g.kind === "pan") { if (Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3) g.moved = true; setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy })); return; }
    if (g.kind === "pen") { const w = world(e); g.points.push([w.x, w.y]); setDrawing([...g.points]); return; }
    if (g.kind === "erase") { eraseAt(e); return; }
    if (g.kind === "box") {
      g.moved = true; const w = world(e);
      setBoard((b) => b.map((it) => {
        if (it.id !== g.id) return it;
        if (g.mode === "size") { const p = at(it); return { ...it, w: Math.max(80, Math.round(w.x - p.x)), h: Math.max(40, Math.round(w.y - p.y)) }; }
        return { ...it, pin: null, x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) };
      }));
      return;
    }
    if (!g.moved && Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) < 4) return;
    g.moved = true; const w = world(e);
    setMoved((m) => new Map(m).set(g.id, { x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) }));
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.kind === "pen") {
      setDrawing(null);
      const points = thinPoints(g.points);
      void create({ kind: "stroke", points, color: pen.color, width: pen.width, opacity: pen.opacity });
      return;
    }
    if (g.kind === "box") {
      const it = board.find((x) => x.id === g.id); if (!it || !g.moved) return;
      if (g.mode === "size") { void saveItem({ id: it.id, w: it.w, h: it.h }).then((s) => s && replace(s)); return; }
      // Dropped with the pointer over a person (or source) card: pin it there, so it moves with them.
      const w = world(e), hit = it.kind === "image" ? null : cardAt(w);
      // A pinned box sits just right of its card, so the card stays visible and easy to grab.
      const half = hit ? (people.has(hit) ? PERSON.w / 2 : sourceSize(data.sources.find((x) => x.id === hit)!.name, "").w / 2) : 0;
      const fields = hit ? { id: it.id, x: pos(hit).x + half + 14, y: pos(hit).y - 26, pin: { id: hit, dx: half + 14, dy: -26 } } : { id: it.id, x: it.x, y: it.y, pin: null };
      if (hit) replace({ ...it, ...fields });
      void saveItem(fields).then((s) => { if (s) { replace(s); if (hit) say({ text: `Pinned to ${people.get(hit)?.name ?? data.sources.find((x) => x.id === hit)?.name}. It moves with them.` }); } });
      return;
    }
    if (g.kind === "drag") {
      if (g.moved) { const p = moved.get(g.id); if (p) post("positions", { items: [{ id: g.id, ...p }] }).catch((err: Error) => say({ text: `That position was not saved: ${err.message}` })); return; }
      if (g.id === "you") return;
      if (people.has(g.id)) onPerson(g.id); else onSource(g.id);
    }
  }
  function cardAt(w: Point): string | null {
    for (const p of data.people) { const c = pos(p.id); if (Math.abs(w.x - c.x) <= PERSON.w / 2 + 6 && Math.abs(w.y - c.y) <= PERSON.h / 2 + 6) return p.id; }
    for (const s of data.sources) { const c = pos(s.id), sz = sourceSize(s.name, s.about || s.type); if (Math.abs(w.x - c.x) <= sz.w / 2 && Math.abs(w.y - c.y) <= sz.h / 2) return s.id; }
    return null;
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
  const pinName = (it: BoardItem) => (it.pin ? people.get(it.pin.id)?.name.split(" ")[0] ?? data.sources.find((s) => s.id === it.pin!.id)?.name ?? null : null);

  return (
    <div ref={stage} className={`nwg tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/")); if (f) void addImage(f); }}
      role="application" aria-label="Your network as a map. Drag cards to arrange them; Enter opens the focused card.">
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
            {board.filter((it) => it.kind === "image").map((it) => { const p = at(it); return (
              <foreignObject key={it.id} x={p.x} y={p.y} width={it.w} height={it.h} data-board={it.id} data-kind="image" className="nwgb-fo">
                <div className={`nwgb-img${picked === it.id ? " sel" : ""}`}><img src={imageUrl(it.imageId!)} alt="" draggable={false} /><i className="nwgb-rz" /><button type="button" className="del" aria-label="Delete image" onClick={() => void remove(it.id)}>×</button></div>
              </foreignObject>); })}
            {board.filter((it) => it.kind === "stroke").map((it) => { const d = smoothPath(it.points ?? []); return (
              <g key={it.id}><path d={d} className="nwgb-stroke" style={{ stroke: inkOf(it.color), strokeWidth: it.width, opacity: it.opacity }} /><path d={d} className="nwgb-hit" data-stroke={it.id} style={{ strokeWidth: Math.max(16, (it.width ?? 4) + 10) }} /></g>); })}
            {drawing && <path d={smoothPath(drawing)} className="nwgb-stroke" style={{ stroke: inkOf(pen.color), strokeWidth: pen.width, opacity: pen.opacity }} />}
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
              const pt = pos(p.id), c = colors.person.get(p.id) ?? "#8a919c", dim = lit && !lit.has(p.id), ax = -PERSON.w / 2 + 28;
              const due = followUp(p.nextFollowUp)?.due, replied = p.history.length > 0 && p.history[p.history.length - 1].type === "reply";
              const lineage = p.via && p.sourceId ? colors.source.get(p.sourceId) : undefined;
              return (
                <g key={p.id} data-node={p.id} className={`nwg-node${p.id === selected ? " sel" : ""}`} transform={`translate(${pt.x} ${pt.y})`} style={{ opacity: dim ? 0.16 : 1 }} tabIndex={0} role="button" aria-label={`${p.name}${p.role ? `, ${p.role}` : ""}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPerson(p.id); } }} onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}>
                  <rect x={-PERSON.w / 2 - 5} y={-PERSON.h / 2 - 5} width={PERSON.w + 10} height={PERSON.h + 10} rx={17} className="nwg-halo" />
                  <rect x={-PERSON.w / 2} y={-PERSON.h / 2} width={PERSON.w} height={PERSON.h} rx={13} fill={card} stroke={c} strokeWidth={p.id === selected ? 3 : 1.6} />
                  <circle cx={ax} r={19} fill={c} fillOpacity={0.15} stroke={c} strokeWidth={1.8} />
                  <text x={ax} y={1} className="nwg-ini" fill={c}>{initials(p.name)}</text>
                  {(due || replied) && <circle cx={ax + 14} cy={14} r={6} fill={due ? "var(--nw-warn)" : "var(--nw-ok)"} stroke={card} strokeWidth={2.5}><title>{due ? "Follow-up due" : "They replied"}</title></circle>}
                  {lineage && <circle cx={PERSON.w / 2 - 2} cy={-PERSON.h / 2 + 2} r={7} fill={lineage} stroke={bg} strokeWidth={2.5}><title>Belongs to {data.sources.find((s) => s.id === p.sourceId)?.name}, introduced by {people.get(p.via!)?.name}</title></circle>}
                  <text x={ax + 30} y={p.role ? -3 : 5} className="nwg-pname">{clip(p.name, 20)}</text>
                  {p.role && <text x={ax + 30} y={13} className="nwg-sub">{clip(p.role, 22)}</text>}
                </g>
              );
            })}
          </g>
          <g>
            {board.filter((it) => it.kind === "text" || it.kind === "note").map((it) => { const p = at(it); return (
              <BoardBox key={it.id} item={it} x={p.x} y={p.y} selected={picked === it.id} pinnedTo={pinName(it)}
                onText={(text) => { replace({ ...it, text }); void saveItem({ id: it.id, text }); }}
                onColor={(color) => { replace({ ...it, color }); void saveItem({ id: it.id, color }); }}
                onRemove={() => void remove(it.id)} />); })}
          </g>
        </g>
      </svg>
      <Toolbar tool={tool} setTool={setTool} onImage={() => fileInput.current?.click()} onUndo={undo} canUndo={added.length > 0} />
      {(tool === "pen" || tool === "eraser") && <PenBar pen={pen} setPen={setPen} eraser={tool === "eraser"} />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addImage(f); }} />
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

/** Photos are scaled down to 1600 px on the long side before upload; a GIF goes as it is, so it keeps moving. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That image could not be opened")); i.src = url; });
    const w = img.naturalWidth || 320, h = img.naturalHeight || 240;
    if (file.type === "image/gif" || Math.max(w, h) <= 1600) return { blob: file, w, h };
    const s = 1600 / Math.max(w, h), c = document.createElement("canvas");
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, file.type === "image/png" ? "image/png" : "image/jpeg", 0.86));
    return { blob: blob ?? file, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
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
