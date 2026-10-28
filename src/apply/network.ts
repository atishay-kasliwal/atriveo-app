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
  lastContact: string | null; nextFollowUp: string | null; history: HistoryEntry[]; archived: boolean; createdAt: string; updatedAt: string;
}
export interface Source { id: string; name: string; type: SourceType; about: string; color: string | null; createdAt: string }
export interface Link { id: string; a: string; b: string; kind: LinkKind; label: string; color: string | null }
export interface NetworkData { people: Person[]; sources: Source[]; links: Link[] }
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
