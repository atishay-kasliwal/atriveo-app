// How the console is used, measured in the browser and kept as counts and seconds only.
// Time: seconds on a page while it is visible and you have done something in the last 30 s.
// Features: a click or key is counted only when it matches a feature in the registry below, by the button's label. Anything that does
// not match is not recorded at all, so no company, job or personal text can leave through here.

export interface Feature { key: string; page: string; label: string; test?: RegExp; keys?: string[] }

export const PAGES: Record<string, string> = {
  today: "Today", matching: "Matching", applied: "Applied", general: "General", assessments: "Assessments", staffing: "Staffing", resumes: "Resumes",
  bank: "Bank", outreach: "Outreach", stats: "Stats", ready: "Ready", settings: "Settings", usage: "Usage",
};

export function pageIdOf(path: string): string {
  const p = path.replace(/\/+$/, "");
  if (p === "/job-matching") return "matching";
  if (p === "/applied" || p.startsWith("/applied/")) return "applied";
  if (p === "/general") return "general";
  if (p === "/assessments") return "assessments";
  if (p === "/staffing") return "staffing";
  if (p === "/resume_builder") return "resumes";
  if (p === "/bank") return "bank";
  if (p === "/outreach") return "outreach";
  if (p === "/stats" || p === "/overview") return "stats";
  if (p === "/ready" || p === "/review") return "ready";
  if (p === "/settings") return "settings";
  if (p === "/usage") return "usage";
  return "today";
}

/** Named features. Pages without entries here still get time and an overall count of interactions. */
export const FEATURES: Feature[] = [
  { key: "matching.apply", page: "matching", label: "Apply with the extension", test: /^apply\b/ },
  { key: "matching.skip", page: "matching", label: "Not apply", test: /^not apply/ },
  { key: "matching.later", page: "matching", label: "Save for later", test: /^save for later/ },
  { key: "matching.random", page: "matching", label: "Random job", test: /^random/ },
  { key: "matching.next", page: "matching", label: "Next and previous", test: /^(next|previous)\b/ },
  { key: "matching.shortcuts", page: "matching", label: "Keyboard shortcuts", keys: ["n", "s", "enter", "arrowleft", "arrowright"] },
  { key: "matching.skills", page: "matching", label: "Skill match tab", test: /^skill match$/ },
  { key: "matching.evidence", page: "matching", label: "Evidence tab", test: /^evidence$/ },
  { key: "matching.description", page: "matching", label: "Description tab", test: /^description$/ },
  { key: "matching.company", page: "matching", label: "Company tab", test: /^company$/ },
  { key: "matching.answer", page: "matching", label: "Answer tab", test: /^answer$/ },
  { key: "matching.download", page: "matching", label: "Download PDF", test: /^download pdf/ },
  { key: "matching.edit_resume", page: "matching", label: "Edit resume", test: /^edit resume/ },
  { key: "matching.search", page: "matching", label: "Search", test: /^search$/ },
  { key: "matching.date", page: "matching", label: "Date filter", test: /^(today|yesterday|7 days|all time)\b/ },
  { key: "matching.roles", page: "matching", label: "Role filter", test: /^roles$/ },
  { key: "matching.sort", page: "matching", label: "Sort", test: /^(newest|best fit)/ },
  { key: "matching.email", page: "matching", label: "Resume email tool", test: /^email$/ },
  { key: "matching.runs", page: "matching", label: "Scrape runs", test: /^runs\b/ },
  { key: "matching.hidden", page: "matching", label: "Hidden companies", test: /^hidden\b/ },
  { key: "general.apply", page: "general", label: "Apply with the general resume", test: /^apply\b/ },
  { key: "general.skip", page: "general", label: "Skip a job", test: /^skip\b/ },
  { key: "general.select", page: "general", label: "Tick rows for bulk skip", test: /^select\b/ },
  { key: "general.range", page: "general", label: "Day range", test: /^(today|yesterday|7 days|30 days|all time)\b/ },
  { key: "general.role", page: "general", label: "Role filter", test: /^(all|swe|ai|data analyst|ds|fde|other)\b/ },
  { key: "general.applied", page: "general", label: "Mark applied", test: /^yes$/ },
  { key: "assessments.set", page: "assessments", label: "Set a deadline", test: /^(set|change)$/ },
  { key: "assessments.done", page: "assessments", label: "Mark done", test: /^done\b/ },
  { key: "applied.filter", page: "applied", label: "Reply filter", test: /^(all|replies|interviews|assessments|offers|rejected|no reply)\b/ },
  { key: "settings.goal", page: "settings", label: "Daily goal", test: /^(one fewer|one more|\d+)$/ },
  { key: "settings.widget", page: "settings", label: "Widget content", test: /^(responses|interviews|to review|streak|trend|replies|day streak|blue|green|amber|rose)\b/ },
];

const INTERACTIVE = "button,a,[role=tab],[role=switch],[role=radio],input[type=checkbox],summary";
const label = (el: Element) => (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** The feature a click belongs to on this page, or null. Exported for tests. */
export function featureForClick(page: string, text: string): string | null {
  return FEATURES.find((f) => f.page === page && f.test?.test(text))?.key ?? null;
}
export function featureForKey(page: string, key: string): string | null {
  return FEATURES.find((f) => f.page === page && f.keys?.includes(key.toLowerCase()))?.key ?? null;
}

const IDLE_MS = 30_000, FLUSH_MS = 30_000;
interface Item { kind: "page" | "action"; key: string; seconds: number; count: number }

/** Starts measuring. `current` returns the page the console is showing now. Returns a function that stops and sends what is left. */
export function startUsageTracking(current: () => string, send: (items: Item[]) => void = post): () => void {
  const pending = new Map<string, Item>();
  const bump = (kind: Item["kind"], key: string, seconds = 0, count = 0) => {
    const id = `${kind}:${key}`, it = pending.get(id) ?? { kind, key, seconds: 0, count: 0 };
    it.seconds += seconds; it.count += count; pending.set(id, it);
  };
  let page = pageIdOf(current()), last = Date.now();
  bump("page", page, 0, 1);
  const flush = () => {
    const items = [...pending.values()].filter((i) => i.seconds || i.count).map((i) => ({ ...i, seconds: Math.min(600, i.seconds), count: Math.min(500, i.count) }));
    pending.clear();
    if (items.length) send(items.slice(0, 80));
  };
  const touch = () => { last = Date.now(); };
  const onClick = (e: MouseEvent) => {
    touch();
    const el = (e.target as Element | null)?.closest?.(INTERACTIVE);
    if (!el) return;
    bump("action", `${page}.interactions`, 0, 1);
    const f = featureForClick(page, label(el));
    if (f) bump("action", f, 0, 1);
  };
  const onKey = (e: KeyboardEvent) => {
    touch();
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = featureForKey(page, e.key);
    if (f) { bump("action", `${page}.interactions`, 0, 1); bump("action", f, 0, 1); }
  };
  let moved = 0;
  const onMove = () => { const n = Date.now(); if (n - moved > 2000) { moved = n; touch(); } };
  const tick = window.setInterval(() => {
    const now = pageIdOf(current());
    if (now !== page) { page = now; bump("page", page, 0, 1); }
    if (document.visibilityState === "visible" && Date.now() - last < IDLE_MS) bump("page", page, 1, 0);
  }, 1000);
  const timer = window.setInterval(flush, FLUSH_MS);
  const hide = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("scroll", touch, { capture: true, passive: true });
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", flush);
  return () => {
    window.clearInterval(tick); window.clearInterval(timer);
    document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointermove", onMove); document.removeEventListener("scroll", touch, true);
    document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", flush);
    flush();
  };
}

function post(items: Item[]) {
  try { void fetch("/api/usage", { method: "POST", credentials: "include", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).catch(() => {}); } catch { /* measuring must never break the console */ }
}

export interface UsageRow { kind: string; key: string; seconds: number; count: number; days: number; last: string }
export interface UsageSummary { range: string; from: string | null; since: string | null; today: string; rows: UsageRow[] }
export async function loadUsage(range: string): Promise<UsageSummary> {
  const res = await fetch(`/api/usage?range=${encodeURIComponent(range)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as UsageSummary;
}

export function duration(seconds: number): string {
  if (seconds < 60) return seconds ? `${seconds}s` : "0m";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
}
