// Fit Score: how well the master resume (the whole AC bank) fits the untouched posting. This is the only entry point
// for Fit, and its signature takes no resume: a tailored resume, its headline or its bullets cannot reach the score.
import { loadAtsConfig, loadCandidate, withHash, sha256, canonicalJson } from "./config.mjs";
import { parseJobDescription } from "./jd-parse.mjs";
import { scoreJobMatch } from "./match.mjs";
import { keywordCoverage } from "./evidence.mjs";
import { evaluateKnockouts } from "./knockouts.mjs";
import { buildMaster } from "./master.mjs";

let defaults;
function context(overrides = {}) {
  defaults ??= (() => {
    const config = loadAtsConfig();
    // Repetition across a whole bank is not stuffing; that check belongs to one printed resume.
    const fitConfig = withHash({ ...structuredClone({ ...config, hash: undefined }), scoring: { ...structuredClone(config.scoring), job_match: { ...structuredClone(config.scoring.job_match), stuffing: { ...config.scoring.job_match.stuffing, warning_repetitions: 1e9, penalty: 0 } } } });
    const master = buildMaster();
    return { config: fitConfig, candidate: loadCandidate(), master, masterHash: sha256(canonicalJson(master)).slice(0, 16) };
  })();
  return { ...defaults, ...overrides };
}
export const resetFitContext = () => { defaults = undefined; };

function confidenceOf(match, cfg) {
  const scored = match.skill_ledger.total.total + (match.categories.find((c) => c.key === "experience_alignment")?.items.length || 0);
  const w = match.applicable_weight;
  const level = w < cfg.low_below_applicable_weight || scored < cfg.low_below_scored_requirements ? "low"
    : w >= cfg.high_from_applicable_weight && scored >= cfg.high_from_scored_requirements ? "high" : "medium";
  const reasons = [];
  if (w < cfg.low_below_applicable_weight) reasons.push(`The posting gave us something to score for only ${w} of 100 points`);
  if (scored < cfg.low_below_scored_requirements) reasons.push(`Only ${scored} scorable requirement${scored === 1 ? "" : "s"} found`);
  return { level, applicable_weight: w, scored_requirements: scored, reasons };
}

export function scoreFit(jdText, { title = null, asOf = new Date().toISOString().slice(0, 10), ...overrides } = {}) {
  const { config, candidate, master, masterHash } = context(overrides);
  if (!String(jdText || "").trim()) return { score: null, note: "No job description" };
  const jd = parseJobDescription(jdText, config);
  if (title) jd.title = title;
  if (!jd.required.length && !jd.preferred.length && !jd.responsibilities.length && !jd.unparsed.length && !jd.degree && !jd.years) {
    return { score: null, note: "Requirements were not recognized in this posting" };
  }
  const match = scoreJobMatch(master, jd, config, { asOf, fit: true, candidate });
  const ledger = match.skill_ledger;
  const labels = new Set(ledger.skills.flatMap((s) => [s.label, ...s.alternatives].map((x) => x.toLowerCase())));
  const mentioned = keywordCoverage(jdText, "", config).map((k) => k.name).filter((n) => !labels.has(n.toLowerCase()));
  return {
    kind: "fit", score: match.score, config_hash: config.hash, master_hash: masterHash, as_of: asOf,
    confidence: confidenceOf(match, config.scoring.fit.confidence),
    ledger: { ...ledger, mentioned },
    knockouts: evaluateKnockouts({ jd, jdText, ledger, years: match.years_experience, candidate, master, config }),
    categories: match.categories, not_applicable: match.not_applicable, unknown_requirements: match.unknown_requirements,
    accounting: match.accounting, recommendations: match.recommendations, coverage: match.coverage,
    note: "Fit compares your whole bank with the posting. It never reads a tailored resume.",
  };
}
