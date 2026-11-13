import type { Person, Source } from "./network";

// What the phone's People screens share: the ways to reach someone, and everyone grouped by where you know them from.

export type Channel = "email" | "call" | "linkedin";
const linkedinUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://www.linkedin.com/in/${v.replace(/^@/, "")}`);
export const contacts = (p: Person | undefined): [Channel, string, string][] => {
  if (!p) return [];
  const out: [Channel, string, string][] = [];
  if (p.email) out.push(["email", "Email", `mailto:${p.email}`]);
  if (p.phone) out.push(["call", "Call", `tel:${p.phone.replace(/[^\d+]/g, "")}`]);
  if (p.linkedin) out.push(["linkedin", "LinkedIn", linkedinUrl(p.linkedin)]);
  return out;
};

/** The people matching a search (name, role, company, city, email, tags, source), grouped by source: biggest first, no source last. */
export function groupBySource(people: Person[], sources: Source[], query: string): { id: string | null; name: string; people: Person[] }[] {
  const byId = new Map(sources.map((s) => [s.id, s])), q = query.trim().toLowerCase();
  const match = (p: Person) => !q || [p.name, p.role, p.company, p.city, p.email, ...(p.tags ?? []), p.sourceId ? byId.get(p.sourceId)?.name ?? "" : ""].some((v) => v?.toLowerCase().includes(q));
  const groups = new Map<string | null, Person[]>();
  for (const p of people) { if (!match(p)) continue; const k = p.sourceId && byId.has(p.sourceId) ? p.sourceId : null; groups.set(k, [...(groups.get(k) ?? []), p]); }
  return [...groups].map(([id, list]) => ({ id, name: id ? byId.get(id)!.name : "No source", people: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => Number(a.id === null) - Number(b.id === null) || b.people.length - a.people.length || a.name.localeCompare(b.name));
}
