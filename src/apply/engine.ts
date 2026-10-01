import { getTailorServerBase } from "../utils/tailorServer";

// The application engine's dashboard API: the Mac sidecar, through the /tailor relay.

export type Scope = "application" | "company" | "global";

export const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** A question the engine could not answer, as it waits in review. */
export interface PendingQ {
  fingerprint: string; label: string; type: string; required: boolean; options: string[];
  /** How many choices the form offered; more than `options.length` when the list was too long to send up front. */
  optionCount?: number;
  canonicalKey: string | null; sensitive: string | null; reason: string; detail: string | null;
}

export async function postAction(body: object): Promise<{ ok: boolean; error?: string; requeued?: boolean }> {
  const res = await fetch(`${getTailorServerBase()}/applications/action`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return res.ok ? json : { ok: false, error: json.error || `HTTP ${res.status}` };
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${getTailorServerBase()}${path}`, { credentials: "include", cache: "no-store" });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
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

/** Consents and declarations the engine may not flag as sensitive; each is tied to its own wording. */
const DECLARATION = /acknowledg|privacy|consent|certif|attest|declar|\bagree|terms and conditions/i;

/** A readable, non-sensitive question that isn't a declaration: safe to remember widely or copy between forms. */
export function plainQuestion(q: PendingQ): boolean {
  return !q.sensitive && questionKind(q) === "question" && !DECLARATION.test(q.label);
}

/**
 * Where an answer is remembered unless you change it. Sensitive, unreadable and declaration
 * questions stay with this application; a question that names the company stays with the company.
 */
export function defaultScope(q: PendingQ, company: string): Scope {
  if (!plainQuestion(q)) return "application";
  const companyWord = company.toLowerCase().split(/\s+/)[0] ?? "";
  return companyWord && q.label.toLowerCase().includes(companyWord) ? "company" : "global";
}

/** The `answer` action's payload for one question; unreadable questions never leave this application. */
export function answerFor(q: PendingQ, value: string, scope: Scope) {
  return {
    fingerprint: q.fingerprint, label: q.label, type: q.type, canonicalKey: q.canonicalKey, sensitive: q.sensitive, value,
    scope: questionKind(q) === "unreadable" ? "application" : scope,
  };
}
