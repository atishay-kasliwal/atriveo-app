import { useEffect, useSyncExternalStore } from "react";
import { getJson } from "./engine";

// GET /applications/review-queue, one view per page so each reads only what it shows (the link
// to Mongo is slow, so load time follows the bytes read): Today's fillable and LinkedIn cards and
// their resume facts, the Ready page's lists, the header counts. What a page loaded is kept while
// you move between pages; pages refresh it in the background and update their own rows at once.

export interface EngineState {
  killSwitch: { enabled: boolean; reason: string | null } | null;
  worker: { online: boolean; updatedAt: string } | null;
}
export interface Counts {
  /** Today's Open & Fill cards from blocked applications (every question answered or drafted). */
  fillable?: number;
  ready: number;
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
  /** Its resume file is on the server, so Fill can attach it now (absent from an older server: treat as ready). */
  resumeReady?: boolean;
  /** How well its tailored resume matches the job (ats-score.json Job Match, 0-100), or null before it is scored. */
  resumeMatch?: ResumeMatch | null; readyState?: ResumeReadyState | null;
}
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
/** When a resume that isn't here yet should be (the server's estimate; minutes rounded to 2, 5, 10, 20, 30, 40, 60…). */
export interface ResumeEta { state: "syncing" | "building" | "queued" | "failed" | "not_queued"; minutes: number | null; ahead?: number }
/** Job Match of the tailored resume; required/preferred are requirement counts the resume meets. */
/** Resume Ready: is the tailored resume safe to send. A status, never a score. */
export interface ResumeReadyState { status: "Ready" | "Review" | "Needs Work"; reasons: string[]; skills_checked?: boolean }
export interface ResumeMatch { score: number | null; status?: "stale"; reason?: string; coverage?: { status: string; unparsed_requirements: number }; required?: { matched: number; total: number } | null; preferred?: { matched: number; total: number } | null }
/**
 * A blocked application Open & Fill can take (every question answered or drafted; n 0: all approved), for Today.
 * resumeMatch, readyState and resumeEta come per card from loadDetails.
 */
export interface QueuedApp { ats?: string | null; url?: string | null; resumeMatch?: ResumeMatch | null; readyState?: ResumeReadyState | null; resumeEta?: ResumeEta; resumeReady?: boolean; track?: string | null; location?: string | null; createdAt?: string | null; priorityTags?: string[]; score?: number | null; postedAt?: string | null; foundAt?: string | null; company?: string; title?: string; id: string; updatedAt: string; n: number; readyForReview?: number }

interface View extends EngineState { ok: boolean; generatedAt: string; counts: Counts }
export interface FillableQueue extends View { fillable: QueuedApp[] }
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
  if (countsInflight || fillable.loading() || ready.loading()) return;
  countsInflight = getJson<View>("/applications/review-queue?view=counts")
    .then((r) => counts.set({ counts: { ...counts.get().counts, ...r.counts } }))
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
      ...(c.fillable !== undefined ? { fillable: Math.max(0, c.fillable + (delta.fillable ?? 0)) } : {}),
      ready: Math.max(0, c.ready + (delta.ready ?? 0)),
    },
  });
}

// --- Page views -----------------------------------------------------------------------------

interface Loaded<T> { data: T | null; error: string | null; loading: boolean }

// Coming back to a page shows what it had at once; a copy older than this reloads in the background.
const STALE_MS = 10_000;

/** One page's view: loaded on first use, then every `pollMs` while the tab is visible. */
/** A polled server view; views with header counts (fillable, Ready) also refresh those they carry. */
function pageView<T extends { generatedAt: string; counts?: Counts }>(load: (first: boolean) => Promise<T>) {
  const s = store<Loaded<T>>({ data: null, error: null, loading: false });
  let inflight: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    s.set({ loading: true });
    inflight = load(!s.get().data)
      .then((data) => { s.set({ data, error: null }); if (data.counts) counts.set({ counts: { ...counts.get().counts, ...data.counts } }); })
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

// Today's Open & Fill cards from blocked applications (applications needing an answer stay off Today).
const fillable = pageView<FillableQueue>(() => getJson<FillableQueue>("/applications/review-queue?view=fillable"));
const ready = pageView<ReadyQueue>(() => getJson<ReadyQueue>("/applications/review-queue?view=ready"));

/** A LinkedIn posting with a resume ready and no application (the engine never applies on LinkedIn). */
export interface LinkedinJob { resumeMatch?: ResumeMatch | null; readyState?: ResumeReadyState | null; resumeEta?: ResumeEta; resumeReady?: boolean; id: string; url: string; company: string; title: string; location: string | null; score: number | null; postedAt: string | null; foundAt: string | null; track: string | null; resumeFile: string | null; resumePath?: string | null; applyType?: "offsite" | "easy_apply" | null }
export interface LinkedinQueue { ok: boolean; generatedAt: string; linkedin: LinkedinJob[] }
const linkedin = pageView<LinkedinQueue>(() => getJson<LinkedinQueue>("/applications/review-queue?view=linkedin&light=1"));
/** Today's "On LinkedIn" cards: you open the posting, click Apply there, and Apply with Atriveo fills the company's form. */
export const useLinkedinQueue = linkedin.use;
export const refreshLinkedin = linkedin.refresh;

/** Today's fillable cards, in order (the header reads its worker state too). */
export const useFillableQueue = fillable.use;
export const refreshFillable = fillable.refresh;
/** The Ready page: waiting for your approval or for you to submit (Open & Fill), and the approvals on their way. */
export const useReadyQueue = ready.use;
export const refreshReady = ready.refresh;

// --- Card details ---------------------------------------------------------------------------

/** Resume Match, Resume Ready and the resume ETA of one card (application id, or LinkedIn job URL). */
export interface CardDetail { resumeReady?: boolean; resumeMatch: ResumeMatch | null; readyState: ResumeReadyState | null; resumeEta?: ResumeEta }
const details = store<{ details: Record<string, CardDetail> }>({ details: {} });
const detailsInflight = new Set<string>();

/** Load the details of the cards on screen (the lists come without them); each call reloads them, 50 a request. */
export async function loadDetails(ids: string[]): Promise<void> {
  const want = [...new Set(ids)].filter((id) => !detailsInflight.has(id));
  if (!want.length) return;
  want.forEach((id) => detailsInflight.add(id));
  try {
    const chunks = Array.from({ length: Math.ceil(want.length / 50) }, (_, i) => want.slice(i * 50, i * 50 + 50));
    await Promise.all(chunks.map(async (chunk) => {
      const r = await getJson<{ details: Record<string, CardDetail> }>(`/applications/review-queue?view=details&ids=${chunk.map(encodeURIComponent).join(",")}`);
      details.set({ details: { ...details.get().details, ...r.details } });
    }));
  } catch { /* the badges show "—" until the next load */ }
  finally { want.forEach((id) => detailsInflight.delete(id)); }
}

export function useCardDetails(): Record<string, CardDetail> {
  return useSyncExternalStore(details.subscribe, details.get).details;
}
