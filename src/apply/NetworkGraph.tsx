import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  sourceLabel, SOURCE_TYPES, LINK_KINDS, PALETTE, TOOL_KEYS, autoLayout, edgesFor, followUp, imageUrl, initials, plusDays, post, smoothPath, thinPoints, warmPath, workProgress,
  type CanvasLayers, type BoardItem, type Edge, type Link, type LinkKind, type NetworkData, type Pen, type Person, type Point, type Source, type Tool, colorsFor,
} from "./network";
import { BoardBox, PenBar, Toolbar } from "./NetworkBoard";

type Colors = ReturnType<typeof colorsFor>;
type View = { x: number; y: number; k: number };
type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "drag"; id: string; dx: number; dy: number; moved: boolean; sx: number; sy: number }
  | { kind: "box"; id: string; mode: "move" | "size"; dx: number; dy: number; moved: boolean }
  | { kind: "pen"; points: [number, number][] }
  | { kind: "erase" }
  | { kind: "area"; sx: number; sy: number; x: number; y: number; add: boolean };
const PERSON = { w: 196, h: 52 }, YOU = { w: 246, h: 80 }, WORK = { w: 176, h: 58 };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Card size by kind: organisations and events have their own wider cards; everything else grows with its name. */
const sourceSize = (s: Source) => (s.type === "company" || s.type === "staffing" ? { w: 330, h: 78 } : s.type === "event" ? { w: 276, h: 80 }
  : { w: Math.round(Math.max(180, 86 + Math.max(s.name.length * 9.6, (s.about || s.type).length * 6.8))), h: 68 });
/** A ticket: a rounded card with a half-circle notch cut into each side. */
function ticketPath(w: number, h: number, r = 14, n = 9) {
  const x = -w / 2, y = -h / 2;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${-n}A${n} ${n} 0 0 0 ${x + w} ${n}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${n}A${n} ${n} 0 0 0 ${x} ${-n}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}
const PIN = "M0 -5.2a3.6 3.6 0 0 0-3.6 3.6c0 2.7 3.6 6.4 3.6 6.4s3.6-3.7 3.6-6.4A3.6 3.6 0 0 0 0-5.2z";
const HOUSE = "M-6 0.5 0 -5l6 5.5M-4.2-1v5.8h8.4V-1";
const CALENDAR = "M-9-7h18v16h-18zM-9-2h18M-4.5-10v5M4.5-10v5";
const DASH: Record<string, string | undefined> = { via: "7 5", intro: "7 5", family: "2 5", other: "10 3 2 3", employer: "1 5" };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const inkOf = (c?: string) => (!c || c === "ink" ? "var(--nw-ink)" : c);

/**
 * The Network as a canvas: you in the middle, sources around you, people around their source, and a free board on top (text boxes,
 * sticky notes, pen strokes, images). Drag cards (positions are saved), drag the background to pan, scroll to zoom. Clicking a person
 * opens them; a source shows only its people; one of your own links can be renamed, recoloured or removed.
 */
export default function NetworkGraph({ data, layers, stackPeople, onRevealLayer, colors, visible, selected, selectedWork, board, setBoard, onPerson, onSource, onYou, onWork, onLinks, onPeople, onBulkMail, say }: {
  data: NetworkData; layers: CanvasLayers; stackPeople: boolean; onRevealLayer: (layer: keyof CanvasLayers) => void; colors: Colors; visible: Set<string> | null; selected: string | null; selectedWork: string | null;
  board: BoardItem[]; setBoard: (f: (b: BoardItem[]) => BoardItem[]) => void;
  onPerson: (id: string) => void; onSource: (id: string) => void; onYou: () => void; onWork: (id: string) => void; onLinks: (links: Link[]) => void;
  onPeople: (people: Person[]) => void; onBulkMail: (ids: string[]) => void; say: (t: { text: string } | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = useMemo(() => autoLayout(data), [data]);
  const [moved, setMoved] = useState<Map<string, Point>>(new Map());
  const pos = useCallback((id: string) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 }, [moved, base]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ edge: Edge; at: Point } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [pen, setPen] = useState<Pen>({ color: "ink", width: 4.5, opacity: 0.9 });
  const [picked, setPicked] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [pathOpen, setPathOpen] = useState(false);
  const [pathTo, setPathTo] = useState("");
  const [groupEdit, setGroupEdit] = useState<{ id: string; at: Point } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const edges = useMemo(() => edgesFor(data, colors), [data, colors]);
  const peopleCount = useMemo(() => { const m = new Map<string, number>(); for (const p of data.people) if (p.sourceId && !p.via) m.set(p.sourceId, (m.get(p.sourceId) ?? 0) + 1); return m; }, [data.people]);
  const people = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);

  const works = useMemo(() => board.filter((b) => b.kind === "work" && layers.work), [board, layers.work]);
  const stacks = useMemo(() => {
    if (!stackPeople || !layers.people) return [];
    return data.sources.flatMap((source) => {
      const members = data.people.filter((person) => person.sourceId === source.id);
      if (members.length < 2 || expandedStacks.has(source.id)) return [];
      const point = pos(source.id);
      return [{ id: source.id, name: sourceLabel(source, data.sources, data.people), members, x: point.x, y: point.y + 100 }];
    });
  }, [stackPeople, layers.people, data.sources, data.people, expandedStacks, pos]);
  const collapsedPeople = useMemo(() => new Set(stacks.flatMap((stack) => stack.members.map((person) => person.id))), [stacks]);
  const shownPeople = useMemo(() => layers.people ? data.people.filter((person) => !collapsedPeople.has(person.id)) : [], [layers.people, data.people, collapsedPeople]);
  const shownSources = useMemo(() => layers.sources ? data.sources : [], [layers.sources, data.sources]);
  const nodeShown = (id: string) => id === 'you' || (people.has(id) ? layers.people && !collapsedPeople.has(id) : layers.sources);
  const route = useMemo(() => (pathOpen && pathTo ? warmPath(edges, pathTo) : null), [pathOpen, pathTo, edges]);

  // Where a board item is drawn: a pinned note follows its card; anything else stays where it was put.
  const at = useCallback((it: BoardItem): Point => {
    if (it.pin && (people.has(it.pin.id) || data.sources.some((s) => s.id === it.pin!.id))) { const c = pos(it.pin.id); return { x: c.x + it.pin.dx, y: c.y + it.pin.dy }; }
    return { x: it.x, y: it.y };
  }, [pos, people, data.sources]);

  const fit = useCallback(() => {
    const el = stage.current; if (!el) return;
    const pts = ["you", ...shownSources.map((s) => s.id), ...shownPeople.map((p) => p.id)].map((id) => moved.get(id) ?? base.get(id) ?? { x: 0, y: 0 });
    pts.push(...stacks.map(({ x, y }) => ({ x, y })));
    for (const it of board) { if (it.kind === "stroke" || it.kind === "group" || (it.kind === "work" ? !layers.work : !layers.board)) continue; const p = at(it); pts.push(p, { x: p.x + (it.w ?? 0), y: p.y + (it.h ?? 0) }); }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // Leave the strips at the top (tools) and bottom (zoom and legend) clear.
    const w = el.clientWidth, h = el.clientHeight - 112, bw = Math.max(...xs) - Math.min(...xs) + 320, bh = Math.max(...ys) - Math.min(...ys) + 160;
    const k = Math.max(0.25, Math.min(1.1, w / bw, h / bh));
    setView({ k, x: w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: 56 + h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k });
  }, [shownSources, shownPeople, stacks, layers.work, layers.board, moved, base, board, at]);
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
  }, [say, setBoard]);
  const undo = useCallback(() => { const id = added[added.length - 1]; if (id) void remove(id); else say({ text: "Nothing to undo." }); }, [added, remove, say]);

  async function addImage(file: File) {
    onRevealLayer('board');
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
      if (e.key === "Escape") { setTool("select"); setPicked(null); setMulti(new Set()); setPathOpen(false); return; }
      const k = e.key.toLowerCase();
      if (k === "i") { fileInput.current?.click(); return; }
      if (k === "f") { setPathOpen((o) => !o); return; }
      if (TOOL_KEYS[k]) { const next = TOOL_KEYS[k]; if (['text', 'note', 'pen', 'eraser'].includes(next)) onRevealLayer('board'); if (next === 'work') onRevealLayer('work'); setTool(next); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picked, undo, remove, onRevealLayer]);
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
    const groupEl = t.closest<SVGElement>("[data-group]");
    if ((tool === "select" || tool === "area") && groupEl) { const r = stage.current!.getBoundingClientRect(); setGroupEdit({ id: groupEl.getAttribute("data-group")!, at: { x: e.clientX - r.left, y: e.clientY - r.top } }); gesture.current = null; return; }
    if (tool === "pen") { gesture.current = { kind: "pen", points: [[w.x, w.y]] }; setDrawing([[w.x, w.y]]); return; }
    if (tool === "eraser") { gesture.current = { kind: "erase" }; eraseAt(e); return; }
    if (tool === "area") { gesture.current = { kind: "area", sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, add: e.shiftKey }; return; }
    if (tool === "work") {
      void create({ kind: "work", title: "New work", start: plusDays(0), end: plusDays(14), people: [], next: "", x: Math.round(w.x), y: Math.round(w.y) }).then((it) => { if (it) onWork(it.id); });
      setTool("select"); gesture.current = null; return;
    }
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
    const workEl = t.closest<SVGGElement>("[data-work]");
    if (tool === "select" && workEl) { const id = workEl.dataset.work!, it = works.find((x) => x.id === id)!; gesture.current = { kind: "box", id, mode: "move", dx: w.x - it.x, dy: w.y - it.y, moved: false }; return; }
    if (tool === "select" && node) {
      const id = node.dataset.node!;
      if (e.shiftKey && people.has(id)) { setMulti((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; }); gesture.current = null; return; }
      if (!multi.has(id)) setMulti(new Set());
      const p = pos(id); gesture.current = { kind: "drag", id, dx: w.x - p.x, dy: w.y - p.y, moved: false, sx: e.clientX, sy: e.clientY }; return;
    }
    setMulti(new Set());
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    if (g.kind === "pan") { if (Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3) g.moved = true; setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy })); return; }
    if (g.kind === "pen") { const w = world(e); g.points.push([w.x, w.y]); setDrawing([...g.points]); return; }
    if (g.kind === "erase") { eraseAt(e); return; }
    if (g.kind === "area") { g.x = e.clientX; g.y = e.clientY; const r = stage.current!.getBoundingClientRect(); setMarquee({ x: Math.min(g.sx, g.x) - r.left, y: Math.min(g.sy, g.y) - r.top, w: Math.abs(g.x - g.sx), h: Math.abs(g.y - g.sy) }); return; }
    if (g.kind === "box") {
      g.moved = true; const w = world(e);
      setBoard((b) => b.map((it) => {
        if (it.id !== g.id) return it;
        if (g.mode === "size") { const p = at(it); return { ...it, w: Math.max(80, Math.round(w.x - p.x)), h: Math.max(40, Math.round(w.y - p.y)) }; }
        if (it.kind === "work") return { ...it, x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) };
        return { ...it, pin: null, x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) };
      }));
      return;
    }
    if (!g.moved && Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) < 4) return;
    g.moved = true; const w = world(e);
    const to = { x: Math.round(w.x - g.dx), y: Math.round(w.y - g.dy) }, from = pos(g.id), dx = to.x - from.x, dy = to.y - from.y;
    // Dragging one of several picked people moves them all.
    setMoved((m) => { const n = new Map(m).set(g.id, to); if (multi.has(g.id)) for (const id of multi) if (id !== g.id) { const p = n.get(id) ?? base.get(id) ?? { x: 0, y: 0 }; n.set(id, { x: p.x + dx, y: p.y + dy }); } return n; });
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.kind === "pen") {
      setDrawing(null);
      const points = thinPoints(g.points);
      void create({ kind: "stroke", points, color: pen.color, width: pen.width, opacity: pen.opacity });
      return;
    }
    if (g.kind === "area") {
      setMarquee(null);
      const r = stage.current!.getBoundingClientRect(), x0 = Math.min(g.sx, g.x) - r.left, x1 = Math.max(g.sx, g.x) - r.left, y0 = Math.min(g.sy, g.y) - r.top, y1 = Math.max(g.sy, g.y) - r.top;
      if (x1 - x0 < 6 && y1 - y0 < 6) return;
      const inside = shownPeople.filter((p) => { const c = pos(p.id), sx = c.x * view.k + view.x, sy = c.y * view.k + view.y; return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1; }).map((p) => p.id);
      setMulti((m) => new Set([...(g.add ? m : []), ...inside]));
      if (inside.length) say({ text: `${inside.length} selected. Pick an action below, or drag any of them to move them all.` });
      return;
    }
    if (g.kind === "box") {
      const it = board.find((x) => x.id === g.id); if (!it) return;
      if (it.kind === "work") { if (g.moved) void saveItem({ id: it.id, x: it.x, y: it.y }); else onWork(it.id); return; }
      if (!g.moved) return;
      if (g.mode === "size") { void saveItem({ id: it.id, w: it.w, h: it.h }).then((s) => s && replace(s)); return; }
      // Dropped with the pointer over a person (or source) card: pin it there, so it moves with them.
      const w = world(e), hit = it.kind === "image" ? null : cardAt(w);
      // A pinned box sits just right of its card, so the card stays visible and easy to grab.
      const half = hit ? (people.has(hit) ? PERSON.w / 2 : sourceSize(data.sources.find((x) => x.id === hit)!).w / 2) : 0;
      const fields = hit ? { id: it.id, x: pos(hit).x + half + 14, y: pos(hit).y - 26, pin: { id: hit, dx: half + 14, dy: -26 } } : { id: it.id, x: it.x, y: it.y, pin: null };
      if (hit) replace({ ...it, ...fields });
      void saveItem(fields).then((s) => { if (s) { replace(s); if (hit) say({ text: `Pinned to ${people.get(hit)?.name ?? data.sources.find((x) => x.id === hit)?.name}. It moves with them.` }); } });
      return;
    }
    if (g.kind === "drag") {
      if (g.moved) {
        const ids = multi.has(g.id) ? [...multi] : [g.id];
        const items = ids.map((id) => ({ id, ...(moved.get(id) ?? pos(id)) }));
        post("positions", { items }).catch((err: Error) => say({ text: `That position was not saved: ${err.message}` }));
        return;
      }
      if (g.id === "you") { onYou(); return; }
      if (people.has(g.id)) onPerson(g.id); else onSource(g.id);
    }
  }
  function cardAt(w: Point): string | null {
    for (const p of shownPeople) { const c = pos(p.id); if (Math.abs(w.x - c.x) <= PERSON.w / 2 + 6 && Math.abs(w.y - c.y) <= PERSON.h / 2 + 6) return p.id; }
    for (const s of shownSources) { const c = pos(s.id), sz = sourceSize(s); if (Math.abs(w.x - c.x) <= sz.w / 2 && Math.abs(w.y - c.y) <= sz.h / 2) return s.id; }
    return null;
  }

  // What stays bright: the filter's people (and their sources), or the person you opened and everyone directly linked to them.
  const lit = useMemo(() => {
    if (route) return new Set(route.nodes);
    if (selected) { const s = new Set([selected]); for (const e of edges) { if (e.a === selected) s.add(e.b); if (e.b === selected) s.add(e.a); } return s; }
    if (!visible) return null;
    const s = new Set<string>(["you", ...visible]);
    for (const p of data.people) if (visible.has(p.id) && p.sourceId) s.add(p.sourceId);
    return s;
  }, [selected, visible, edges, data.people, route]);
  const focus = selected ?? hover;
  const onRoute = useMemo(() => new Set(route?.edges.map((e) => e.key) ?? []), [route]);

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
            {board.filter((it) => layers.board && it.kind === "group").map((gr) => {
              const pts = (gr.ids ?? []).filter((id) => layers.people && people.has(id) && !collapsedPeople.has(id)).map((id) => pos(id));
              if (!pts.length) return null;
              const x0 = Math.min(...pts.map((p) => p.x)) - PERSON.w / 2 - 24, x1 = Math.max(...pts.map((p) => p.x)) + PERSON.w / 2 + 24;
              const y0 = Math.min(...pts.map((p) => p.y)) - PERSON.h / 2 - 38, y1 = Math.max(...pts.map((p) => p.y)) + PERSON.h / 2 + 24;
              return (<g key={gr.id} className="nwg-group"><rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={22} />
                <text x={x0 + 16} y={y0 + 23} data-group={gr.id} className="nwg-glabel">{gr.label} · {pts.length}<title>Rename or remove this group</title></text></g>);
            })}
          </g>
          <g>
            {(layers.connections ? works : []).flatMap((wk) => (wk.people ?? []).filter((id) => nodeShown(id)).map((id) => {
              const a = { x: wk.x, y: wk.y }, b = pos(id), pr = workProgress(wk), c = wk.done ? "var(--nw-ok)" : pr.late ? "var(--nw-bad)" : pr.ending ? "var(--nw-warn)" : "var(--nw-accent)";
              const dim = lit && !lit.has(id), hot = selectedWork === wk.id;
              return <path key={`${wk.id}-${id}`} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={c} strokeDasharray="10 3 2 3" strokeWidth={hot ? 2.6 : 1.7} fill="none" style={{ opacity: dim ? 0.07 : hot ? 1 : 0.75 }} />;
            }))}
          </g>
          <g>
            {edges.filter((edge) => layers.connections && nodeShown(edge.a) && nodeShown(edge.b)).map((e) => {
              const p = path(e), hot = onRoute.has(e.key) || (!route && focus != null && (e.a === focus || e.b === focus)), dim = lit && !(lit.has(e.a) && lit.has(e.b));
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
            {board.filter((it) => layers.board && it.kind === "image").map((it) => { const p = at(it); return (
              <foreignObject key={it.id} x={p.x} y={p.y} width={it.w} height={it.h} data-board={it.id} data-kind="image" className="nwgb-fo">
                <div className={`nwgb-img${picked === it.id ? " sel" : ""}`}><img src={imageUrl(it.imageId!)} alt="" draggable={false} /><i className="nwgb-rz" /><button type="button" className="del" aria-label="Delete image" onClick={() => void remove(it.id)}>×</button></div>
              </foreignObject>); })}
            {board.filter((it) => layers.board && it.kind === "stroke").map((it) => { const d = smoothPath(it.points ?? []); return (
              <g key={it.id}><path d={d} className="nwgb-stroke" style={{ stroke: inkOf(it.color), strokeWidth: it.width, opacity: it.opacity }} /><path d={d} className="nwgb-hit" data-stroke={it.id} style={{ strokeWidth: Math.max(16, (it.width ?? 4) + 10) }} /></g>); })}
            {layers.board && drawing && <path d={smoothPath(drawing)} className="nwgb-stroke" style={{ stroke: inkOf(pen.color), strokeWidth: pen.width, opacity: pen.opacity }} />}
          </g>
          <g>
            <g data-node="you" className="nwg-node nwg-you-node" transform={`translate(${youPos.x} ${youPos.y})`} tabIndex={0} role="button" aria-label="You: open your profile"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onYou(); } }}>
              <rect x={-YOU.w / 2 - 7} y={-YOU.h / 2 - 7} width={YOU.w + 14} height={YOU.h + 14} rx={24} className="nwg-you-pulse" />
              <rect x={-YOU.w / 2} y={-YOU.h / 2} width={YOU.w} height={YOU.h} rx={18} className="nwg-you" />
              <circle cx={-YOU.w / 2 + 44} r={28} className="nwg-you-av" />
              {data.you?.photoId ? <><clipPath id="nwg-you-photo"><circle cx={-YOU.w / 2 + 44} r={26} /></clipPath><image href={imageUrl(data.you.photoId)} x={-YOU.w / 2 + 18} y={-26} width={52} height={52} clipPath="url(#nwg-you-photo)" preserveAspectRatio="xMidYMid slice" /></>
                : <text x={-YOU.w / 2 + 44} y={1} className="nwg-you-ini">{data.you?.name ? initials(data.you.name) : "YOU"}</text>}
              <text x={-YOU.w / 2 + 86} y={data.you?.title ? -10 : -4} className="nwg-you-name">{clip(data.you?.name || "You", 16)}</text>
              {data.you?.title && <text x={-YOU.w / 2 + 86} y={7} className="nwg-you-title">{clip(data.you.title, 24)}</text>}
              <text x={-YOU.w / 2 + 86} y={data.you?.title ? 24 : 16} className="nwg-you-sub">{youSub}</text>
            </g>
            {shownSources.map((s) => {
              const p = pos(s.id), c = colors.source.get(s.id) ?? PALETTE[0], sz = sourceSize(s), n = peopleCount.get(s.id) ?? 0, dim = lit && !lit.has(s.id);
              const kind = SOURCE_TYPES.find(([type]) => type === s.type)?.[1] || s.type, org = s.type === "company" || s.type === "staffing", event = s.type === "event";
              const via = s.context || (s.parentSourceId ? `Via ${data.sources.find((parent) => parent.id === s.parentSourceId)?.name || "another source"}` : s.viaPersonId && people.has(s.viaPersonId) ? `Via ${people.get(s.viaPersonId)!.name}` : "");
              const faces = data.people.filter((x) => x.sourceId === s.id).slice(0, 3), x0 = -sz.w / 2;
              const picture = (x: number, y: number, size: number, rx: number) => s.photoId
                ? <><clipPath id={`nwg-src-${s.id}`}><rect x={x} y={y} width={size} height={size} rx={rx} /></clipPath><image href={imageUrl(s.photoId)} x={x} y={y} width={size} height={size} clipPath={`url(#nwg-src-${s.id})`} preserveAspectRatio="xMidYMid slice" /></> : null;
              return (
                <g key={s.id} data-node={s.id} className={`nwg-node nwg-src is-${s.type}`} transform={`translate(${p.x} ${p.y})`} style={{ opacity: dim ? 0.18 : 1 }} tabIndex={0} role="button" aria-label={`${sourceLabel(s, data.sources, data.people)}: open it`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSource(s.id); } }} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
                  <title>{sourceLabel(s, data.sources, data.people)}</title>
                  {event ? <>
                    {/* An event is a ticket: notched sides, a perforation, a calendar, its place and its date. */}
                    <path d={ticketPath(sz.w + 10, sz.h + 10, 18, 12)} className="nwg-halo" />
                    <path d={ticketPath(sz.w, sz.h)} fill={card} stroke={c} strokeWidth={1.8} />
                    <line x1={x0 + 66} y1={-sz.h / 2 + 8} x2={x0 + 66} y2={sz.h / 2 - 8} stroke={c} strokeOpacity={0.45} strokeDasharray="3 4" />
                    <rect x={x0 + 14} y={-20} width={40} height={40} rx={10} fill={c} fillOpacity={0.14} />
                    {picture(x0 + 14, -20, 40, 10) ?? <path d={CALENDAR} transform={`translate(${x0 + 34} 1)`} fill="none" stroke={c} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
                    <text x={x0 + 80} y={-12} className="nwg-sname">{clip(s.name, 20)}</text>
                    <text x={x0 + 80} y={5} className="nwg-kind">{clip(via || s.about || kind, 22)}</text>
                    {s.place && <><path d={PIN} transform={`translate(${x0 + 85} 21) scale(.85)`} fill="none" stroke="var(--nw-muted)" strokeWidth={1.6} /><text x={x0 + 94} y={25} className="nwg-sub">{clip(s.place, 18)}</text></>}
                    {s.when && <><rect x={sz.w / 2 - 22 - s.when.length * 6.4} y={10} width={s.when.length * 6.4 + 14} height={19} rx={9.5} fill={c} fillOpacity={0.18} /><text x={sz.w / 2 - 15 - (s.when.length * 6.4) / 2} y={20} className="nwg-pill" fill={c}>{s.when}</text></>}
                    {n > 0 && <><circle cx={sz.w / 2 - 4} cy={-sz.h / 2 + 4} r={12} fill={c} stroke={bg} strokeWidth={3} /><text x={sz.w / 2 - 4} y={-sz.h / 2 + 4.5} className="nwg-badge">{n}</text></>}
                  </> : org ? <>
                    {/* A company or agency: its logo on white, what it is, where, and the faces of the people you know there. */}
                    <rect x={x0 - 5} y={-sz.h / 2 - 5} width={sz.w + 10} height={sz.h + 10} rx={21} className="nwg-halo" />
                    <rect x={x0} y={-sz.h / 2} width={sz.w} height={sz.h} rx={16} fill={card} stroke={c} strokeWidth={1.8} />
                    <rect x={x0 + 12} y={-26} width={52} height={52} rx={12} fill="#ffffff" />
                    {picture(x0 + 14, -24, 48, 10) ?? <text x={x0 + 38} y={1} className="nwg-tile big" fill={c}>{s.name[0]?.toUpperCase()}</text>}
                    <text x={x0 + 76} y={-12} className="nwg-sname">{clip(s.name, 20)}</text>
                    <text x={x0 + 76} y={5} className="nwg-kind">{clip(via || kind, 24)}</text>
                    {s.place && <><path d={PIN} transform={`translate(${x0 + 81} 21) scale(.85)`} fill="none" stroke="var(--nw-muted)" strokeWidth={1.6} /><text x={x0 + 90} y={25} className="nwg-sub">{clip(s.place, 14)}</text></>}
                    {faces.map((f, k) => { const cx = sz.w / 2 - 22 - (faces.length - 1 - k) * 20; return (
                      <g key={f.id}><circle cx={cx} cy={-14} r={13} fill={colors.person.get(f.id) ?? c} fillOpacity={0.25} stroke={card} strokeWidth={2.5} />
                        {f.photoId ? <><clipPath id={`nwg-face-${s.id}-${k}`}><circle cx={cx} cy={-14} r={11.5} /></clipPath><image href={imageUrl(f.photoId)} x={cx - 11.5} y={-25.5} width={23} height={23} clipPath={`url(#nwg-face-${s.id}-${k})`} preserveAspectRatio="xMidYMid slice" /></>
                          : <text x={cx} y={-13.5} className="nwg-face" fill={colors.person.get(f.id) ?? c}>{initials(f.name)}</text>}</g>); })}
                    {n > 0 && <><rect x={sz.w / 2 - 92} y={8} width={80} height={21} rx={10.5} className="nwg-pplpill" /><text x={sz.w / 2 - 52} y={19} className="nwg-pill">{n} {n === 1 ? "person" : "people"} ›</text></>}
                  </> : <>
                    <rect x={x0 - 5} y={-sz.h / 2 - 5} width={sz.w + 10} height={sz.h + 10} rx={19} className="nwg-halo" />
                    <rect x={x0} y={-sz.h / 2} width={sz.w} height={sz.h} rx={14} fill={card} stroke={c} strokeWidth={1.8} />
                    <rect x={x0 + 14} y={-22} width={44} height={44} rx={11} fill={c} fillOpacity={0.16} stroke={c} strokeWidth={1.5} />
                    {picture(x0 + 15, -21, 42, 10) ?? (s.type === "family" ? <path d={HOUSE} transform={`translate(${x0 + 36} 0) scale(1.7)`} fill="none" stroke={c} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" /> : <text x={x0 + 36} y={1} className="nwg-tile" fill={c}>{s.name[0]?.toUpperCase()}</text>)}
                    <text x={x0 + 72} y={-3} className="nwg-sname">{clip(s.name, 26)}</text>
                    <text x={x0 + 72} y={16} className="nwg-sub">{clip(via || s.about || kind, 30)}</text>
                    {n > 0 && <><circle cx={sz.w / 2 - 4} cy={-sz.h / 2 + 4} r={12} fill={c} stroke={bg} strokeWidth={3} /><text x={sz.w / 2 - 4} y={-sz.h / 2 + 4.5} className="nwg-badge">{n}</text></>}
                  </>}
                </g>
              );
            })}
            {stacks.map((stack) => {
              const color = colors.source.get(stack.id) || PALETTE[0];
              const expand = () => setExpandedStacks((old) => new Set(old).add(stack.id));
              return <g key={`stack-${stack.id}`} className="nwg-stack" style={{ opacity: lit && !stack.members.some((member) => lit.has(member.id)) ? 0.16 : 1 }} transform={`translate(${stack.x} ${stack.y})`} role="button" tabIndex={0} aria-label={`Expand ${stack.name} stack: ${stack.members.length} people`}
                onPointerDown={(e) => e.stopPropagation()} onClick={expand} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } }}>
                <rect x={-98} y={-24} width={196} height={58} rx={12} fill={card} stroke={color} opacity={0.35} transform="rotate(-4) translate(-3 5)" />
                <rect x={-98} y={-24} width={196} height={58} rx={12} fill={card} stroke={color} opacity={0.65} transform="rotate(3) translate(3 2)" />
                <rect x={-98} y={-24} width={196} height={58} rx={12} fill={card} stroke={color} strokeWidth={1.6} />
                {stack.members.slice(0, 3).map((person, index) => <g key={person.id}><circle cx={-72 + index * 19} cy={4} r={15} fill={card} stroke={colors.person.get(person.id) || color} strokeWidth={1.5} /><text x={-72 + index * 19} y={5} className="nwg-stack-initials">{initials(person.name)}</text></g>)}
                <text x={0} y={0} className="nwg-pname">{stack.members.length} people</text><text x={0} y={17} className="nwg-sub">Click to expand</text>
              </g>;
            })}
            {shownPeople.map((p) => {
              const pt = pos(p.id), c = colors.person.get(p.id) ?? "#8a919c", dim = lit && !lit.has(p.id), ax = -PERSON.w / 2 + 28;
              const due = followUp(p.nextFollowUp)?.due, replied = p.history.length > 0 && p.history[p.history.length - 1].type === "reply";
              const lineage = p.via && p.sourceId ? colors.source.get(p.sourceId) : undefined;
              const family = p.sourceId ? data.sources.find((s) => s.id === p.sourceId)?.type === "family" : false;
              return (
                <g key={p.id} data-node={p.id} className={`nwg-node${p.id === selected ? " sel" : ""}${multi.has(p.id) ? " msel" : ""}`} transform={`translate(${pt.x} ${pt.y})`} style={{ opacity: dim ? 0.16 : 1 }} tabIndex={0} role="button" aria-label={`${p.name}${p.role ? `, ${p.role}` : ""}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPerson(p.id); } }} onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}>
                  <rect x={-PERSON.w / 2 - 5} y={-PERSON.h / 2 - 5} width={PERSON.w + 10} height={PERSON.h + 10} rx={17} className="nwg-halo" />
                  <rect x={-PERSON.w / 2} y={-PERSON.h / 2} width={PERSON.w} height={PERSON.h} rx={13} fill={card} stroke={c} strokeWidth={p.id === selected ? 3 : 1.6} />
                  <circle cx={ax} r={19} fill={c} fillOpacity={0.15} stroke={c} strokeWidth={1.8} />
                  {p.photoId ? <><clipPath id={`nwph-${p.id}`}><circle cx={ax} r={17.5} /></clipPath><image href={imageUrl(p.photoId)} x={ax - 17.5} y={-17.5} width={35} height={35} clipPath={`url(#nwph-${p.id})`} preserveAspectRatio="xMidYMid slice" /></>
                    : <text x={ax} y={1} className="nwg-ini" fill={c}>{initials(p.name)}</text>}
                  {(due || replied) && <circle cx={ax + 14} cy={14} r={6} fill={due ? "var(--nw-warn)" : "var(--nw-ok)"} stroke={card} strokeWidth={2.5}><title>{due ? "Follow-up due" : "They replied"}</title></circle>}
                  {lineage && <circle cx={PERSON.w / 2 - 2} cy={-PERSON.h / 2 + 2} r={7} fill={lineage} stroke={bg} strokeWidth={2.5}><title>Met through {data.sources.find((s) => s.id === p.sourceId)?.name}, introduced by {people.get(p.via!)?.name}</title></circle>}
                  {/* Family: a small house tag on the card's bottom-left corner. */}
                  {family && <g transform={`translate(${-PERSON.w / 2 + 4} ${PERSON.h / 2 - 4})`}><title>Family</title><circle r={10} fill={c} stroke={bg} strokeWidth={2.5} /><path d={HOUSE} transform="translate(0 0.4) scale(0.95)" fill="none" stroke={card} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" /></g>}
                  <text x={ax + 30} y={p.role || p.company ? -3 : 5} className="nwg-pname">{clip(p.name, 20)}</text>
                  {(p.role || p.company) && <text x={ax + 30} y={13} className="nwg-sub"><title>{[p.role, p.company].filter(Boolean).join(" · ")}</title>{clip(p.company || p.role, 22)}</text>}
                </g>
              );
            })}
            {works.map((wk) => {
              const pr = workProgress(wk), c = wk.done ? "var(--nw-ok)" : pr.late ? "var(--nw-bad)" : pr.ending ? "var(--nw-warn)" : "var(--nw-accent)";
              const fmt = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
              const dim = lit && !(wk.people ?? []).some((id) => lit.has(id)) && selectedWork !== wk.id;
              return (
                <g key={wk.id} data-work={wk.id} className={`nwg-node nwg-work${selectedWork === wk.id ? " sel" : ""}`} transform={`translate(${wk.x} ${wk.y})`} style={{ opacity: dim ? 0.2 : 1 }} tabIndex={0} role="button" aria-label={`${wk.title}, ${fmt(wk.start)} to ${fmt(wk.end)}`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onWork(wk.id); } }}>
                  <rect x={-WORK.w / 2 - 5} y={-WORK.h / 2 - 5} width={WORK.w + 10} height={WORK.h + 10} rx={16} className="nwg-halo" />
                  <rect x={-WORK.w / 2} y={-WORK.h / 2} width={WORK.w} height={WORK.h} rx={12} fill={card} stroke={c} strokeWidth={selectedWork === wk.id ? 3 : 1.8} />
                  <text x={-WORK.w / 2 + 12} y={-7} className="nwg-wtitle">{clip(wk.title ?? "", 21)}</text>
                  <text x={-WORK.w / 2 + 12} y={9} className="nwg-sub">{wk.done ? "done" : `${fmt(wk.start)} – ${fmt(wk.end)}`}</text>
                  <rect x={-WORK.w / 2 + 12} y={17} width={WORK.w - 24} height={3.5} rx={1.75} fill="var(--nw-line-strong)" />
                  <rect x={-WORK.w / 2 + 12} y={17} width={(WORK.w - 24) * (wk.done ? 1 : pr.f)} height={3.5} rx={1.75} fill={c} />
                </g>
              );
            })}
          </g>
          <g>
            {board.filter((it) => layers.board && (it.kind === "text" || it.kind === "note")).map((it) => { const p = at(it); return (
              <BoardBox key={it.id} item={it} x={p.x} y={p.y} selected={picked === it.id} pinnedTo={pinName(it)}
                onText={(text) => { replace({ ...it, text }); void saveItem({ id: it.id, text }); }}
                onColor={(color) => { replace({ ...it, color }); void saveItem({ id: it.id, color }); }}
                onRemove={() => void remove(it.id)} />); })}
          </g>
        </g>
      </svg>
      <Toolbar tool={tool} setTool={(next) => { if (['text', 'note', 'pen', 'eraser'].includes(next)) onRevealLayer('board'); if (next === 'work') onRevealLayer('work'); setTool(next); }} onImage={() => { onRevealLayer('board'); fileInput.current?.click(); }} onUndo={undo} canUndo={added.length > 0} onPath={() => setPathOpen((o) => !o)} pathOpen={pathOpen} />
      {marquee && <div className="nwg-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      {pathOpen && <PathFinder data={data} to={pathTo} setTo={setPathTo} route={route} colors={colors} onClose={() => { setPathOpen(false); setPathTo(""); }} onOpen={onPerson} />}
      {multi.size > 0 && <BulkBar ids={[...multi]} people={people} onDone={(list, msg) => { onPeople(list); say({ text: msg }); }} say={say}
        onGroup={() => { const ids = [...multi]; void create({ kind: "group", ids, label: "Group" }).then((it) => { if (it) { setMulti(new Set()); say({ text: "Grouped. Click the label to rename it. The frame follows them when you move them." }); } }); }}
        onWrite={() => onBulkMail([...multi])} onClear={() => setMulti(new Set())} />}
      {groupEdit && (() => { const gr = board.find((b) => b.id === groupEdit.id); return gr ? <GroupEditor key={gr.id} group={gr} at={groupEdit.at} onClose={() => setGroupEdit(null)}
        onRename={(label) => { replace({ ...gr, label }); void saveItem({ id: gr.id, label }); }} onRemove={() => { void remove(gr.id); setGroupEdit(null); }} /> : null; })()}
      {(tool === "pen" || tool === "eraser") && <PenBar pen={pen} setPen={setPen} eraser={tool === "eraser"} />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addImage(f); }} />
      <div className="nwg-ui nwg-zoom"><button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button><span>{Math.round(view.k * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button><button type="button" className="txt" onClick={fit}>Fit</button></div>
      {stackPeople && expandedStacks.size > 0 && <button type="button" className="nwg-ui nwg-restack" onClick={() => setExpandedStacks(new Set())}>Collapse stacks</button>}
      <div className="nwg-ui nwg-legend" aria-hidden="true" hidden={multi.size > 0 || !layers.connections}>
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

/** "Who do you want to reach?": the fewest steps from you along your lines, lit on the map, with the first person to write to. */
function PathFinder({ data, to, setTo, route, colors, onClose, onOpen }: { data: NetworkData; to: string; setTo: (v: string) => void; route: ReturnType<typeof warmPath>; colors: Colors; onClose: () => void; onOpen: (id: string) => void }) {
  const first = route?.nodes.map((id) => data.people.find((p) => p.id === id)).find(Boolean);
  const dot = (id: string) => (id === "you" ? "var(--nw-accent)" : colors.person.get(id) ?? colors.source.get(id) ?? "var(--nw-muted)");
  return (
    <div className="nwg-ui nwg-path" role="region" aria-label="Find a path">
      <div className="nwg-rel-h"><b>Who do you want to reach?</b><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
      <select id="nwg-path-to" value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
        <option value="">Choose a person or a source…</option>
        <optgroup label="Sources">{data.sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s, data.sources, data.people)}</option>)}</optgroup>
        <optgroup label="People">{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      </select>
      {to && !route && <p className="nw-muted">No way there yet. Add who knows them, or connect someone you know to them.</p>}
      {route && <>
        <div className="nwg-steps">{route.nodes.map((id, i) => <span key={id} className="nwg-step">{i > 0 && <em>{route.edges[i - 1].label} →</em>}<span><i style={{ background: dot(id) }} />{name(data, id)}</span></span>)}</div>
        <p className="nwg-path-say">{route.edges.length === 1 ? "You are already linked to them." : `${route.edges.length} steps.${first ? ` Start with ${first.name}.` : ""}`}</p>
        {first && route.edges.length > 1 && <button type="button" className="nw-btn" onClick={() => onOpen(first.id)}>Open {first.name.split(" ")[0]}</button>}
      </>}
    </div>
  );
}

/** Actions for several picked people at once. Each email still goes out on its own Send. */
function BulkBar({ ids, people, onDone, onGroup, onWrite, onClear, say }: { ids: string[]; people: Map<string, Person>; onDone: (list: Person[], msg: string) => void; onGroup: () => void; onWrite: () => void; onClear: () => void; say: (t: { text: string } | null) => void }) {
  const [busy, setBusy] = useState(false);
  async function each(fields: (p: Person) => Partial<Person>, msg: string) {
    setBusy(true);
    try { const out: Person[] = []; for (const id of ids) { const p = people.get(id); if (!p) continue; out.push((await post<{ person: Person }>("person", { id, ...fields(p) })).person); } onDone(out, msg); }
    catch (e) { say({ text: String((e as Error).message) }); } finally { setBusy(false); }
  }
  const random = () => `#${[0, 0, 0].map(() => Math.floor(80 + Math.random() * 160).toString(16).padStart(2, "0")).join("")}`;
  return (
    <div className="nwg-ui nwg-bulk" role="toolbar" aria-label={`${ids.length} selected`}>
      <b>{ids.length} selected</b>
      <select id="nwg-bulk-follow" aria-label="Set a follow-up for all" value="" disabled={busy} onChange={(e) => { const n = Number(e.target.value); if (n) void each(() => ({ nextFollowUp: plusDays(n) }), `Follow-up set for ${ids.length} ${ids.length === 1 ? "person" : "people"}.`); }}>
        <option value="">Follow up…</option><option value="3">In 3 days</option><option value="7">In a week</option><option value="14">In 2 weeks</option>
      </select>
      <span className="dots">{PALETTE.slice(0, 6).map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Colour them ${c}`} disabled={busy} onClick={() => void each(() => ({ color: c }), "Colour changed.")} />)}</span>
      <button type="button" className="nw-btn" disabled={busy} onClick={() => void each(() => ({ color: random() }), "Each one has a new colour.")}>Random</button>
      <button type="button" className="nw-btn" disabled={busy} onClick={onGroup}>Group</button>
      <button type="button" className="nw-btn main" disabled={busy} onClick={onWrite}>Write to all</button>
      <button type="button" className="nw-x" aria-label="Clear the selection" onClick={onClear}>×</button>
    </div>
  );
}

function GroupEditor({ group, at, onClose, onRename, onRemove }: { group: BoardItem; at: Point; onClose: () => void; onRename: (label: string) => void; onRemove: () => void }) {
  const [label, setLabel] = useState(group.label ?? "");
  return (
    <div className="nwg-ui nwg-rel" role="dialog" aria-label="Group" style={{ left: Math.max(10, at.x + 10), top: Math.max(10, at.y + 10) }}>
      <div className="nwg-rel-h"><b>Group</b><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
      <label className="nw-f"><span>Name</span><input id="nwg-group-label" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRename(label); onClose(); } }} /></label>
      <div className="nw-df"><button type="button" className="nw-btn ghost" onClick={onRemove}>Remove the frame</button><span className="grow" /><button type="button" className="nw-btn main" onClick={() => { onRename(label); onClose(); }}>Save</button></div>
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
