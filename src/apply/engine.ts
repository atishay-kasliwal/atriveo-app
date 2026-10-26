import { getTailorServerBase } from "../utils/tailorServer";

// The application engine's dashboard API: the Mac sidecar, through the /tailor relay.

export type Scope = "application" | "company" | "global";

export const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** A question the engine could not answer, as it waits in review. */
export interface PendingQ {
  answerProposal?: { state: "ready_for_review" | "needs_input" | "action_required"; answer?: string; family: string; source: string; reason: string; caution?: string; provenance?: unknown } | null;
  suggestedAnswer?: string;
  questionFamily?: string | null;
  selectedStory?: string;
  suggestionReason?: string;
  userDraft?: string | null;
  userDraftAction?: "edited" | "replaced";
  reviewStatus?: "suggested" | "draft" | "approved" | "rejected" | "none";
  fieldKey?: string | null;
  fingerprint: string; label: string; type: string; required: boolean; options: string[];
  /** How many choices the form offered; more than `options.length` when the list was too long to send up front. */
  optionCount?: number;
  canonicalKey: string | null; sensitive: string | null; reason: string; detail: string | null;
  openEndedAssessment?: { questionFamily: string | null; familyConfidence: number; storyConfidence: number; selectedStory: string | null; reason: string } | null;
  openEndedSuggestion?: { suggestedAnswer: string; confidenceBand: "high" | "medium"; selectedStory: string; matchedSignals?: string[] } | null;
  openEndedUserReview?: { generatedBy?: "muse"; sources?: string[]; missingFacts?: string[]; status: "draft" | "approved" | "rejected"; action: "edited" | "replaced" | "accepted" | "rejected"; draftAnswer?: string } | null;
}

export async function postAction(body: object): Promise<{ ok: boolean; error?: string; url?: string; requeued?: boolean; resolved?: boolean; questionReviewStatus?: "open" | "complete"; updatedAt?: string; refreshed?: number; suggestions?: number; suggestionsAdded?: number; suggestionsChanged?: number; noSuggestion?: number }> {
  const res = await fetch(`${getTailorServerBase()}/applications/action`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? json : { ok: false, error: json.error || `HTTP ${res.status}` };
}

/**
 * fetch + JSON for the sidecar. The tunnel sometimes answers with an HTML error page (502/52x) when it could not reach the
 * server; the request never ran, so it is tried once more, and a page that still isn't JSON gives a plain message instead of
 * "Unexpected token '<'".
 */
export interface ApiBody { ok?: boolean; error?: string }
export async function fetchJson<T extends ApiBody = ApiBody>(url: string, init: RequestInit): Promise<{ res: Response; json: T }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    const type = res.headers.get("content-type") || "";
    const gateway = res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 520 && res.status <= 530) || !type.includes("json");
    if (gateway && !res.ok && attempt === 0) { await new Promise((r) => setTimeout(r, 600)); continue; }
    const json = (await res.json().catch(() => ({ ok: false, error: gateway ? "The server was briefly unreachable. Try again." : `HTTP ${res.status}` }))) as T;
    return { res, json };
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const { res, json } = await fetchJson<ApiBody>(`${getTailorServerBase()}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

/**
 * file: an attachment the engine could not add; nothing to type.
 * unreadable: the engine could not read the field's label ("(unlabeled select)", a bare "Yes").
 * question: a real question you can answer here.
 */
export type QuestionKind = "file" | "unreadable" | "question";

const UNREADABLE = /^(?:unlabeled\b.*|yes|no|type your response|select|choose|answer|please select)?$/i;

export function questionKind(q: Pick<PendingQ, "label" | "type">): QuestionKind {
  if (q.type === "file") return "file";
  return UNREADABLE.test(q.label.replace(/[()*:]/g, " ").replace(/\s+/g, " ").trim()) ? "unreadable" : "question";
}

/**
 * Where an answer is remembered unless you change it. Sensitive, unreadable and declaration
 * questions stay with this application; a question that names the company stays with the company.
 */
export function defaultScope(q: PendingQ, company: string): Scope {
  void q; void company;
  return "application";
}


/** The `answer` action's payload for one question; unreadable questions never leave this application. */
export function answerFor(q: PendingQ, value: string, scope: Scope) {
  return {
    fingerprint: q.fingerprint, label: q.label, type: q.type, canonicalKey: q.canonicalKey, sensitive: q.sensitive, value,
    scope: questionKind(q) === "unreadable" ? "application" : scope,
  };
}
