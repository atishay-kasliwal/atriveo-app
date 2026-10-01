import { useEffect, useSyncExternalStore } from "react";
import { getJson, type PendingQ } from "./engine";

// GET /applications/review-queue, shared by the Unanswered and Ready pages and the header
// counts, so moving between pages doesn't reload it. Loading takes a few seconds (the link
// to Mongo is slow), so pages refresh it in the background and update their own rows at once.

export interface EngineState {
  killSwitch: { enabled: boolean; reason: string | null } | null;
  worker: { online: boolean; updatedAt: string } | null;
}
export interface Counts { unanswered: number; questions: number; ready: number }

interface Row {
  id: string; company: string; companyKey: string | null; title: string; location: string | null; ats: string | null;
  url: string; priority: number; updatedAt: string;
}
export interface UnansweredApp extends Row { reviewReason: string | null; questions: PendingQ[] }
export interface ReadyApp extends Row {
  filledAt: string; resumeFile: string | null; answered: number;
  /** Ready jobs at this company; one is submitted per company per day. */
  readyAtCompany: number;
  /** A job at this company was already submitted today, so an approval now would wait until tomorrow. */
  companySubmittedToday: boolean;
}
export interface ApprovedApp extends Row {
  status: string; reviewReason: string | null; reviewDetail: string | null; failureCode: string | null;
  submittedAt: string | null; approvedAt: string | null;
}
export interface ReviewQueue extends EngineState {
  ok: boolean; generatedAt: string; counts: Counts;
  unanswered: UnansweredApp[]; ready: ReadyApp[]; approved: ApprovedApp[];
}

interface State { data: ReviewQueue | null; error: string | null; loading: boolean; counts: Counts | null }
let state: State = { data: null, error: null, loading: false, counts: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

let inflight: Promise<void> | null = null;
export function refreshReviewQueue(): Promise<void> {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = getJson<ReviewQueue>("/applications/review-queue")
    .then((data) => set({ data, counts: data.counts, error: null }))
    .catch((e) => set({ error: e instanceof Error ? e.message : String(e) }))
    .finally(() => { inflight = null; set({ loading: false }); });
  return inflight;
}

let countsInflight: Promise<void> | null = null;
function refreshCounts(): void {
  if (countsInflight || inflight) return;
  countsInflight = getJson<{ counts: Counts }>("/applications/review-queue?counts=1")
    .then((r) => set({ counts: r.counts }))
    .catch(() => { /* the badges are optional */ })
    .finally(() => { countsInflight = null; });
}

const visible = () => document.visibilityState === "visible";

/** The full queue. Loads once, then every `pollMs` while the tab is visible. */
export function useReviewQueue(pollMs: number): State {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!state.data) void refreshReviewQueue();
    const t = setInterval(() => { if (visible()) void refreshReviewQueue(); }, pollMs);
    const onFocus = () => { if (visible() && state.data && Date.now() - Date.parse(state.data.generatedAt) > 30_000) void refreshReviewQueue(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onFocus); };
  }, [pollMs]);
  return s;
}

/** Just the counts, for the header: cheap to load, refreshed every minute. */
export function useReviewCounts(): Counts | null {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!state.counts) refreshCounts();
    const t = setInterval(() => { if (visible()) refreshCounts(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  return s.counts;
}

/** Lower the header counts at once after you act; the next load brings the real numbers. */
export function adjustCounts(delta: Partial<Counts>): void {
  const c = state.counts;
  if (!c) return;
  set({
    counts: {
      unanswered: Math.max(0, c.unanswered + (delta.unanswered ?? 0)),
      questions: Math.max(0, c.questions + (delta.questions ?? 0)),
      ready: Math.max(0, c.ready + (delta.ready ?? 0)),
    },
  });
}
