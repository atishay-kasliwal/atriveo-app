// Loops (docs/loops.md) in the browser: the API calls, and the on-device queue that keeps a capture until the server has it.
// A thought is never dropped: it is queued in IndexedDB first (text or audio), sent, and removed only when the server confirms.

export interface LoopOpen { id: string; view: { summary: string; company: string | null; position: string | null; person: string | null } | null; firstTask: string | null; waitingSince: string; nextAt: string | null; status: string }
export interface LoopsSummary { counts: Record<string, number>; worker: { lastSeenAt: string | null }; open: LoopOpen[] }

const BASE = "/api/loops";
export class LoopsHttpError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  // Anything but a Loops answer (an error, or the site's own page served for an API that is not deployed yet) is a failure, never data.
  if (!res.ok || data.ok !== true) throw new LoopsHttpError(data.error || `Loops answered ${res.status}`, res.ok ? 502 : res.status);
  return data as T;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const loopsSummary = () => request<LoopsSummary & { ok: true }>("/summary");
export const loopDone = (id: string, taskId?: string) => request(`/${id}/done`, json(taskId ? { taskId } : {}));
export const loopSnooze = (id: string, hours: number) => request(`/${id}/snooze`, json({ hours }));

export type LoopStatus = "RECORDED" | "TRANSCRIBING" | "WAITING_FOR_CODEX" | "PROCESSING" | "NEEDS_REVIEW" | "ACTIVE" | "SNOOZED" | "COMPLETED" | "DISMISSED" | "FAILED";
export interface LoopTask { id: string; title: string; description: string | null; priority: "high" | "medium" | "low"; done: boolean; doneAt: string | null }
export interface LoopView { summary: string; company: string | null; position: string | null; person: string | null; intent: string | null; context: string[] }
export interface LoopLinks { linked: { sourceId?: string; personId?: string; jobUrl?: string; company?: string | null }; candidates: { people: Array<{ id: string; name: string; company: string | null }>; jobs: Array<{ url: string; title: string; company: string }>; companies: Array<{ id: string; name: string }> } }
export interface Loop {
  id: string; inputType: "TEXT" | "VOICE"; status: LoopStatus; createdAt: string; updatedAt: string; completedAt: string | null; confirmedAt: string | null;
  text: string | null; audio: { mime: string; bytes: number; durationMs: number } | null; view: LoopView | null; structured: { action_type: string } | null; edited: boolean;
  links: LoopLinks | null; tasks: LoopTask[]; reminder: { intervalHours: number | null; nextAt: string | null; lastAt: string | null; count: number }; error: { stage: string; message: string } | null; attempts: number;
}
export interface LoopEvent { type: string; at: string; data: Record<string, unknown> }
export interface LoopQuery { q?: string; status?: string; from?: string; to?: string }
export const listLoops = (query: LoopQuery = {}) => request<{ ok: true; captures: Loop[] }>(`?limit=200${Object.entries(query).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v as string)}`).join("")}`);
export interface LoopLinked { person?: { id: string; name: string; company: string | null }; company?: { id: string; name: string }; job?: { url: string; title: string | null; company: string | null } }
export const getLoop = (id: string) => request<{ ok: true; capture: Loop; events: LoopEvent[]; linked: LoopLinked }>(`/${id}`);
export const loopEdit = (id: string, patch: object) => request<{ ok: true; capture: Loop }>(`/${id}/edit`, json(patch));
export const loopConfirm = (id: string, reminderHours: number) => request<{ ok: true; capture: Loop }>(`/${id}/confirm`, json({ reminderHours }));
export const loopDismiss = (id: string) => request(`/${id}/dismiss`, json({}));
export const loopRetry = (id: string) => request(`/${id}/retry`, json({}));
export const loopReopen = (id: string) => request(`/${id}/reopen`, json({}));
export const loopTranscript = (id: string, text: string) => request(`/${id}/transcript`, json({ text }));
export const audioUrl = (id: string) => `${BASE}/${id}/audio`;

/** The client picks the id, so a retried upload is the same capture. */
export const newCaptureId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40).padEnd(8, "0");

export type Pending = { id: string; kind: "text"; text: string; at: number } | { id: string; kind: "audio"; blob: Blob; mime: string; durationMs: number; at: number };

export async function sendPending(p: Pending): Promise<void> {
  if (p.kind === "text") await request("/capture", json({ id: p.id, text: p.text }));
  else await request(`/capture/audio?id=${encodeURIComponent(p.id)}&durationMs=${Math.round(p.durationMs)}`, { method: "POST", headers: { "Content-Type": p.mime }, body: p.blob });
}
/** A failure worth retrying later (offline, server down, signed out), as opposed to the server refusing the capture itself. */
export const isRetryable = (e: unknown) => !(e instanceof LoopsHttpError) || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429;

// ── The on-device queue (IndexedDB; sessionStorage-free so a closed tab keeps it) ─────────────────────────────────
const DB = "atriveo-loops", STORE = "pending";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => { const r = fn(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error); }).finally(() => db.close());
};
export const queuePut = (p: Pending) => tx("readwrite", (s) => s.put(p)).then(() => true, () => false);
export const queueDrop = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
export const queueAll = () => tx<Pending[]>("readonly", (s) => s.getAll() as IDBRequest<Pending[]>).catch(() => [] as Pending[]);

/** Save on this device, then send. Resolves "sent" or "queued" (it will be retried); rejects only when the server refuses the capture. */
export async function submitCapture(p: Pending): Promise<"sent" | "queued"> {
  const stored = await queuePut(p);
  try { await sendPending(p); await queueDrop(p.id); return "sent"; }
  catch (e) {
    if (isRetryable(e)) return stored ? "queued" : Promise.reject(e);
    await queueDrop(p.id); throw e;
  }
}
/** Retry everything waiting on this device; returns how many reached the server. */
let flushing: Promise<number> | null = null;
export function flushQueue(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    for (const p of (await queueAll()).sort((a, b) => a.at - b.at)) {
      try { await sendPending(p); await queueDrop(p.id); sent++; }
      catch (e) { if (!isRetryable(e)) await queueDrop(p.id); else break; }
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────────────────────
/** The best recording format this browser can make (Chrome: WebM/Opus; Safari: MP4/AAC); null when it cannot record. */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}
export const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export function waiting(since: string, now = Date.now()) {
  const h = Math.max(0, Math.floor((now - Date.parse(since)) / 3_600_000));
  return h < 1 ? "Just now" : h < 48 ? `Waiting ${h}h` : `Waiting ${Math.floor(h / 24)}d`;
}
