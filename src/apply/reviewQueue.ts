import { useEffect, useSyncExternalStore } from "react";
import { getJson, type PendingQ } from "./engine";

// GET /applications/review-queue, one view per page so each reads only what it shows (the link
// to Mongo is slow, so load time follows the bytes read): the Unanswered page's order and the
// cards on screen, the Ready page's lists, the header counts. What a page loaded is kept while
// you move between pages; pages refresh it in the background and update their own rows at once.

export interface EngineState {
  killSwitch: { enabled: boolean; reason: string | null } | null;
  worker: { online: boolean; updatedAt: string } | null;
}
export interface Counts {
  unanswered: number; questions: number; ready: number; readyForReview?: number; needsInput?: number; actionRequired?: number;
  /** Of `unanswered`: every answer approved, waiting for you to choose Fill and verify. */
  reviewComplete?: number;
  /** Open in your browser (Apply with Atriveo): never in the lists above. */
  inBrowser?: number;
}
/**
 * An application open in your browser (Apply with Atriveo). The worker never touches it; the only dashboard
 * actions are Return to worker (when `canReturn`; otherwise `returnBlock` says why) and Skip.
 */
export interface InBrowserApp {
  id: string; company: string; companyKey: string | null; title: string; location: string | null; ats: string | null;
  url: string; priority: number; updatedAt: string;
  state: string; startedAt: string | null; takenOverFrom: string | null; pending: number;
  filledAt: string | null; filled: number | null;
  canReturn: boolean; returnBlock: string | null;
}

interface Row {
  id: string; company: string; companyKey: string | null; title: string; location: string | null; ats: string | null;
  url: string; priority: number; updatedAt: string;
  /** Why it sits where it does in the application order (job-pipeline priority tags). */
  priorityTags?: string[];
  createdAt?: string | null;
  /** job-pipeline's match score (score_pct), when the posting went up, and when the pipeline found it. */
  score?: number | null; postedAt?: string | null; foundAt?: string | null;
  /** The resume track its title puts it on (TRACKS.yaml): software-engineer, ai-engineer, data-science, data-analytics, forward-deployed. */
  track?: string | null;
}
export interface UnansweredApp extends Row { reviewStage?: "questions" | "final_form" | null; reviewReason: string | null; questionReviewStatus: "open" | "complete" | null; questions: PendingQ[] }
export interface ReadyApp extends Row {
  filledAt: string; resumeFile: string | null; answered: number;
  /** Ready jobs at this company; one is submitted per company per day. */
  readyAtCompany: number;
  /** A job at this company was already submitted today, so an approval now would wait until tomorrow. */
  companySubmittedToday: boolean;
}
/** Filled and verified on an ATS you submit yourself (Ashby, Lever): Open & Fill instead of Approve. */
export interface ManualApp extends ReadyApp {
  /** Your last Open & Fill: when you opened it, and what Atriveo Fill reported from your browser. */
  openFill: { armedAt: string | null; filledAt: string | null; filled: number | null; toCheck: number | null } | null;
}
export interface ApprovedApp extends Row {
  status: string; reviewReason: string | null; reviewDetail: string | null; failureCode: string | null;
  submittedAt: string | null; approvedAt: string | null;
}
/** An application blocked on questions, in the Unanswered page's order; its card loads when it's needed. */
export interface QueuedApp { track?: string | null; location?: string | null; createdAt?: string | null; priorityTags?: string[]; score?: number | null; postedAt?: string | null; foundAt?: string | null; company?: string; title?: string; id: string; updatedAt: string; n: number; suggestions?: number; readyForReview?: number; needsInput?: number; actionRequired?: number }

interface View extends EngineState { ok: boolean; generatedAt: string; counts: Counts }
export interface UnansweredQueue extends View { unanswered: QueuedApp[] }
export interface ReadyQueue extends View { ready: ReadyApp[]; approved: ApprovedApp[]; manual?: ManualApp[]; inBrowser?: InBrowserApp[] }

const visible = () => document.visibilityState === "visible";

function store<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: Partial<T>) => { state = { ...state, ...next }; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

// --- Header counts --------------------------------------------------------------------------

const counts = store<{ counts: Counts | null }>({ counts: null });
let countsInflight: Promise<void> | null = null;

function refreshCounts(): void {
  if (countsInflight || unanswered.loading() || ready.loading()) return;
  countsInflight = getJson<View>("/applications/review-queue?view=counts")
    .then((r) => counts.set({ counts: r.counts }))
    .catch(() => { /* the badges are optional */ })
    .finally(() => { countsInflight = null; });
}

/** Just the counts, for the header: cheap to load, refreshed every minute. */
export function useReviewCounts(): Counts | null {
  const s = useSyncExternalStore(counts.subscribe, counts.get);
  useEffect(() => {
    // After the page's own load has started (it brings the counts too).
    const first = setTimeout(() => { if (!counts.get().counts) refreshCounts(); }, 0);
    const t = setInterval(() => { if (visible()) refreshCounts(); }, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  return s.counts;
}

/** Lower the header counts at once after you act; the next load brings the real numbers. */
export function adjustCounts(delta: Partial<Counts>): void {
  const c = counts.get().counts;
  if (!c) return;
  counts.set({
    counts: {
      ...c,
      unanswered: Math.max(0, c.unanswered + (delta.unanswered ?? 0)),
      questions: Math.max(0, c.questions + (delta.questions ?? 0)),
      ready: Math.max(0, c.ready + (delta.ready ?? 0)),
    },
  });
}

// --- Page views -----------------------------------------------------------------------------

interface Loaded<T> { data: T | null; error: string | null; loading: boolean }

// Coming back to a page shows what it had at once; a copy older than this reloads in the background.
const STALE_MS = 10_000;

/** One page's view: loaded on first use, then every `pollMs` while the tab is visible. */
/** A polled server view; views with header counts (Unanswered, Ready) also refresh those counts. */
function pageView<T extends { generatedAt: string; counts?: Counts }>(load: (first: boolean) => Promise<T>) {
  const s = store<Loaded<T>>({ data: null, error: null, loading: false });
  let inflight: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    s.set({ loading: true });
    inflight = load(!s.get().data)
      .then((data) => { s.set({ data, error: null }); if (data.counts) counts.set({ counts: data.counts }); })
      .catch((e) => s.set({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { inflight = null; s.set({ loading: false }); });
    return inflight;
  };
  const stale = () => {
    const data = s.get().data;
    return !data || Date.now() - Date.parse(data.generatedAt) > STALE_MS;
  };
  const use = (pollMs: number): Loaded<T> => {
    const state = useSyncExternalStore(s.subscribe, s.get);
    useEffect(() => {
      if (stale()) void refresh();
      const t = setInterval(() => { if (visible()) void refresh(); }, pollMs);
      const onShow = () => { if (visible() && stale()) void refresh(); };
      document.addEventListener("visibilitychange", onShow);
      return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
    }, [pollMs]);
    return state;
  };
  return { refresh, use, loading: () => inflight !== null };
}

// Cards loaded with the first page of the Unanswered queue; the rest load as they come into view.
const FIRST_CARDS = 20;

const unanswered = pageView<UnansweredQueue>(async (first) => {
  const n = first ? FIRST_CARDS : 0;
  const r = await getJson<UnansweredQueue & { cards: UnansweredApp[] }>(`/applications/review-queue?view=unanswered&cards=${n}`);
  if (n) putCards(r.unanswered.slice(0, n), r.cards);
  return r;
});
const ready = pageView<ReadyQueue>(() => getJson<ReadyQueue>("/applications/review-queue?view=ready"));

/** A LinkedIn posting with a resume ready and no application (the engine never applies on LinkedIn). */
export interface LinkedinJob { id: string; url: string; company: string; title: string; location: string | null; score: number | null; postedAt: string | null; foundAt: string | null; track: string | null; resumeFile: string | null; resumePath?: string | null }
export interface LinkedinQueue { ok: boolean; generatedAt: string; linkedin: LinkedinJob[] }
const linkedin = pageView<LinkedinQueue>(() => getJson<LinkedinQueue>("/applications/review-queue?view=linkedin"));
/** Today's "On LinkedIn" cards: you open the posting, click Apply there, and Apply with Atriveo fills the company's form. */
export const useLinkedinQueue = linkedin.use;
export const refreshLinkedin = linkedin.refresh;

/** The Unanswered page's order: every application blocked on questions, without its questions. */
export const useUnansweredQueue = unanswered.use;
export const refreshUnanswered = unanswered.refresh;
/** The Ready page: waiting for your approval or for you to submit (Open & Fill), and the approvals on their way. */
export const useReadyQueue = ready.use;
export const refreshReady = ready.refresh;

// --- Unanswered cards -----------------------------------------------------------------------

interface Cards {
  /** Questions and details by application id, as last loaded. */
  cards: Record<string, UnansweredApp>;
  /** Asked for at this version and not returned: no longer waiting for answers. */
  gone: Record<string, string>;
  error: string | null;
}
const cards = store<Cards>({ cards: {}, gone: {}, error: null });
const cardsInflight = new Set<string>();

/** Keep the cards that came back; the rest of `asked` are no longer blocked on questions. */
function putCards(asked: QueuedApp[], got: UnansweredApp[]): void {
  const cur = cards.get();
  const next = { ...cur.cards };
  for (const c of got) next[c.id] = c;
  const gone = { ...cur.gone };
  for (const q of asked) if (!next[q.id] || next[q.id]!.updatedAt < q.updatedAt) gone[q.id] = q.updatedAt;
  cards.set({ cards: next, gone, error: null });
}

const needsCard = (q: QueuedApp) => {
  const { cards: have, gone } = cards.get();
  return !cardsInflight.has(q.id) && !(have[q.id] && have[q.id]!.updatedAt >= q.updatedAt) && !(gone[q.id] && gone[q.id]! >= q.updatedAt);
};

/** Load the cards of these applications that aren't loaded at their current version. */
export async function loadCards(rows: QueuedApp[]): Promise<void> {
  const want = rows.filter(needsCard);
  if (!want.length) return;
  want.forEach((q) => cardsInflight.add(q.id));
  try {
    const chunks = Array.from({ length: Math.ceil(want.length / 25) }, (_, i) => want.slice(i * 25, i * 25 + 25));
    await Promise.all(chunks.map(async (chunk) => {
      const r = await getJson<{ cards: UnansweredApp[] }>(`/applications/review-queue?view=cards&ids=${chunk.map((q) => encodeURIComponent(q.id)).join(",")}`);
      putCards(chunk, r.cards);
    }));
  } catch (e) {
    cards.set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    want.forEach((q) => cardsInflight.delete(q.id));
  }
}

export function useUnansweredCards(): Cards {
  return useSyncExternalStore(cards.subscribe, cards.get);
}
