// Canonical event types for the AC learning system.
// The event log is the source of truth; all aggregates are replay projections.

export const EVENT_TYPES = [
  "resume_generated",
  "planner_decision",
  "coverage_gap",
  "librarian_suggestion",
  "market_observation",
  "benchmark_result",
  "application_outcome",
  "promotion",
  "rejection",
  "simulation_run",
  "regret_analysis",
];

export const REWARD_WEIGHTS = {
  ats: 0.15,
  human_readability: 0.25,
  coverage: 0.20,
  real_outcome: 0.40,
};

export const DEFAULT_DECAY_LAMBDA = 0.01; // ~37% weight at 100 days

export function createEvent(type, payload, meta = {}) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Unknown event type: ${type}`);
  }
  return {
    schema_version: 1,
    type,
    ts: meta.ts || new Date().toISOString(),
    id: meta.id,
    correlation_id: meta.correlation_id || null,
    source: meta.source || null,
    planner_version: meta.planner_version || "v1",
    payload,
  };
}

export function correlationId(prefix = "resume") {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`;
}

export function eventAgeDays(event, now = Date.now()) {
  const ts = Date.parse(event.ts || "");
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, (now - ts) / 86_400_000);
}

export function decayWeight(event, lambda = DEFAULT_DECAY_LAMBDA, now = Date.now()) {
  return Math.exp(-lambda * eventAgeDays(event, now));
}

export function computeReward({
  ats = null,
  humanReadability = null,
  coverage = null,
  outcome = null,
} = {}) {
  const outcomeScore = outcomeScoreFromPipeline(outcome);
  const parts = {
    ats: normalizeScore(ats),
    human_readability: normalizeScore(humanReadability, 10),
    coverage: normalizeScore(coverage),
    real_outcome: outcomeScore,
  };
  const reward = (
    REWARD_WEIGHTS.ats * parts.ats
    + REWARD_WEIGHTS.human_readability * parts.human_readability
    + REWARD_WEIGHTS.coverage * parts.coverage
    + REWARD_WEIGHTS.real_outcome * parts.real_outcome
  );
  return { reward: Number(reward.toFixed(4)), parts };
}

function normalizeScore(value, scale = 100) {
  if (value == null || Number.isNaN(Number(value))) return 0;
  const n = Number(value);
  return Math.max(0, Math.min(1, n / scale));
}

export function outcomeScoreFromPipeline(outcome = {}) {
  if (!outcome || typeof outcome !== "object") return 0;
  if (outcome.offer) return 1.0;
  if (outcome.interview) return 0.85;
  if (outcome.oa) return 0.65;
  if (outcome.recruiter_reply) return 0.45;
  if (outcome.viewed) return 0.25;
  if (outcome.applied) return 0.1;
  return 0;
}

export function pairKey(acA, acB) {
  return [acA, acB].sort().join("+");
}
