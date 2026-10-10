// Bank page phase 3 (docs/bank-page.md): you give the number or result a bullet was missing; it's kept as your fact,
// Claude (your Mac AI worker, as the resume builder's AI uses) drafts new wordings from that bullet's facts only, each
// draft goes through the builder's rules and a number check (every number must come from your facts), and the one you
// pick replaces the wording with its rubric score. Facts, rewords and scores are overlay entries until bank:export.

import crypto from "node:crypto";
import { loadBank } from "./ac-bank.mjs";
import { OVERLAY_COLLECTION, syncOverlay } from "./ac-bank-overlay.mjs";
import { BankPageError, bankView } from "./bank-page.mjs";
import { checkText, freeVerbs, saveBullet } from "./resume-builder.mjs";
import { queueInference } from "./resume-ai-queue.mjs";
import { AI_PROVIDERS, subscriptionGenerate } from "./resume-ai-provider.mjs";

export const DRAFT_COLLECTION = "bank_drafts";
const RUBRIC = { impact: 3, specificity: 2, credibility: 2, clarity: 2, relevance: 1 };
const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** The numbers a text states ("10K+" → 10, "3,000" → 3000, "67.7%" → 67.7), for the no-invented-numbers check. */
export function numbersIn(text) {
  return [...String(text).replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(Number(m[0])));
}

/** Numbers in a draft that none of the sources state: a draft with any of them is not offered. */
export function inventedNumbers(draft, sources) {
  const known = new Set(sources.flatMap(numbersIn));
  return [...new Set(numbersIn(draft).filter((n) => !known.has(n)))];
}

/** The rubric total, each part clamped to its maximum (impact 3, specificity 2, credibility 2, clarity 2, relevance 1). */
export function rubricScore(parts = {}) {
  return Object.entries(RUBRIC).reduce((n, [k, max]) => n + Math.max(0, Math.min(max, Math.round(Number(parts[k]) || 0))), 0);
}

/** Your facts for an entry (overlay `fact` entries), oldest first. */
async function factsFor(db, acId) {
  return db.collection(OVERLAY_COLLECTION).find({ type: "fact", ac_id: acId }).sort({ createdAt: 1 }).toArray();
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["drafts"],
  properties: {
    drafts: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object", additionalProperties: false, required: ["text", "score", "why"],
        properties: {
          text: { type: "string" },
          why: { type: "string" },
          score: { type: "object", additionalProperties: false, required: Object.keys(RUBRIC), properties: Object.fromEntries(Object.keys(RUBRIC).map((k) => [k, { type: "integer" }])) },
        },
      },
    },
  },
};

const SYSTEM = `You rewrite one resume bullet for Atishay Kasliwal's resume bank. Use only the facts given: never add a number,
result, user count, technology, employer or claim that the facts don't state. Rules:
- One sentence, 18 to 35 words, at most 2 commas and 2 "and"s, at most 3 technologies.
- Start with a past-tense action verb from the free verbs given (or the current opening verb), never Built, Developed or Trained.
- Lead with what changed (the result), then what was built; one strongest metric.
- No puffery (modern, advanced, innovative, cutting-edge, cloud-native, robust, seamless).
- Stony Brook bullets never use the word "research" (or "researchers"). Wake Forest bullets name no cloud provider.
- Personal projects never say "in production". Simulated data must be called simulated.
- Work done with a teammate keeps "with a teammate".
Score each draft honestly on this rubric (integers): impact 0-3 (a real result), specificity 0-2, credibility 0-2,
clarity 0-2, relevance 0-1. Without a real result, impact is at most 1. Never inflate. Give 2 drafts, each with a one-line why.`;

/** Start drafting: your fact is saved now (it's true whatever wording uses it); drafts arrive on the job. */
export async function startDraft(db, { acId, facet, fact, provider = process.env.RESUME_AI_PROVIDER || "claude" } = {}, { generate } = {}) {
  const text = norm(fact);
  if (!text) throw new BankPageError("Write the number or result first.");
  if (text.length > 600) throw new BankPageError("Keep the fact under 600 characters.");
  if (!AI_PROVIDERS.includes(provider)) throw new BankPageError("Choose Claude, Codex, or Claude + Codex.");
  await syncOverlay(db);
  const bank = loadBank();
  const ac = bank.acs.find((a) => a.id === acId);
  const v = ac?.variants?.find((x) => (x.facet ?? "default") === facet);
  if (!ac || !v) throw new BankPageError(`${acId} has no wording "${facet}".`);
  const at = new Date();
  const factId = `fact:${acId}:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
  await db.collection(OVERLAY_COLLECTION).updateOne({ _id: factId }, { $set: { type: "fact", ac_id: acId, facet, text, updatedAt: at.toISOString() }, $setOnInsert: { createdAt: at.toISOString() } }, { upsert: true });
  await syncOverlay(db);
  const id = crypto.randomUUID();
  await db.collection(DRAFT_COLLECTION).insertOne({ _id: id, status: "running", acId, facet, provider, createdAt: at, expiresAt: new Date(at.getTime() + 86_400_000) });
  generate = generate || ((request) => (process.env.RESUME_AI_REMOTE_WORKER === "mac" ? queueInference(db, provider, request) : subscriptionGenerate(provider, request)));
  // In the background: the page polls draftResult.
  void draftFor(db, { ac, v, bank, generate }).then(
    (drafts) => db.collection(DRAFT_COLLECTION).updateOne({ _id: id }, { $set: { status: "done", drafts, updatedAt: new Date() } }),
    (e) => db.collection(DRAFT_COLLECTION).updateOne({ _id: id }, { $set: { status: "failed", error: String(e.message || e).slice(0, 500), updatedAt: new Date() } }),
  ).catch(() => {});
  return { ok: true, id };
}

/** The model request for new wordings of variant v of entry ac, from its facts and yours ({ request, sources }). */
export function draftRequest(ac, v, facts, bank) {
  const sources = [ac.fact, ...facts, ...(ac.variants || []).map((x) => x.text), ...(v.earlier_texts || [])].filter(Boolean);
  const user = JSON.stringify({
    employer_or_project: ac.role, theme: ac.achievement_theme, current_wording: norm(v.text),
    what_it_was_missing: v.strength_note || null, entry_fact: ac.fact || null, your_facts: facts,
    other_wordings_of_this_entry: (ac.variants || []).filter((x) => x !== v).map((x) => norm(x.text)),
    free_opening_verbs: freeVerbs(bank, 20),
  }, null, 2);
  return { request: { purpose: "bank-draft", system: SYSTEM, user, schema: SCHEMA }, sources };
}

/** Each draft with its score and what's wrong with it (the builder's rules, and numbers none of the sources give). */
export function checkDrafts(result, ac, v, sources, bank) {
  const drafts = Array.isArray(result?.drafts) ? result.drafts : [];
  if (!drafts.length) throw new Error("No drafts came back. Try again.");
  const facet = v.facet ?? "default";
  return drafts.slice(0, 3).map((d) => {
    const text = norm(d.text);
    const invented = inventedNumbers(text, sources);
    const issues = [...checkText(ac.role, text, bank, { acId: ac.id }), ...(invented.length ? [`states ${invented.join(", ")}, which none of your facts give`] : [])];
    return { text, why: norm(d.why).slice(0, 300), parts: d.score, strength: rubricScore(d.score), issues, facet };
  });
}

async function draftFor(db, { ac, v, bank, generate }) {
  const facts = (await factsFor(db, ac.id)).map((f) => f.text);
  const { request, sources } = draftRequest(ac, v, facts, bank);
  return checkDrafts(await generate(request), ac, v, sources, bank);
}

/** The draft job: running, done (drafts with their rule check and score) or failed. */
export async function draftResult(db, { id } = {}) {
  const row = await db.collection(DRAFT_COLLECTION).findOne({ _id: String(id || "") });
  if (!row) throw new BankPageError("That draft has expired. Draft again.");
  const worker = await db.collection("resume_ai_worker").findOne({ _id: "mac" });
  return { ok: true, status: row.status, drafts: row.drafts ?? [], error: row.error ?? null, workerOnline: Boolean(worker && Date.now() - new Date(worker.at).getTime() < 60_000) };
}

/**
 * Use a draft: it replaces the wording for every future resume (the builder's reword save, which re-checks the rules)
 * and its rubric score replaces the old one, clearing the "missing" note. The number check runs again here.
 */
export async function approveDraft(db, { acId, facet, text, parts } = {}) {
  await syncOverlay(db);
  const bank = loadBank();
  const ac = bank.acs.find((a) => a.id === acId);
  const v = ac?.variants?.find((x) => (x.facet ?? "default") === facet);
  if (!ac || !v) throw new BankPageError(`${acId} has no wording "${facet}".`);
  const facts = (await factsFor(db, acId)).map((f) => f.text);
  const invented = inventedNumbers(text, [ac.fact, ...facts, ...(ac.variants || []).map((x) => x.text), ...(v.earlier_texts || [])].filter(Boolean));
  if (invented.length) throw new BankPageError(`Not saved: it states ${invented.join(", ")}, which none of your facts give.`);
  await saveBullet(db, { role: ac.role, text, mode: "reword", acId, facet });
  const strength = rubricScore(parts);
  const at = new Date().toISOString();
  await db.collection(OVERLAY_COLLECTION).updateOne({ _id: `score:${acId}:${facet}` },
    { $set: { type: "score", ac_id: acId, facet, strength, note: strength >= 9 ? null : "Still under 9: what else changed because of this work?", parts, updatedAt: at }, $setOnInsert: { createdAt: at } }, { upsert: true });
  await syncOverlay(db);
  return bankView();
}
