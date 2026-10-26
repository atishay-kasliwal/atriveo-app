// Fit kept on the job document (jobs.fit), so the Matching queue can sort by it and every page reads the same
// numbers. Computed from the master resume and the untouched posting only: a saved Fit goes stale when the scoring
// config or the bank changes (fitIdentity) and is then recomputed.
import { scoreFit, fitIdentity } from "./ats/fit.mjs";

/** The small, storable shape of a Fit result (the full result carries every scored row). */
export function compactFit(result, { jdChars = null } = {}) {
  const l = result.ledger;
  return {
    score: result.score, coverage: result.coverage, confidence: result.confidence.level, confidence_reasons: result.confidence.reasons, applicable_weight: result.confidence.applicable_weight,
    outside_roles: Boolean(result.outside_roles),
    knockouts: { verdict: result.knockouts.verdict, items: result.knockouts.items },
    ledger: {
      required: l.required, preferred: l.preferred, total: l.total, matched: l.matched, partial: l.partial, missing: l.missing,
      mentioned: l.mentioned, unrecognized: l.unrecognized, unparsed: l.unparsed,
      // `evidence` is the bank bullet (or tools line) that proves a matched skill: Resume Ready uses it to say what to add.
      skills: l.skills.map((s) => ({ label: s.label, alternatives: s.alternatives, class: s.class, status: s.status, source: s.source ?? null,
        ...(s.evidence ? { evidence: { entry: s.evidence_entry ?? null, text: s.evidence, tier: s.evidence_tier ?? null } } : {}) })),
    },
    lost: result.categories.flatMap((c) => c.items.filter((i) => i.lost > 0).map((i) => ({ category: c.key, requirement: i.label, source: i.source ?? null, lost: i.lost }))).sort((a, b) => b.lost - a.lost).slice(0, 5),
    ...fitIdentity(), jd_chars: jdChars, as_of: result.as_of,
  };
}

// `id` lets a caller checking many Fits hash the bank once instead of once per job (it is ~0.1 ms each).
export const fitIsCurrent = (fit, id = fitIdentity()) => {
  if (!fit || (fit.score !== null && typeof fit.score !== "number")) return false;
  return fit.config_hash === id.config_hash && fit.master_hash === id.master_hash && fit.candidate_hash === id.candidate_hash && fit.shape === id.shape
    && fit.as_of?.slice(0, 7) === new Date().toISOString().slice(0, 7);
};

/** Fit for one posting, in the storable shape. */
export function computeFit(jdText, title) {
  const r = scoreFit(jdText, { title });
  return compactFit(r, { jdChars: String(jdText || "").length });
}

/**
 * Make sure up to `max` of these job documents carry a current Fit, saving each to jobs.fit. Returns url -> fit for every
 * document that has one afterwards. A failure to save never fails the caller (the Fit is still returned).
 */
export async function ensureFit(db, docs, { max = 40, budgetMs = Infinity } = {}) {
  const have = new Map();
  const stale = [];
  const id = fitIdentity();
  for (const d of docs) {
    if (fitIsCurrent(d.fit, id)) have.set(d.job_url, d.fit);
    else stale.push(d);
  }
  const todo = stale.slice(0, max);
  if (!todo.length || budgetMs <= 0) return have;
  const rows = await db.collection("descriptions").find({ job_url: { $in: todo.map((d) => d.job_url) } }, { projection: { _id: 0, job_url: 1, description: 1 } }).toArray();
  const jd = new Map(rows.map((r) => [r.job_url, r.description]));
  const writes = [];
  // A Fit takes ~200 ms of CPU; with `budgetMs` the caller gets what was done in that time and the rest stay missing.
  const started = Date.now();
  for (const d of todo) {
    if (Date.now() - started >= budgetMs) break;
    const text = jd.get(d.job_url);
    if (!text && d.fit) { have.set(d.job_url, d.fit); continue; } // no posting text now; keep what we had
    const fit = computeFit(text ?? "", d.title);
    have.set(d.job_url, fit);
    writes.push({ updateOne: { filter: { job_url: d.job_url }, update: { $set: { fit } } } });
  }
  try { if (writes.length) await db.collection("jobs").bulkWrite(writes, { ordered: false }); } catch { /* the Fit is still used for this request */ }
  return have;
}
