import { fetchJson, getJson, type ApiBody } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

// The Network page's data: people, the sources they come from (a company, an event, family), and the links between them.

export type SourceType = "company" | "staffing" | "event" | "oa" | "linkedin" | "day" | "family" | "other";
export type LinkKind = "works" | "family" | "intro" | "other";
export type HistoryType = "note" | "email" | "message" | "call" | "met" | "reply";
export type FollowUpPlatform = "linkedin" | "email" | "whatsapp" | "phone" | "in-person" | "other";
export interface FollowUpPlan { enabled: boolean; platform: FollowUpPlatform; regarding: string; nextNotes: string }
export const FOLLOW_UP_PLATFORMS: [FollowUpPlatform, string][] = [["linkedin", "LinkedIn"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["phone", "Phone"], ["in-person", "In person"], ["other", "Other"]];
export interface HistoryEntry { followUp?: { completed: boolean; platform: FollowUpPlatform; regarding: string; nextNotes: string; nextFollowUp: string | null }; id: string; at: string; type: HistoryType; text: string }
export interface Person {
  id: string; name: string; role: string; city: string; company: string; photoId: string | null; watchJobs: boolean; email: string; linkedin: string; phone: string; notes: string;
  sourceId: string | null; via: string | null; alsoVia?: string[]; color: string | null; tags: string[];
  followUpPlan?: FollowUpPlan; followUpAuto?: boolean; lastContact: string | null; nextFollowUp: string | null; history: HistoryEntry[]; archived: boolean; createdAt: string; updatedAt: string; x?: number; y?: number;
}
export interface Source { parentSourceId?: string | null; viaPersonId?: string | null; context?: string; photoId?: string | null; notes?: string; place?: string; when?: string; kindName?: string; auto?: string[]; introYear?: string; alsoVia?: { id: string; year: string }[]; id: string; name: string; type: SourceType; about: string; color: string | null; createdAt: string; x?: number; y?: number }
export interface Link { id: string; a: string; b: string; kind: LinkKind; label: string; color: string | null }
export interface You { x: number; y: number; name?: string; title?: string; photoId?: string | null; note?: string }
export interface NetworkData { people: Person[]; sources: Source[]; links: Link[]; you?: You; map?: { id: string; name: string }; onMap?: string[] }
export interface MapInfo { id: string; name: string; people: number; thumbId: string | null; updatedAt: string | null; main: boolean }
export interface ListRow { name: string; city: string; repeat: boolean; exists: boolean }

/** "NKHS · via Chani Jain", "Randstad · met at the conference · via All Things Open": the name plus how it came to you. */
export function sourceLabel(source: Source, sources: Source[], people: { id: string; name: string }[] = []): string {
  const parent = source.parentSourceId ? sources.find((s) => s.id === source.parentSourceId) : null;
  const person = source.viaPersonId ? people.find((p) => p.id === source.viaPersonId) : null;
  return [source.name, source.context, parent ? `via ${parent.name}` : person ? `via ${person.name}` : null].filter(Boolean).join(' · ');
}

export const SOURCE_TYPES: [SourceType, string][] = [["company", "Company"], ["staffing", "Staffing agency"], ["event", "Event"], ["oa", "Online assessment (OA)"], ["linkedin", "LinkedIn reach-out"], ["day", "Day"], ["family", "Family"], ["other", "Other"]];
/** What a source is called on its card: the name you typed for "Something else…", else its kind. */
export const kindLabel = (s: Pick<Source, "type" | "kindName">) => s.kindName || SOURCE_TYPES.find(([t]) => t === s.type)?.[1] || s.type;
export const LINK_KINDS: [LinkKind, string][] = [["works", "Works with"], ["family", "Family"], ["intro", "Introduced"], ["other", "Other"]];
export const HISTORY_TYPES: [HistoryType, string][] = [["note", "Note"], ["email", "Email"], ["message", "Message"], ["call", "Call"], ["met", "Met"], ["reply", "They replied"]];

// The map that is open ("main" is My network). Every request carries it, so what you add or draw lands on that map.
let activeMap = "main";
export const setActiveMap = (id: string) => { activeMap = id || "main"; };
const onMap = () => (activeMap === "main" ? "" : `map=${encodeURIComponent(activeMap)}`);
export const loadNetwork = (archived = false) => getJson<NetworkData & ApiBody>(`/network?${[onMap(), archived ? "archived=1" : ""].filter(Boolean).join("&")}`);
/** Everyone and every source, whichever map is open (the "From your network" picker). */
export const loadWholeNetwork = () => getJson<NetworkData & ApiBody>("/network");
export const loadMaps = () => getJson<{ maps: MapInfo[] } & ApiBody>("/network/maps").then((r) => r.maps);
export async function post<T>(path: string, body: object): Promise<T> {
  const payload = activeMap === "main" || "mapId" in body ? body : { mapId: activeMap, ...body };
  const { res, json } = await fetchJson<ApiBody & T>(`${getTailorServerBase()}/network/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Twelve colours that read on the dark console. */
export const PALETTE = ["#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#a78bfa", "#fb923c", "#22d3ee", "#f87171", "#a3e635", "#e879f9", "#2dd4bf", "#818cf8"];
const NEUTRAL = "#8a919c";
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: string, b: string) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/**
 * Colour follows where someone came from: a source keeps one colour (its own, or the next free one in order of creation), and every
 * first connection from it shares that colour. Someone introduced by another person starts their own branch: a colour of their own,
 * never one a source already uses. Anything you pick yourself wins.
 */
export function colorsFor(data: NetworkData): { source: Map<string, string>; person: Map<string, string> } {
  const source = new Map<string, string>();
  const ordered = [...data.sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const taken = new Set(ordered.map((s) => s.color).filter(Boolean) as string[]);
  let i = 0;
  for (const s of ordered) {
    if (s.auto) { source.set(s.id, NEUTRAL); continue; }
    if (s.color) { source.set(s.id, s.color); continue; }
    let c = PALETTE[i++ % PALETTE.length];
    for (let k = 0; k < PALETTE.length && taken.has(c); k++) c = PALETTE[i++ % PALETTE.length];
    taken.add(c); source.set(s.id, c);
  }
  // An introduced person's colour must not be mistaken for a source's, so close hues (pink and magenta, amber and orange) are left out too.
  const used = [...new Set(ordered.filter((s) => !s.auto).map((s) => source.get(s.id)!))], own = PALETTE.filter((c) => used.every((u) => hueGap(c, u) > 40));
  const person = new Map<string, string>();
  for (const p of data.people) {
    if (p.color) person.set(p.id, p.color);
    else if (p.via) person.set(p.id, (own.length ? own : PALETTE)[hash(p.id) % (own.length || PALETTE.length)]);
    else person.set(p.id, (p.sourceId && source.get(p.sourceId)) || NEUTRAL);
  }
  return { source, person };
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const DAY = 86_400_000;
const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
const dayOf = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };

/** "today", "3 days ago", "2 weeks ago", "4 months ago", or "never". */
export function ago(iso: string | null): string {
  if (!iso) return "never";
  const d = Math.round((today() - dayOf(new Date(iso).toLocaleDateString("en-CA"))) / DAY);
  if (d <= 0) return "today"; if (d === 1) return "yesterday"; if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`; return `${Math.round(d / 30)} months ago`;
}
/** Follow-up wording and whether it is due: "today", "in 3 days", "2 days late". */
export function followUp(day: string | null): { text: string; due: boolean } | null {
  if (!day) return null;
  const d = Math.round((dayOf(day) - today()) / DAY);
  return d === 0 ? { text: "today", due: true } : d < 0 ? { text: `${-d} day${d === -1 ? "" : "s"} late`, due: true } : { text: d === 1 ? "tomorrow" : `in ${d} days`, due: false };
}
export const plusDays = (n: number) => { const d = new Date(today() + n * DAY); return d.toISOString().slice(0, 10); };

/* ---------- the graph: where cards sit, and the lines between them ---------- */
export type Point = { x: number; y: number };
const ring = (cx: number, cy: number, r: number, a: number): Point => ({ x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r) });

/**
 * Positions for every card. Saved positions win; anything new is placed by rule: sources on a ring around you, first connections fanned out
 * around their source (facing away from you), introduced people next to whoever introduced them, people with no source near you.
 */
export function autoLayout(data: NetworkData): Map<string, Point> {
  const pos = new Map<string, Point>();
  const you = data.you ?? { x: 0, y: 0 };
  pos.set("you", { x: you.x, y: you.y });
  const sources = data.sources.filter((s) => !s.auto).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const sourceIds = new Set(sources.map((s) => s.id)), personIds = new Set(data.people.map((p) => p.id));
  // A source arrives through a parent source, through a person (placed next to them once they have a place), or straight from you.
  const throughPerson = (s: Source) => Boolean(s.viaPersonId && personIds.has(s.viaPersonId));
  const roots = sources.filter((s) => (!s.parentSourceId || !sourceIds.has(s.parentSourceId)) && !throughPerson(s));
  roots.forEach((s, i) => pos.set(s.id, s.x != null && s.y != null ? { x: s.x, y: s.y } : ring(you.x, you.y, 460 + (roots.length > 6 ? 120 : 0), (i / Math.max(1, roots.length)) * Math.PI * 2 - Math.PI / 2)));
  for (const s of sources) if (s.x != null && s.y != null) pos.set(s.id, { x: s.x, y: s.y });
  for (const p of data.people) if (p.x != null && p.y != null) pos.set(p.id, { x: p.x, y: p.y });
  const bySource = new Map<string | null, Person[]>(), byVia = new Map<string, Person[]>();
  for (const p of data.people) {
    if (pos.has(p.id)) continue;
    if (p.via && personIds.has(p.via)) byVia.set(p.via, [...(byVia.get(p.via) ?? []), p]);
    else bySource.set(p.sourceId && sourceIds.has(p.sourceId) ? p.sourceId : null, [...(bySource.get(p.sourceId && sourceIds.has(p.sourceId) ? p.sourceId : null) ?? []), p]);
  }
  const away = (c: Point) => Math.atan2(c.y - you.y, c.x - you.x);
  const done = new Set<string | null>();
  // Each pass places whatever now has something to hang from; a chain (you, Kasliwal, Chani, NKHS, its people) takes a few passes.
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (const parent of sources) {
      const c = pos.get(parent.id); if (!c) continue;
      const kids = sources.filter((s) => s.parentSourceId === parent.id && !pos.has(s.id));
      if (kids.length) { placeGroup(kids.map((s) => s.id), c, away(c) + Math.PI / 3, 380, pos); moved = true; }
    }
    for (const person of data.people) {
      const c = pos.get(person.id); if (!c) continue;
      const kids = sources.filter((s) => s.viaPersonId === person.id && throughPerson(s) && !pos.has(s.id));
      if (kids.length) { placeGroup(kids.map((s) => s.id), c, away(c) - Math.PI / 5, 300, pos); moved = true; }
    }
    for (const [sid, list] of bySource) {
      if (done.has(sid)) continue;
      const c = sid ? pos.get(sid) : you; if (!c) continue;
      placeGroup(list.map((p) => p.id), c, sid ? away(c) : -Math.PI / 2, sid ? 250 : 300, pos); done.add(sid); moved = true;
    }
    for (const [via, kids] of byVia) {
      const c = pos.get(via); if (!c || kids.every((k) => pos.has(k.id))) continue;
      kids.forEach((p, i) => pos.set(p.id, ring(c.x, c.y, 210, away(c) + (i - (kids.length - 1) / 2) * 0.55))); moved = true;
    }
    if (!moved) break;
  }
  for (const [index, source] of sources.entries()) if (!pos.has(source.id)) pos.set(source.id, ring(you.x, you.y, 460, index * 2.4));
  for (const p of data.people) if (!pos.has(p.id)) pos.set(p.id, ring(you.x, you.y, 300, Math.random() * Math.PI * 2));
  // A suggested company sits next to an actual person, even when its people are far apart.
  for (const s of data.sources) {
    if (!s.auto || pos.has(s.id)) continue;
    const pts = s.auto.map((id) => pos.get(id)).filter((p): p is Point => Boolean(p)), c = { x: pts.reduce((n, p) => n + p.x, 0) / (pts.length || 1), y: pts.reduce((n, p) => n + p.y, 0) / (pts.length || 1) };
    const anchor = pts.reduce((best, p) => Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best, pts[0] ?? c);
    pos.set(s.id, ring(anchor.x, anchor.y, 320, away(anchor)));
  }
  return pos;
}

const CARD_W = 196, CARD_H = 52, GAP_X = 24, GAP_Y = 18;
/**
 * Everything that hangs off a card on the map, all the way down: a source's people, the sources under it (LinkedIn's days) and theirs;
 * a person's introductions (people and sources). Dragging a card brings its branch along.
 */
export function branchOf(id: string, data: Pick<NetworkData, "people" | "sources">): string[] {
  const personIds = new Set(data.people.map((p) => p.id)), out = new Set<string>(), queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const kids = [
      ...data.sources.filter((s) => !s.auto && (s.parentSourceId === cur || s.viaPersonId === cur)).map((s) => s.id),
      // Someone introduced by a person hangs off that person; everyone else off their source.
      ...data.people.filter((p) => (p.via && personIds.has(p.via) ? p.via === cur : p.sourceId === cur)).map((p) => p.id),
    ];
    for (const k of kids) if (k !== id && !out.has(k)) { out.add(k); queue.push(k); }
  }
  return [...out];
}

/**
 * Up to eight cards fan out on an arc facing away from you, the arc growing until neighbours clear each other; a bigger group (a pasted
 * list of forty recruiters) becomes a tidy block of rows behind its source instead.
 */
export function placeGroup(ids: string[], c: Point, out: number, r0: number, pos: Map<string, Point>) {
  const n = ids.length;
  if (!n) return;
  if (n <= 8) {
    let r = r0, step = 0;
    for (;;) {
      // Cards are wide: the chord between neighbours must clear a card's width when the arc runs sideways, its height when it runs up/down.
      const need = Math.abs(Math.sin(out)) * (CARD_W + GAP_X) + Math.abs(Math.cos(out)) * (CARD_H + GAP_Y) + 40;
      step = n === 1 ? 0 : 2 * Math.asin(Math.min(1, need / (2 * r)));
      if (step * (n - 1) <= Math.PI * 1.2 || r > 2000) break;
      r += 60;
    }
    ids.forEach((id, i) => pos.set(id, ring(c.x, c.y, r, out + (i - (n - 1) / 2) * step)));
    return;
  }
  const cols = Math.min(6, Math.ceil(Math.sqrt(n * 1.6))), rows = Math.ceil(n / cols);
  const ux = Math.cos(out), uy = Math.sin(out), start = r0 * 0.75 + CARD_H;
  // Rows run across the direction away from you; when that direction is mostly sideways, columns step away from you instead.
  const sideways = Math.abs(ux) > Math.abs(uy);
  ids.forEach((id, i) => {
    const row = Math.floor(i / cols), col = i % cols, inRow = row === rows - 1 ? n - row * cols : cols;
    const x = sideways ? c.x + Math.sign(ux) * (start + col * (CARD_W + GAP_X)) : c.x + (col - (inRow - 1) / 2) * (CARD_W + GAP_X);
    const y = sideways ? c.y + (row - (rows - 1) / 2) * (CARD_H + GAP_Y) : c.y + Math.sign(uy) * (start + row * (CARD_H + GAP_Y + 10));
    pos.set(id, { x: Math.round(x), y: Math.round(y) });
  });
}

export interface Edge { key: string; a: string; b: string; kind: "belongs" | "via" | "you" | "employer" | LinkKind; label: string; color: string; link?: Link }

/** The lines: you to each source, each source to its first connections, each introducer to who they introduced, then your own links. */
export function edgesFor(data: NetworkData, colors: ReturnType<typeof colorsFor>): Edge[] {
  const out: Edge[] = [];
  const typeName = (t: SourceType) => SOURCE_TYPES.find(([k]) => k === t)?.[1].toLowerCase() ?? "";
  for (const s of data.sources) {
    if (s.auto) continue; // hangs off its people only, through their "works at" lines
    const parent = s.parentSourceId && data.sources.some((source) => source.id === s.parentSourceId && source.id !== s.id) ? s.parentSourceId : null;
    const person = !parent && s.viaPersonId && data.people.some((p) => p.id === s.viaPersonId) ? s.viaPersonId : null;
    const yr = s.introYear ? ` · ${s.introYear}` : "";
    out.push({ key: `source-${s.id}`, a: parent || person || "you", b: s.id, kind: parent || person ? (person ? "via" : "intro") : "you", label: parent ? `introduced through${yr}` : person ? `introduced${yr}` : typeName(s.type), color: colors.source.get(s.id) ?? NEUTRAL });
    // Whoever (or wherever) else also brought it to you, later or another way: Red Hat through your uncle in 2024, All Things Open in 2026.
    for (const v of s.alsoVia ?? []) {
      const isPerson = data.people.some((p) => p.id === v.id);
      if (v.id === s.id || (!isPerson && !data.sources.some((x) => x.id === v.id))) continue;
      out.push({ key: `also-${s.id}-${v.id}`, a: v.id, b: s.id, kind: isPerson ? "via" : "intro", label: `also introduced${v.year ? ` · ${v.year}` : ""}`, color: colors.source.get(s.id) ?? NEUTRAL });
    }
  }
  const ids = new Set(data.people.map((p) => p.id));
  for (const p of data.people) {
    const c = colors.person.get(p.id) ?? NEUTRAL;
    if (p.via && ids.has(p.via)) out.push({ key: `via-${p.id}`, a: p.via, b: p.id, kind: "via", label: "introduced", color: c });
    else if (p.sourceId && data.sources.some((s) => s.id === p.sourceId)) out.push({ key: `src-${p.id}`, a: p.sourceId, b: p.id, kind: "belongs", label: "first connection", color: colors.source.get(p.sourceId) ?? c });
    else out.push({ key: `you-${p.id}`, a: "you", b: p.id, kind: "you", label: "you know them", color: c });
    // Where they work, when that company is on your map and is not where you met them: a faint "works at" line (colour and place stay with where you met).
    if (p.company) { const employer = data.sources.find((s) => (s.type === "company" || s.type === "staffing") && s.id !== p.sourceId && sameCompany(s.name, p.company)); if (employer) out.push({ key: `works-${p.id}`, a: employer.id, b: p.id, kind: "employer", label: "works at", color: colors.source.get(employer.id) ?? NEUTRAL }); }
    // Everyone else who also introduced them gets a line too.
    for (const other of p.alsoVia ?? []) if (other !== p.via && ids.has(other)) out.push({ key: `via-${p.id}-${other}`, a: other, b: p.id, kind: "via", label: "also introduced", color: c });
  }
  const known = new Set([...ids, ...data.sources.map((s) => s.id)]);
  for (const l of data.links) {
    if (!known.has(l.a) || !known.has(l.b)) continue;
    out.push({ key: `link-${l.id}`, a: l.a, b: l.b, kind: l.kind, label: l.label || LINK_KINDS.find(([k]) => k === l.kind)?.[1] || "", color: l.color ?? colors.person.get(l.a) ?? colors.source.get(l.a) ?? NEUTRAL, link: l });
  }
  return out;
}

/* ---------- email ---------- */
export interface MailSettings { fromName: string; fromEmail: string; about: string; signature: string; connected: boolean; resumes: { track: string; label: string }[] }
export const loadMailSettings = () => getJson<{ settings: MailSettings } & ApiBody>("/network/mail").then((r) => r.settings);
export const loadDraft = (id: string) => getJson<{ status: "writing" | "done" | "failed"; subject: string; body: string; error: string } & ApiBody>(`/network/mail/draft?id=${encodeURIComponent(id)}`);

/** A plain starting point when the AI worker is not available: greeting, one line for the reason, signature. */
export function starter(p: Person, tone: string, intent: string, signature: string): { subject: string; body: string } {
  const first = p.name.split(/\s+/)[0] || "there";
  const why = intent.trim() || "I'm looking for my next role and wanted to stay in touch";
  const sign = signature.trim() || "";
  if (tone === "formal") return { subject: "Following up", body: `Dear ${first},\n\nThank you for your time. ${why.replace(/^\w/, (c) => c.toUpperCase())}. I would be glad to talk whenever it suits you.\n\nKind regards,\n${sign}` };
  if (tone === "short") return { subject: "Quick hello", body: `Hi ${first},\n\n${why.replace(/^\w/, (c) => c.toUpperCase())}. Would you have ten minutes this week?\n\nThanks,\n${sign}` };
  return { subject: "Checking in", body: `Hi ${first},\n\nHope you're doing well. ${why.replace(/^\w/, (c) => c.toUpperCase())}. Is there anything you'd suggest, or someone I should talk to?\n\nThanks so much,\n${sign}` };
}

/* ---------- reminders ---------- */
export interface Reminder { key: string; kind: "reply" | "due" | "quiet" | "never" | "work"; personId?: string; sourceId?: string; workId?: string; title: string; detail: string }
export const loadReminders = () => getJson<{ reminders: Reminder[] } & ApiBody>("/network/reminders").then((r) => r.reminders);

/* ---------- the board: notes, text, pen strokes, images ---------- */
export interface BoardItem {
  id: string; kind: "text" | "note" | "stroke" | "image" | "group" | "work"; x: number; y: number; w?: number; h?: number; text?: string; color?: string;
  points?: [number, number][]; width?: number; opacity?: number; imageId?: string; pin?: { id: string; dx: number; dy: number } | null; createdAt: string;
  ids?: string[]; label?: string; title?: string; start?: string; end?: string; people?: string[]; next?: string; notes?: string; done?: boolean;
}
export const loadBoard = () => getJson<{ items: BoardItem[] } & ApiBody>(`/network/board?${onMap()}`).then((r) => r.items);
export const imageUrl = (id: string) => `${getTailorServerBase()}/network/image?id=${encodeURIComponent(id)}`;
export type Tool = "select" | "area" | "hand" | "text" | "note" | "pen" | "eraser" | "work";
export type Pen = { color: string; width: number; opacity: number };
export const TOOL_KEYS: Record<string, Tool> = { v: "select", s: "area", h: "hand", t: "text", n: "note", d: "pen", e: "eraser", w: "work" };
export const NOTE_COLORS = ["#fbbf24", "#f9a8d4", "#86efac", "#93c5fd", "#c4b5fd"];
export const PEN_COLORS = ["ink", "#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"];
export const PEN_SIZES: [string, number, number][] = [["Fine", 2.4, 0.9], ["Medium", 4.5, 0.9], ["Thick", 8, 0.9], ["Marker", 18, 0.32]];

/** A smooth path through pen points (quadratic curves through the midpoints). */
export function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return `M${pts.map((p) => p.join(" ")).join("L")}${pts.length === 1 ? `L${pts[0][0] + 0.01} ${pts[0][1]}` : ""}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
  const last = pts[pts.length - 1];
  return `${d}L${last[0]} ${last[1]}`;
}
/** Drop points closer than `min` to the last kept one, so a long stroke stays small. */
export function thinPoints(pts: [number, number][], min = 1.5): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= min) out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]); }
  const end = pts[pts.length - 1];
  if (end && out.length > 1 && out[out.length - 1] !== end) out[out.length - 1] = [Math.round(end[0] * 10) / 10, Math.round(end[1] * 10) / 10];
  return out.slice(0, 4000);
}

/* ---------- work items and the warm path ---------- */
/** How far along a piece of work is: day n of total, days left, and whether it is ending (a week or less) or late. */
export function workProgress(w: BoardItem, today = new Date().toLocaleDateString("en-CA")) {
  const a = dayOf(w.start ?? today), b = dayOf(w.end ?? today), t = dayOf(today), total = Math.max(1, Math.round((b - a) / DAY));
  const day = Math.round((t - a) / DAY), left = Math.round((b - t) / DAY);
  return { day: Math.max(0, Math.min(total, day)), total, left, f: Math.max(0, Math.min(1, day / total)), ending: !w.done && left <= 7 && left >= 0, late: !w.done && left < 0 };
}

/**
 * The warmest way from you to someone: the fewest steps along your lines (through people, sources and events), never through a
 * piece of work. Null when there is no way yet.
 */
export function warmPath(edges: Edge[], to: string): { nodes: string[]; edges: Edge[] } | null {
  if (to === "you") return null;
  const adj = new Map<string, [string, Edge][]>();
  for (const e of edges) { adj.set(e.a, [...(adj.get(e.a) ?? []), [e.b, e]]); adj.set(e.b, [...(adj.get(e.b) ?? []), [e.a, e]]); }
  const prev = new Map<string, [string, Edge] | null>([["you", null]]), queue = ["you"];
  while (queue.length) {
    const u = queue.shift()!;
    if (u === to) break;
    for (const [v, e] of adj.get(u) ?? []) if (!prev.has(v)) { prev.set(v, [u, e]); queue.push(v); }
  }
  if (!prev.has(to)) return null;
  const nodes = [to], path: Edge[] = [];
  for (let c = to, step = prev.get(c); step; c = step[0], step = prev.get(c)) { path.unshift(step[1]); nodes.unshift(step[0]); }
  return { nodes, edges: path };
}

/** A person's photo: the centre square of the picture, 256 px, as JPEG, uploaded once; returns the new image id. */
export async function uploadPhoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Pick a PNG, JPEG, GIF or WebP picture");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That picture could not be opened")); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
    c.width = c.height = 256;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.86));
    if (!blob) throw new Error("That picture could not be resized");
    const base64 = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => bad(new Error("That picture could not be read")); r.readAsDataURL(blob); });
    return (await post<{ id: string }>("photo", { type: "image/jpeg", base64 })).id;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- jobs where you know someone ---------- */
export interface JobRow { url: string; applyUrl: string; company: string; title: string; location: string; foundAt: string | null; site: string; status: "new" | "ready" | "applied" | "passed"; appliedAt: string | null; resumeReady: boolean }
export interface CompanyGroup { company: string; people: { id: string; name: string; watchJobs: boolean }[]; jobs: JobRow[] }
export interface KnownCompany { key: string; name: string; people: { id: string; name: string }[] }
export const loadPersonJobs = (id: string) => getJson<{ company: string; jobs: JobRow[] } & ApiBody>(`/network/jobs?person=${encodeURIComponent(id)}`);
export const loadWarmJobs = () => getJson<{ groups: CompanyGroup[] } & ApiBody>("/network/jobs").then((r) => r.groups);
export const JOB_STATUS: Record<JobRow["status"], string> = { new: "New", ready: "Resume ready", applied: "Applied", passed: "Passed" };

const SUFFIXES = new Set(["incorporated", "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "the"]);
const companyWords = (name: string) => name.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w && !SUFFIXES.has(w));
/** The same company, whole words only ("Randstad" and "Randstad USA" yes, "Randstadt Logistics" no); the server uses the same rule. */
export function sameCompany(a: string, b: string): boolean {
  const x = companyWords(a), y = companyWords(b), [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.join("").length >= 3 && short.every((w, i) => long[i] === w);
}
/** Everyone represented by a source card, counted once even when several links match. */
export function peopleForSource(source: Source, data: NetworkData): Person[] {
  const org = source.type === "company" || source.type === "staffing";
  const linked = new Set(data.links.filter((link) => link.kind === "works" && (link.a === source.id || link.b === source.id)).map((link) => link.a === source.id ? link.b : link.a));
  return data.people.filter((person) => person.sourceId === source.id || source.auto?.includes(person.id)
    || (org && (sameCompany(source.name, person.company || "") || linked.has(person.id))));
}

/** Two letters for organisations, including single-word names such as Fidelity → FI. */
export function organisationInitials(name: string): string {
  const words = name.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]).join("") : [...(words[0] || "")].slice(0, 2).join("")).toUpperCase() || "?";
}

/** Where someone works: their own "works at", else their source when it is a company. */
export const companyOfPerson = (p: Person, sources: Map<string, Source>) => p.company || (p.sourceId && (sources.get(p.sourceId)?.type === "company" || sources.get(p.sourceId)?.type === "staffing") ? sources.get(p.sourceId)!.name : "");

let known: { at: number; list: Promise<KnownCompany[]> } | null = null;
/** Who you know at which company, fetched once every few minutes for the job cards on other pages. */
export function knownCompanies(): Promise<KnownCompany[]> {
  if (!known || Date.now() - known.at > 5 * 60_000) known = { at: Date.now(), list: getJson<{ companies: KnownCompany[] } & ApiBody>("/network/companies").then((r) => r.companies).catch(() => []) };
  return known.list;
}

/** Local canvas visibility; changing these never changes saved people or board items. */
export interface CanvasLayers { people: boolean; sources: boolean; connections: boolean; board: boolean; work: boolean }
export const DEFAULT_CANVAS_LAYERS: CanvasLayers = { people: true, sources: true, connections: true, board: true, work: true };

/** The picker's value ("" | a source id | "p:" + a person id) as the two fields a source is saved with. */
/**
 * Companies on the map that nobody added: when two or more people work at the same place ("Works at") and no company or agency card
 * matches it, a card for it joins the map, linked to each of them by a "works at" line. Nothing is saved; it is worked out every time,
 * so it goes away when one of them moves on or a real card for that company is added.
 */
export function withAutoCompanies(data: NetworkData): NetworkData {
  const groups: { name: string; ids: string[] }[] = [];
  for (const p of data.people) {
    if (!p.company || data.sources.some((s) => (s.type === "company" || s.type === "staffing") && sameCompany(s.name, p.company))) continue;
    const g = groups.find((x) => sameCompany(x.name, p.company));
    if (g) g.ids.push(p.id); else groups.push({ name: p.company.trim(), ids: [p.id] });
  }
  const auto = groups.filter((g) => g.ids.length >= 2).map((g): Source => ({ id: `auto:${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: g.name, type: "company", about: "", color: null, createdAt: "", auto: g.ids }));
  return auto.length ? { ...data, sources: [...data.sources, ...auto] } : data;
}

export const throughFields = (value: string) => (value.startsWith("p:") ? { parentSourceId: null, viaPersonId: value.slice(2) } : { parentSourceId: value || null, viaPersonId: null });
/** And back: a saved source as the picker's value. */
export const throughValue = (s?: Source | null) => (s?.viaPersonId ? `p:${s.viaPersonId}` : s?.parentSourceId ?? "");

/** Everyone who introduced this person, first one first. */
export const introducersOf = (p: Person) => [p.via, ...(p.alsoVia ?? [])].filter((x): x is string => Boolean(x));
export const loadSourceJobs = (id: string) => getJson<{ company: string; jobs: JobRow[] } & ApiBody>(`/network/jobs?source=${encodeURIComponent(id)}`);

export function followUpSummary(person: Person): { title: string; detail: string; due: boolean } {
  const plan = person.followUpPlan;
  if (plan && !plan.enabled) return { title: "Not needed", detail: "Follow-up paused", due: false };
  const when = followUp(person.nextFollowUp);
  // No plan and no date of your own: the weekly follow-up everyone but family gets (3 days first for a LinkedIn reach-out).
  if (!plan && person.followUpAuto && when) return { title: `Follow up ${when.text}`, detail: "Automatic, every week. Switch it off under Follow-up.", due: when.due };
  return { title: when ? `Follow up ${when.text}` : "Plan a follow-up", detail: plan ? `${FOLLOW_UP_PLATFORMS.find(([key]) => key === plan.platform)?.[1] || "Other"} · ${plan.regarding}` : "Choose a platform and topic", due: Boolean(when?.due) };
}
export function historyLabel(entry: HistoryEntry): string {
  if (entry.followUp) return `${entry.followUp.completed ? "Followed up" : "Not contacted"} · ${FOLLOW_UP_PLATFORMS.find(([key]) => key === entry.followUp!.platform)?.[1] || "Other"}${entry.followUp.regarding ? ` · ${entry.followUp.regarding}` : ""}`;
  return HISTORY_TYPES.find(([key]) => key === entry.type)?.[1] || entry.type;
}
