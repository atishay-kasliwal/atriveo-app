import { fetchJson, getJson, type ApiBody } from "./engine";
import { getTailorServerBase } from "../utils/tailorServer";

// The Network page's data: people, the sources they come from (a company, an event, family), and the links between them.

export type SourceType = "company" | "event" | "family" | "other";
export type LinkKind = "works" | "family" | "intro" | "other";
export type HistoryType = "note" | "email" | "message" | "call" | "met" | "reply";
export interface HistoryEntry { id: string; at: string; type: HistoryType; text: string }
export interface Person {
  id: string; name: string; role: string; city: string; email: string; linkedin: string; phone: string; notes: string;
  sourceId: string | null; via: string | null; color: string | null; tags: string[];
  lastContact: string | null; nextFollowUp: string | null; history: HistoryEntry[]; archived: boolean; createdAt: string; updatedAt: string; x?: number; y?: number;
}
export interface Source { id: string; name: string; type: SourceType; about: string; color: string | null; createdAt: string; x?: number; y?: number }
export interface Link { id: string; a: string; b: string; kind: LinkKind; label: string; color: string | null }
export interface NetworkData { people: Person[]; sources: Source[]; links: Link[]; you?: { x: number; y: number } }
export interface ListRow { name: string; city: string; repeat: boolean; exists: boolean }

export const SOURCE_TYPES: [SourceType, string][] = [["company", "Company"], ["event", "Event"], ["family", "Family"], ["other", "Other"]];
export const LINK_KINDS: [LinkKind, string][] = [["works", "Works with"], ["family", "Family"], ["intro", "Introduced"], ["other", "Other"]];
export const HISTORY_TYPES: [HistoryType, string][] = [["note", "Note"], ["email", "Email"], ["message", "Message"], ["call", "Call"], ["met", "Met"], ["reply", "They replied"]];

export const loadNetwork = (archived = false) => getJson<NetworkData & ApiBody>(`/network${archived ? "?archived=1" : ""}`);
export async function post<T>(path: string, body: object): Promise<T> {
  const { res, json } = await fetchJson<ApiBody & T>(`${getTailorServerBase()}/network/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  const ordered = [...data.sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const taken = new Set(ordered.map((s) => s.color).filter(Boolean) as string[]);
  let i = 0;
  for (const s of ordered) {
    if (s.color) { source.set(s.id, s.color); continue; }
    let c = PALETTE[i++ % PALETTE.length];
    for (let k = 0; k < PALETTE.length && taken.has(c); k++) c = PALETTE[i++ % PALETTE.length];
    taken.add(c); source.set(s.id, c);
  }
  // An introduced person's colour must not be mistaken for a source's, so close hues (pink and magenta, amber and orange) are left out too.
  const used = [...new Set(source.values())], own = PALETTE.filter((c) => used.every((u) => hueGap(c, u) > 40));
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
  const sources = [...data.sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  sources.forEach((s, i) => pos.set(s.id, s.x != null && s.y != null ? { x: s.x, y: s.y } : ring(you.x, you.y, 460 + (sources.length > 6 ? 120 : 0), (i / Math.max(1, sources.length)) * Math.PI * 2 - Math.PI / 2)));
  for (const p of data.people) if (p.x != null && p.y != null) pos.set(p.id, { x: p.x, y: p.y });
  const bySource = new Map<string | null, Person[]>(), byVia = new Map<string, Person[]>();
  for (const p of data.people) {
    if (pos.has(p.id)) continue;
    if (p.via && data.people.some((q) => q.id === p.via)) byVia.set(p.via, [...(byVia.get(p.via) ?? []), p]);
    else bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p]);
  }
  for (const [sid, list] of bySource) {
    const c = (sid && pos.get(sid)) || you;
    const out = sid ? Math.atan2(c.y - you.y, c.x - you.x) : -Math.PI / 2;
    placeGroup(list.map((p) => p.id), c, out, sid ? 250 : 300, pos);
  }
  // Introduced people after everyone else, so a chain of introductions places each one next to the last.
  const queue = [...byVia.keys()];
  for (let guard = 0; queue.length && guard < 10000; guard++) {
    const via = queue.shift()!; const c = pos.get(via);
    if (!c) { queue.push(via); continue; }
    const kids = byVia.get(via) ?? [], out = Math.atan2(c.y - you.y, c.x - you.x);
    kids.forEach((p, i) => { pos.set(p.id, ring(c.x, c.y, 210, out + (i - (kids.length - 1) / 2) * 0.55)); });
  }
  for (const p of data.people) if (!pos.has(p.id)) pos.set(p.id, ring(you.x, you.y, 300, Math.random() * Math.PI * 2));
  return pos;
}

const CARD_W = 196, CARD_H = 52, GAP_X = 24, GAP_Y = 18;
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

export interface Edge { key: string; a: string; b: string; kind: "belongs" | "via" | "you" | LinkKind; label: string; color: string; link?: Link }

/** The lines: you to each source, each source to its first connections, each introducer to who they introduced, then your own links. */
export function edgesFor(data: NetworkData, colors: ReturnType<typeof colorsFor>): Edge[] {
  const out: Edge[] = [];
  const typeName = (t: SourceType) => SOURCE_TYPES.find(([k]) => k === t)?.[1].toLowerCase() ?? "";
  for (const s of data.sources) out.push({ key: `you-${s.id}`, a: "you", b: s.id, kind: "you", label: typeName(s.type), color: colors.source.get(s.id) ?? NEUTRAL });
  const ids = new Set(data.people.map((p) => p.id));
  for (const p of data.people) {
    const c = colors.person.get(p.id) ?? NEUTRAL;
    if (p.via && ids.has(p.via)) out.push({ key: `via-${p.id}`, a: p.via, b: p.id, kind: "via", label: "introduced", color: c });
    else if (p.sourceId && data.sources.some((s) => s.id === p.sourceId)) out.push({ key: `src-${p.id}`, a: p.sourceId, b: p.id, kind: "belongs", label: "first connection", color: colors.source.get(p.sourceId) ?? c });
    else out.push({ key: `you-${p.id}`, a: "you", b: p.id, kind: "you", label: "you know them", color: c });
  }
  const known = new Set([...ids, ...data.sources.map((s) => s.id)]);
  for (const l of data.links) {
    if (!known.has(l.a) || !known.has(l.b)) continue;
    out.push({ key: `link-${l.id}`, a: l.a, b: l.b, kind: l.kind, label: l.label || LINK_KINDS.find(([k]) => k === l.kind)?.[1] || "", color: l.color ?? colors.person.get(l.a) ?? colors.source.get(l.a) ?? NEUTRAL, link: l });
  }
  return out;
}
