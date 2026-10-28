// How the console is used, measured in the browser and kept as counts and seconds only.
// Time: seconds on a page while it is visible and you have done something in the last 30 s.
// Features: a click or key is counted only when it matches a feature in the registry below, by the button's label. Anything that does
// not match is not recorded at all, so no company, job or personal text can leave through here.

export interface Feature { key: string; page: string; label: string; test?: RegExp; keys?: string[] }

export const PAGES: Record<string, string> = {
  today: "Today", matching: "Matching", applied: "Applied", general: "General", assessments: "Assessments", extension: "Extension", staffing: "Staffing", resumes: "Resumes",
  bank: "Bank", outreach: "Outreach", network: "Network", stats: "Stats", ready: "Ready", settings: "Settings", usage: "Usage",
};

/** One colour per page, so the strip, the rows and the feature groups read as the same thing. */
export const PAGE_HUE: Record<string, string> = { today: "#6d7bff", matching: "#4f9dff", applied: "#2fb87a", general: "#a86be0", assessments: "#e56fb0", extension: "#9bb0ff", staffing: "#f0a23b", resumes: "#e5584f", bank: "#3fc6c0", outreach: "#e56fb0", network: "#34d399", stats: "#9bb0ff", ready: "#c9b458", settings: "#8a919c", usage: "#5f6773" };

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
  if (p === "/network") return "network";
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
  { key: "matching.random", page: "matching", label: "Random job", test: /^(show a random|random)/ },
  { key: "matching.next", page: "matching", label: "Next and previous", test: /^(next|←\s*previous|previous)/ },
  { key: "matching.shortcuts", page: "matching", label: "Keyboard shortcuts", keys: ["n", "s", "c", "f", "a", "enter", "arrowleft", "arrowright"] },
  { key: "matching.skills", page: "matching", label: "Skill match tab", test: /^skill match$/ },
  { key: "matching.evidence", page: "matching", label: "Evidence tab", test: /^evidence$/ },
  { key: "matching.description", page: "matching", label: "Description tab", test: /^description$/ },
  { key: "matching.company", page: "matching", label: "Company tab", test: /^company$/ },
  { key: "matching.answer", page: "matching", label: "Answer tab", test: /^answer$/ },
  { key: "matching.download", page: "matching", label: "Download PDF", test: /^download pdf/ },
  { key: "matching.edit_resume", page: "matching", label: "Edit resume", test: /^edit resume/ },
  { key: "matching.search", page: "matching", label: "Search", test: /^search (jobs|filters)/ },
  { key: "matching.date", page: "matching", label: "Date filter", test: /^date filters/ },
  { key: "matching.roles", page: "matching", label: "Role filter", test: /^role filters/ },
  { key: "matching.sort", page: "matching", label: "Sort", test: /^sort jobs/ },
  { key: "matching.email", page: "matching", label: "Resume email tool", test: /^resume email/ },
  { key: "matching.runs", page: "matching", label: "Scrape runs", test: /^scrape runs/ },
  { key: "matching.hidden", page: "matching", label: "Hidden companies", test: /^hidden companies/ },
  { key: "matching.closed", page: "matching", label: "Closed (the job is gone)", test: /^closed\b/ },
  { key: "matching.applied_yes", page: "matching", label: "Applied? Yes", test: /^yes$/ },
  { key: "matching.applied_no", page: "matching", label: "Applied? No", test: /^no$/ },
  { key: "matching.undo", page: "matching", label: "Undo a choice", test: /undo/ },
  { key: "matching.source", page: "matching", label: "Source filter", test: /^source filters/ },
  { key: "matching.reset", page: "matching", label: "Reset filters", test: /^reset filters/ },
  { key: "matching.hide_company", page: "matching", label: "Not interested in a company", test: /^not interested in/ },
  { key: "matching.fullscreen", page: "matching", label: "Expand the description", test: /^expand full job description/ },
  { key: "matching.posting", page: "matching", label: "Open the original posting", test: /^open original posting/ },
  { key: "general.apply", page: "general", label: "Apply with the general resume", test: /^apply\b/ },
  { key: "general.skip", page: "general", label: "Skip a job", test: /^skip\b/ },
  { key: "general.select", page: "general", label: "Tick rows for bulk skip", test: /^select\b/ },
  { key: "general.range", page: "general", label: "Day range", test: /^(today|yesterday|7 days|30 days|all time)\b/ },
  { key: "general.role", page: "general", label: "Role filter", test: /^(all|swe|ai|data analyst|ds|fde|other)\b/ },
  { key: "general.applied", page: "general", label: "Mark applied", test: /^yes$/ },
  { key: "outreach.prepare", page: "outreach", label: "Prepare outreach", test: /^prepare outreach/ },
  { key: "outreach.scan", page: "outreach", label: "Scan applied jobs", test: /^scan applied jobs/ },
  { key: "outreach.settings", page: "outreach", label: "Mailbox and settings", test: /^mailbox & settings/ },
  { key: "outreach.save", page: "outreach", label: "Save settings or send a test", test: /^(save settings|save & send test)/ },
  { key: "outreach.setup", page: "outreach", label: "Finish setup", test: /^(finish setup|review and unpause)/ },
  { key: "network.list", page: "network", label: "Add a list", test: /^(add a list|add \d+ (people|person))/ },
  { key: "network.person", page: "network", label: "Add person", test: /^add person/ },
  { key: "network.source", page: "network", label: "New or edit source", test: /^(new source|create source|edit )/ },
  { key: "network.history", page: "network", label: "Add to history", test: /^add to history/ },
  { key: "network.followup", page: "network", label: "Set a follow-up", test: /^(\+3 days|\+1 week|\+2 weeks)/ },
  { key: "network.connect", page: "network", label: "Connect two people", test: /^connect$/ },
  { key: "network.archive", page: "network", label: "Archive", test: /^archive$/ },
  { key: "assessments.set", page: "assessments", label: "Set a deadline", test: /^(set|change)$/ },
  { key: "assessments.done", page: "assessments", label: "Mark done", test: /^done\b/ },
  { key: "applied.filter", page: "applied", label: "Reply filter", test: /^(all|replies|interviews|assessments|offers|rejected|no reply)\b/ },
  { key: "settings.goal", page: "settings", label: "Daily goal", test: /^(one fewer|one more|\d+)$/ },
  { key: "settings.widget", page: "settings", label: "Widget content", test: /^(responses|interviews|to review|streak|trend|replies|day streak|blue|green|amber|rose)\b/ },
];

/** What the extension counts (its fixed list); each is a feature of the "Extension" group, reported by the extension itself. */
export const EXTENSION_FEATURES: [string, string][] = [["open", "Open an application (Apply)"], ["attach", "Attach resume"], ["paste", "Paste a detail into a form"], ["paste_profile", "Paste a detail on any page"], ["copy", "Copy a detail"], ["applied", "I applied"], ["closed", "Job closed"], ["download", "Download the resume"], ["save_profile", "Save your details"], ["dismiss", "Close the panel"], ["network_add", "Add to Network from LinkedIn"]];
for (const [k, label] of EXTENSION_FEATURES) FEATURES.push({ key: `extension.${k}`, page: "extension", label });

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

export function sendUsage(items: Item[]) { post(items.slice(0, 80)); }
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
