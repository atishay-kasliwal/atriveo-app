// Data and pure helpers for the open source page (OpenSourcePage.tsx). Server: scripts/open-source.mjs.
import { getTailorServerBase } from "../utils/tailorServer";

export type Rating = "impressive" | "good" | "average" | "closed";
export type State = "MERGED" | "OPEN" | "CLOSED";
export type Coverage = "todo" | "draft" | "covered" | "skipped" | "closed" | "deleted";
export interface Pr {
  id: string; url: string; repo: string; owner: string; n: number; title: string; state: State; review: string | null; draft: boolean; openedAt: string | null; endedAt: string | null;
  add: number | null; stars: number | null; lang: string | null; company: string | null; personal: boolean | null; shared: boolean; score: number | null;
  parts: { recognition: number; size: number; proof: number; status: number } | null; rating: Rating | null; autoRating: Rating | null; ratedByYou: boolean;
  coverage: Coverage; bullets: string[]; text: string; fits: string[]; manual: boolean;
}
export interface Bullet {
  id: string; source: "bank" | "draft"; org: string; project: string; text: string; fits: string[]; areas: string[]; tech: string[]; prs: string[]; shared: boolean;
  score: number | null; rating: "impressive" | "good" | "average" | null; merged: boolean; stars: number; ready: boolean;
}
export interface View {
  sync: { at?: string; full?: boolean; count?: number; added?: string[]; changed?: Array<{ id: string; from: State; to: State }>; error?: string } | null; syncing: boolean;
  demand: { at: string; postings: number; roles: Record<string, { n: number; skills: Array<[string, number]> }> } | null;
  bankVersion: string; prs: Pr[]; bullets: Bullet[]; masters: Record<string, string[]>; skills: Record<string, string[]>;
}

export async function call<T>(op: string, body?: object): Promise<T> {
  const res = await fetch(`${getTailorServerBase()}/resume-builder/${op}`, body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export const ROLES: Array<{ id: string; label: string; short: string; sub?: boolean; hue: string }> = [
  { id: "AI", label: "AI engineer", short: "AI", hue: "#a78bfa" }, { id: "DS", label: "Data science", short: "DS", hue: "#34d399" },
  { id: "SWE", label: "Software engineer", short: "SWE", hue: "#60a5fa" }, { id: "BE", label: "Backend", short: "BE", sub: true, hue: "#60a5fa" },
  { id: "FS", label: "Full stack", short: "FS", sub: true, hue: "#60a5fa" }, { id: "FE", label: "Frontend", short: "FE", sub: true, hue: "#60a5fa" },
  { id: "PL", label: "Platform and cloud", short: "PL", sub: true, hue: "#60a5fa" }, { id: "FDE", label: "Forward deployed", short: "FDE", hue: "#f472b6" },
  { id: "DA", label: "Data analytics", short: "DA", hue: "#fbbf24" },
];
export const roleLabel = (id: string) => ROLES.find((r) => r.id === id)?.label ?? "All resumes";
export const FITS = ["SWE", "AI", "DS", "DA", "FDE"];
export const RATING: Record<Rating, string> = { impressive: "Impressive", good: "Good", average: "Average", closed: "Closed" };
export const LEVELS = ["impressive", "good", "average"] as const;
export const SEGMENTS: Array<{ id: string; level: string; label: string; has: (b: Bullet) => boolean }> = [
  { id: "ready", level: "impressive", label: "Resume ready", has: (b) => b.ready },
  { id: "merged", level: "good", label: "Merged, not ready", has: (b) => b.merged && !b.ready },
  { id: "open", level: "average", label: "Open", has: (b) => !b.merged },
];

const NAMES: Record<string, string> = { scipy: "SciPy", umap: "UMAP", kiali: "Kiali", keycloak: "Keycloak", cockpit: "Cockpit", numaflow: "Numaflow", "numaflow-rs": "Numaflow Rust SDK", "numaflow-python": "Numaflow Python SDK", misterdownloadmanager: "MisterDownloadManager", "pr-agent": "PR-Agent", "podman-desktop": "Podman Desktop", pytensor: "PyTensor" };
export const projectName = (repo: string) => NAMES[repo.split("/")[1]] ?? repo.split("/")[1];
export const whose = (p: Pr) => p.company ?? projectName(p.repo);

export const inRole = (b: Bullet, role: string) => role === "ALL" || b.fits.includes(role) || b.areas.includes(role);
export const pool = (view: View, role: string, drafts: boolean) => view.bullets.filter((b) => inRole(b, role) && (drafts || b.source === "bank"));
export const verb = (b: Bullet) => b.text.split(" ")[0];
export const stars = (n: number | null) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K stars` : `${n} stars`);
export const day = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }); };
export const when = (p: Pr) => (p.state === "OPEN" ? `Opened ${day(p.openedAt)}` : `${p.state === "MERGED" ? "Merged" : "Closed"} ${day(p.endedAt)}`).trim();
export const dateOf = (p: Pr) => (p.state === "OPEN" ? p.openedAt : p.endedAt) ?? "";

// Projects that are the heart of one resume: they lead its suggestions, and data science ones step back on the software rows.
const CORE: Record<string, string[]> = {
  AI: ["AURA", "rig", "PR-Agent", "StuntDouble", "math-mcp"],
  DS: ["SciPy", "statsmodels", "UMAP", "neuralforecast", "statsforecast", "utilsforecast", "TimesFM", "PyTensor", "opensearch-py-ml"],
};
const core = (b: Bullet, role: string) => (CORE[role] ? Number(CORE[role].includes(b.project)) : -Number(CORE.DS.includes(b.project)));
export const rank = (role: string) => (a: Bullet, b: Bullet) => core(b, role) - core(a, role) || (b.score ?? 0) - (a.score ?? 0) || b.stars - a.stars;

/** The three to suggest: ready, best first, different opening verbs, at most two from one company. */
export function suggest(view: View, role: string, drafts: boolean): Bullet[] {
  const out: Bullet[] = [], verbs = new Set<string>(), per = new Map<string, number>();
  for (const b of pool(view, role, drafts).filter((x) => x.ready).sort(rank(role))) {
    const who = b.org || b.project;
    if (verbs.has(verb(b)) || (per.get(who) ?? 0) >= 2) continue;
    verbs.add(verb(b)); per.set(who, (per.get(who) ?? 0) + 1); out.push(b);
    if (out.length === 3) break;
  }
  return out;
}

/** The project heading as the resume prints it (scripts/ac-tex.mjs ossHeading). */
export function heading(bullets: Bullet[]): { name: string; tools: string } {
  const orgs = [...new Set(bullets.map((b) => b.org))], one = orgs.length === 1 ? orgs[0] : "";
  const named = new Set<string>(), seen = new Set<string>(), list: string[] = [];
  for (const b of bullets) {
    const key = `${b.org}|${b.project}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (one || !b.org || b.project.toLowerCase().includes(b.org.toLowerCase()) || named.has(b.org)) list.push(b.project);
    else { named.add(b.org); list.push(`${b.org} ${b.project}`); }
  }
  return { name: `${one ? `${one} | ` : ""}${list.join(", ")} (Open Source)`, tools: [...new Set(bullets.flatMap((b) => b.tech))].slice(0, 4).join(", ") };
}

export const prsOf = (view: View, bullets: Bullet[]) => { const ids = new Set(bullets.flatMap((b) => b.prs)); return view.prs.filter((p) => ids.has(p.id)); };
export const countLevels = (bullets: Bullet[]) => LEVELS.map((l) => bullets.filter((b) => b.rating === l).length);

/** A remembered choice; works without storage (private windows). */
export const remember = {
  get<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; } },
  set(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } },
};
