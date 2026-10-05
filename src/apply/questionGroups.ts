import { proposalText, reviewCategory, type PendingQ } from "./engine";
import type { UnansweredApp } from "./reviewQueue";

// To answer groups the questions nobody has answered yet: the same question asked by several jobs is one row,
// answered once. Resume-type fields (Atriveo Fill copies them from your resume on the page) and optional
// questions don't hold an application back; only `blocking` questions keep it off Open & Fill.

/** Nothing to start from: no answer, suggestion or draft. Attachments and unreadable fields are left to the page. */
export function needsYourAnswer(q: PendingQ): boolean {
  return reviewCategory(q) === "needs_input" && !proposalText(q).trim() && !q.userDraft?.trim() && !q.openEndedUserReview?.draftAnswer?.trim();
}

/** Work history and education: Atriveo Fill copies these from your resume on the job page. */
const RESUME_FIELD = /^(company( name)?|employer|(job )?title|start date( month| year)?|end date( month| year)?|current (role|job)|education( history)?|school( name)?|university|degree|discipline|field of study|major)\s*\*?$/i;
export const isResumeField = (q: PendingQ) => RESUME_FIELD.test(q.label.trim());

/** A question that keeps the application from Open & Fill until you answer it. */
export const blocking = (q: PendingQ) => needsYourAnswer(q) && q.required && !isResumeField(q);
/** Shown on To answer: blocking ones, and optional ones when you ask for them. */
export const shownHere = (q: PendingQ, optional: boolean) => needsYourAnswer(q) && !isResumeField(q) && (q.required || optional);

/** Questions worded differently by each company that mean the same thing (answered with one value). */
const FAMILIES: Array<[RegExp, string]> = [
  [/\b(how|where) did you (first )?(hear|learn|find out|find)\b|\bhow did you find (us|this)\b|\b(referral|application) source\b|\bwhere did you see\b/i, "How did you hear about us?"],
  [/\bpronoun/i, "Pronouns"],
  [/\b(race|ethnic)/i, "Race / ethnicity"],
  [/\bgender\b/i, "Gender"],
  [/\bveteran\b/i, "Veteran status"],
  [/\bdisabilit/i, "Disability"],
  [/\b(salary|compensation|pay) (expectation|requirement|range)|\bexpected (salary|compensation)\b|\bdesired (salary|compensation)\b/i, "Salary expectations"],
  [/\b(require|need)s? (visa )?sponsorship\b|\bsponsorship\b/i, "Will you need sponsorship?"],
  [/\b(legally )?authori[sz]ed to work\b|\bwork authori[sz]ation\b/i, "Work authorization"],
  [/\blinkedin\b/i, "LinkedIn"],
  [/\bgithub\b/i, "GitHub"],
  [/\b(twitter|x\.com)\b/i, "Twitter / X"],
  [/\btelegram\b/i, "Telegram"],
  [/\b(portfolio|personal (web)?site|website)\b/i, "Website / portfolio"],
  [/\b(earliest|available) (start|to start)|\bwhen can you start\b|\bstart date availability\b/i, "When can you start?"],
  [/\b(relocat)/i, "Open to relocation?"],
];

export type GroupKind = "text" | "choice" | "check";
const kindOf = (q: PendingQ): GroupKind => q.type === "checkbox" ? "check" : (q.optionCount ?? q.options.length) > 0 ? "choice" : "text";
const norm = (s: string) => s.toLowerCase().replace(/\(.*?(select|apply|choose).*?\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The same question across jobs: the family it belongs to, or its wording without the company's name. */
export function groupKey(q: PendingQ, company: string): { key: string; label: string } {
  const kind = kindOf(q);
  const family = FAMILIES.find(([re]) => re.test(q.label));
  if (family) return { key: `${kind}:${family[1]}`, label: family[1] };
  let text = norm(q.label);
  for (const word of norm(company).split(" ").filter((w) => w.length > 2)) text = text.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  return { key: `${kind}:${text.replace(/\s+/g, " ").trim()}`, label: q.label.replace(/\s*\*$/, "") };
}

export interface Asked { app: UnansweredApp; q: PendingQ }
export interface Group { key: string; label: string; kind: GroupKind; asked: Asked[]; required: number; choices: string[] }

/** Questions shown here, grouped across applications; most-asked first. */
export function buildGroups(apps: UnansweredApp[], optional: boolean): Group[] {
  const groups = new Map<string, Group>();
  for (const app of apps) {
    for (const q of app.questions) {
      if (!shownHere(q, optional)) continue;
      // A list too long to send up front is answered on its own (its choices load with the field).
      const long = (q.optionCount ?? q.options.length) > q.options.length;
      const { key, label } = long ? { key: `long:${app.id}:${q.fieldKey ?? q.fingerprint}`, label: q.label } : groupKey(q, app.company);
      const g = groups.get(key) ?? { key, label, kind: kindOf(q), asked: [], required: 0, choices: [] };
      g.asked.push({ app, q });
      if (q.required) g.required += 1;
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    const freq = new Map<string, number>();
    for (const { q } of g.asked) for (const o of new Set(q.options)) freq.set(o, (freq.get(o) ?? 0) + 1);
    g.choices = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([o]) => o);
  }
  return [...groups.values()].sort((a, b) => b.asked.length - a.asked.length || b.required - a.required || a.label.localeCompare(b.label));
}

/** This question's own value for an answer given to the group: its matching choice, or null when none fits. */
export function valueFor(q: PendingQ, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (q.type === "checkbox") return v === "true" || v === "false" ? v : null;
  if (!q.options.length) return (q.optionCount ?? 0) > 0 ? null : v;
  const n = norm(v);
  return q.options.find((o) => o === v) ?? q.options.find((o) => norm(o) === n)
    ?? q.options.find((o) => norm(o).startsWith(n) || (n.length > 3 && norm(o).includes(n)))
    ?? q.options.find((o) => norm(o).length > 3 && n.includes(norm(o))) ?? null;
}
