// Fit Score: how well the master resume (the whole AC bank) fits the untouched posting. This is the only entry point
// for Fit, and its signature takes no resume: a tailored resume, its headline or its bullets cannot reach the score.
import { loadAtsConfig, loadCandidate, withHash, sha256, canonicalJson } from "./config.mjs";
import { parseJobDescription, normalizeJobDescription } from "./jd-parse.mjs";
import { scoreJobMatch, familyFor } from "./match.mjs";
import { keywordCoverage } from "./evidence.mjs";
import { evaluateKnockouts } from "./knockouts.mjs";
import { buildMaster } from "./master.mjs";

let defaults;
function context(overrides = {}) {
  defaults ??= (() => {
    const config = loadAtsConfig();
    // Repetition across a whole bank is not stuffing; that check belongs to one printed resume.
    const fitConfig = withHash({ ...structuredClone({ ...config, hash: undefined }), scoring: { ...structuredClone(config.scoring), job_match: { ...structuredClone(config.scoring.job_match), stuffing: { ...config.scoring.job_match.stuffing, warning_repetitions: 1e9, penalty: 0 }, depth: config.scoring.fit.depth } } });
    const master = buildMaster();
    return { config: fitConfig, candidate: loadCandidate(), master, masterHash: sha256(canonicalJson(master)).slice(0, 16) };
  })();
  return { ...defaults, ...overrides };
}
/** What a saved Fit was computed with: when either changes, a saved Fit is stale and is recomputed. */
// Bump when the stored shape or extraction semantics change (5: evidence validity, coverage-aware confidence and requirement-only scoring).
export const fitIdentity = () => { const c = context(); return { config_hash: c.config.hash, master_hash: c.masterHash, candidate_hash: sha256(canonicalJson(c.candidate)).slice(0, 16), shape: 5 }; };
export const resetFitContext = () => { defaults = undefined; };

function confidenceOf(match, cfg, { blank, unrecognized = [] }) {
  const scored = match.skill_ledger.total.total + (match.categories.find((c) => c.key === "experience_alignment")?.items.length || 0);
  const w = match.applicable_weight;
  const lowReasons = [];
  if (blank) lowReasons.push("No job description was saved; scored from the title alone");
  if (!match.skill_ledger.total.total) lowReasons.push("No skills found to compare");
  if (w < cfg.low_below_applicable_weight) lowReasons.push(`The posting gave us something to score for only ${w} of 100 points`);
  if (scored < cfg.low_below_scored_requirements) lowReasons.push(`Only ${scored} scorable requirement${scored === 1 ? "" : "s"} found`);
  const reviewReasons = [];
  if (match.unparsed_requirements.length) reviewReasons.push(`${match.unparsed_requirements.length} qualification lines need manual review; they were not fully assessed`);
  if (unrecognized.length) reviewReasons.push(`${unrecognized.length} requirement groups contain unrecognized technologies`);
  if (match.coverage.missing_job_title) reviewReasons.push("No job title was supplied for role alignment");
  const level = lowReasons.length ? "low" : !reviewReasons.length && w >= cfg.high_from_applicable_weight && scored >= cfg.high_from_scored_requirements ? "high" : "medium";
  return { level, applicable_weight: w, scored_requirements: scored, reasons: [...lowReasons, ...reviewReasons] };
}

// Only skills the dictionary knows are compared: a capitalized word the parser could not place ("Retail", "Government")
// is not a skill, and a requirement we cannot recognize is never held against you. They are listed, not scored.
function knownSkill(requirement, config) {
  const known = new Set(Object.entries(config.skills).flatMap(([name, skill]) => [name, ...(skill.variants || [])]).map((t) => t.toLowerCase()));
  return requirement.alternatives.some((a) => known.has(String(a).toLowerCase()));
}

export function scoreFit(jdText, { title = null, asOf = new Date().toISOString().slice(0, 10), ...overrides } = {}) {
  const { config, candidate, master, masterHash } = context(overrides);
  // Every job gets a Fit. When the posting says little, the number rests on less and Confidence says so.
  jdText = normalizeJobDescription(jdText);
  const blank = !String(jdText || "").trim();
  const jd = parseJobDescription(jdText || "", config);
  if (title) jd.title = title;
  const unrecognized = [...jd.required, ...jd.preferred].filter((r) => !knownSkill(r, config)).map((r) => r.label);
  jd.required = jd.required.filter((r) => knownSkill(r, config));
  jd.preferred = jd.preferred.filter((r) => knownSkill(r, config));
  // Unclassified employer/background mentions must never become requirements.
  const match = scoreJobMatch(master, jd, config, { asOf, fit: true, candidate });
  const ledger = match.skill_ledger;
  const labels = new Set(ledger.skills.flatMap((s) => [s.label, ...s.alternatives].map((x) => x.toLowerCase())));
  const mentioned = keywordCoverage(String(jdText || ""), "", config).map((k) => k.name).filter((n) => !labels.has(n.toLowerCase()));
  // Nothing in the posting points at a role family your bank supports and no skill matched: the number rests on soft
  // categories only. Shown as a tag; Fit itself is unchanged.
  const family = familyFor(jd.title, config.scoring.job_match.role);
  const outsideRoles = ledger.total.matched === 0 && !(family && master.families.includes(family));
  return {
    kind: "fit", outside_roles: outsideRoles, score: match.score, config_hash: config.hash, master_hash: masterHash, as_of: asOf,
    confidence: confidenceOf(match, config.scoring.fit.confidence, { blank, unrecognized }),
    ledger: { ...ledger, mentioned, unrecognized, unparsed: jd.unparsed },
    knockouts: evaluateKnockouts({ jd, jdText, ledger, years: match.years_experience, candidate, master, config }),
    categories: match.categories, not_applicable: match.not_applicable, unknown_requirements: match.unknown_requirements,
    accounting: match.accounting, recommendations: match.recommendations, coverage: match.coverage,
    note: "Fit compares your whole bank with the posting. It never reads a tailored resume.",
  };
}
