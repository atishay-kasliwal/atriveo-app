// Replay projector: derives all aggregates from the canonical event log.
// Re-run anytime aggregation logic changes — never treat aggregates as source of truth.

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DECAY_LAMBDA,
  decayWeight,
  computeReward,
  pairKey,
} from "./ac-events.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
export const LEARNING_DIR = path.join(ROOT, "data", "ac-learning");
export const EVENTS_PATH = path.join(LEARNING_DIR, "events.jsonl");
export const SNAPSHOT_DIR = path.join(LEARNING_DIR, "projections");

const DUPLICATE_STORY_PAIRS = [
  ["AC-001", "AC-002"],
  ["AC-010", "AC-027"],
];

function incWeighted(map, key, amount, weight) {
  if (!key) return;
  if (!map[key]) map[key] = { count: 0, weight: 0 };
  map[key].count += amount;
  map[key].weight += weight * amount;
}

function topWeighted(map, limit = 20) {
  return Object.entries(map)
    .map(([key, meta]) => ({
      key,
      count: meta.count,
      weighted_count: Number(meta.weight.toFixed(3)),
    }))
    .sort((a, b) => b.weighted_count - a.weighted_count)
    .slice(0, limit);
}

function suggestionKey(ac, suggestion) {
  return `${ac}|${suggestion}`;
}

export function readEvents({ since = null, types = null } = {}) {
  if (!fs.existsSync(EVENTS_PATH)) return [];
  const lines = fs.readFileSync(EVENTS_PATH, "utf8").trim().split("\n").filter(Boolean);
  let events = lines.map((line) => JSON.parse(line));
  if (since) events = events.filter((event) => event.ts >= since);
  if (types?.length) events = events.filter((event) => types.includes(event.type));
  return events;
}

function linkOutcomeToResume(events) {
  const resumes = new Map();
  for (const event of events) {
    if (event.type === "resume_generated" || event.type === "benchmark_result") {
      resumes.set(event.correlation_id, event);
    }
  }
  return resumes;
}

export function replayProject(events, { decayLambda = DEFAULT_DECAY_LAMBDA, now = Date.now() } = {}) {
  const state = {
    event_count: events.length,
    missing_supported: {},
    unclaimable: {},
    ac_selection: {},
    ac_stats: {},
    pair_synergy: {},
    rejection_reasons: {},
    unused_better: {},
    authoring_suggestions: {},
    deduction_by_type: {},
    career_signals: {},
    planner_versions: {},
    outcomes_logged: 0,
    regrets: {},
    rewards: [],
  };

  const resumeByCorrelation = linkOutcomeToResume(events);
  const outcomeByCorrelation = new Map();

  for (const event of events) {
    const w = decayWeight(event, decayLambda, now);
    const payload = event.payload || {};

    switch (event.type) {
      case "planner_decision": {
        for (const ac of payload.selected || []) {
          incWeighted(state.ac_selection, ac.ac_id, 1, w);
          state.ac_stats[ac.ac_id] = state.ac_stats[ac.ac_id] || {
            selected: 0,
            weighted_selected: 0,
            ats_sum: 0,
            ats_n: 0,
            human_sum: 0,
            human_n: 0,
            interview_hits: 0,
            offer_hits: 0,
            outcome_n: 0,
          };
          state.ac_stats[ac.ac_id].selected += 1;
          state.ac_stats[ac.ac_id].weighted_selected += w;
        }
        for (const rej of payload.rejected || []) {
          const reason = rej.reason || "not_selected";
          incWeighted(state.rejection_reasons, `${rej.ac_id}:${reason}`, 1, w);
        }
        break;
      }

      case "coverage_gap": {
        const keyword = payload.keyword;
        if (payload.gap_type === "missing_claimable") incWeighted(state.missing_supported, keyword, 1, w);
        if (payload.gap_type === "unclaimable") incWeighted(state.unclaimable, keyword, 1, w);
        break;
      }

      case "librarian_suggestion": {
        const key = suggestionKey(payload.ac, payload.suggestion);
        state.authoring_suggestions[key] = state.authoring_suggestions[key] || {
          ac: payload.ac,
          suggestion: payload.suggestion,
          frequency: 0,
          weighted_frequency: 0,
          latest_rationale: "",
        };
        state.authoring_suggestions[key].frequency += 1;
        state.authoring_suggestions[key].weighted_frequency += w;
        if (payload.rationale) state.authoring_suggestions[key].latest_rationale = payload.rationale;
        break;
      }

      case "market_observation": {
        for (const row of payload.frequency || []) {
          incWeighted(state.career_signals, row.term, row.count || 1, w);
        }
        break;
      }

      case "benchmark_result": {
        const plannerVersion = event.planner_version || payload.planner_version || "v1";
        state.planner_versions[plannerVersion] = state.planner_versions[plannerVersion] || {
          runs: 0,
          weighted_runs: 0,
          ats_sum: 0,
          reward_sum: 0,
        };
        state.planner_versions[plannerVersion].runs += 1;
        state.planner_versions[plannerVersion].weighted_runs += w;
        if (payload.scores?.final_score != null) {
          state.planner_versions[plannerVersion].ats_sum += payload.scores.final_score * w;
        }
        if (payload.reward?.reward != null) {
          state.planner_versions[plannerVersion].reward_sum += payload.reward.reward * w;
          state.rewards.push({ ts: event.ts, reward: payload.reward.reward, weight: w });
        }
        for (const item of payload.scores?.deductions || []) {
          incWeighted(state.deduction_by_type, item.type, 1, w);
        }
        for (const candidate of payload.unused_better_candidates || []) {
          incWeighted(state.unused_better, candidate.ac_id, 1, w);
        }
        const selected = payload.selected_acs || [];
        const rewardVal = payload.reward?.reward ?? (payload.scores?.final_score || 0) / 100;
        for (let i = 0; i < selected.length; i += 1) {
          for (let j = i + 1; j < selected.length; j += 1) {
            const key = pairKey(selected[i], selected[j]);
            state.pair_synergy[key] = state.pair_synergy[key] || { reward_sum: 0, weight: 0, count: 0 };
            state.pair_synergy[key].reward_sum += rewardVal * w;
            state.pair_synergy[key].weight += w;
            state.pair_synergy[key].count += 1;
          }
        }
        for (const acId of selected) {
          if (!state.ac_stats[acId]) {
            state.ac_stats[acId] = {
              selected: 0, weighted_selected: 0, ats_sum: 0, ats_n: 0,
              human_sum: 0, human_n: 0, interview_hits: 0, offer_hits: 0, outcome_n: 0,
            };
          }
          if (payload.scores?.final_score != null) {
            state.ac_stats[acId].ats_sum += payload.scores.final_score * w;
            state.ac_stats[acId].ats_n += w;
          }
          if (payload.scores?.readability != null) {
            state.ac_stats[acId].human_sum += payload.scores.readability * w;
            state.ac_stats[acId].human_n += w;
          }
        }
        for (const [a, b] of DUPLICATE_STORY_PAIRS) {
          if (selected.includes(a) && selected.includes(b)) {
            const key = pairKey(a, b);
            state.pair_synergy[key] = state.pair_synergy[key] || { reward_sum: 0, weight: 0, count: 0 };
            state.pair_synergy[key].reward_sum += -0.07 * w;
            state.pair_synergy[key].weight += w;
            state.pair_synergy[key].count += 1;
          }
        }
        break;
      }

      case "application_outcome": {
        state.outcomes_logged += 1;
        outcomeByCorrelation.set(event.correlation_id, payload);
        const selected = payload.selected_acs || [];
        for (const acId of selected) {
          if (!state.ac_stats[acId]) continue;
          state.ac_stats[acId].outcome_n += w;
          if (payload.outcome?.interview) state.ac_stats[acId].interview_hits += w;
          if (payload.outcome?.offer) state.ac_stats[acId].offer_hits += w;
        }
        break;
      }

      case "simulation_run": {
        const version = payload.planner_version || event.planner_version || "v1";
        state.planner_versions[version] = state.planner_versions[version] || {
          runs: 0, weighted_runs: 0, ats_sum: 0, reward_sum: 0, oracle_sum: 0,
        };
        state.planner_versions[version].runs += 1;
        state.planner_versions[version].weighted_runs += w;
        if (payload.oracle?.oracle_score != null) {
          state.planner_versions[version].oracle_sum += payload.oracle.oracle_score * w;
          state.planner_versions[version].ats_sum += (payload.oracle.components?.ats || 0) * w;
        }
        break;
      }

      case "regret_analysis": {
        const key = `${payload.from_ac}->${payload.to_ac}`;
        incWeighted(state.regrets, key, 1, w);
        break;
      }

      case "promotion":
      case "rejection":
        break;

      // Legacy events (pre event-sourcing migration) — still replay correctly
      case "compose_run": {
        const legacySelected = event.selected_acs || [];
        for (const acId of legacySelected) incWeighted(state.ac_selection, acId, 1, w);
        for (const keyword of event.analyst_signals?.missing_but_supported || []) {
          incWeighted(state.missing_supported, keyword, 1, w);
        }
        for (const keyword of event.planner_metrics?.unsupported || []) {
          incWeighted(state.unclaimable, keyword, 1, w);
        }
        if (event.scores?.final_score != null) {
          const version = event.planner_version || "v1";
        state.planner_versions[version] = state.planner_versions[version] || {
          runs: 0, weighted_runs: 0, ats_sum: 0, reward_sum: 0, oracle_sum: 0,
        };
          state.planner_versions[version].runs += 1;
          state.planner_versions[version].weighted_runs += w;
          state.planner_versions[version].ats_sum += event.scores.final_score * w;
        }
        break;
      }

      case "authoring_suggestion": {
        const key = suggestionKey(event.ac, event.suggestion);
        state.authoring_suggestions[key] = state.authoring_suggestions[key] || {
          ac: event.ac,
          suggestion: event.suggestion,
          frequency: 0,
          weighted_frequency: 0,
          latest_rationale: "",
        };
        state.authoring_suggestions[key].frequency += 1;
        state.authoring_suggestions[key].weighted_frequency += w;
        if (event.rationale) state.authoring_suggestions[key].latest_rationale = event.rationale;
        break;
      }

      default:
        break;
    }
  }

  // Attach outcome rewards to resume correlations
  for (const [cid, outcomePayload] of outcomeByCorrelation) {
    const resume = resumeByCorrelation.get(cid);
    if (!resume) continue;
  }

  const deductionTotal = Object.values(state.deduction_by_type).reduce((s, v) => s + v.weight, 0) || 1;
  const deductionBreakdown = Object.entries(state.deduction_by_type).map(([type, meta]) => ({
    type,
    weighted_events: Number(meta.weight.toFixed(3)),
    pct_of_loss: Number(((meta.weight / deductionTotal) * 100).toFixed(1)),
  })).sort((a, b) => b.weighted_events - a.weighted_events);

  const authoringQueue = Object.values(state.authoring_suggestions)
    .sort((a, b) => b.weighted_frequency - a.weighted_frequency)
    .map((item) => ({
      ac: item.ac,
      suggestion: item.suggestion,
      frequency: item.frequency,
      weighted_frequency: Number(item.weighted_frequency.toFixed(3)),
      latest_rationale: item.latest_rationale,
    }));

  const acRatings = Object.entries(state.ac_stats).map(([acId, stats]) => ({
    ac_id: acId,
    selected: stats.selected,
    weighted_selected: Number(stats.weighted_selected.toFixed(3)),
    avg_ats: stats.ats_n ? Number((stats.ats_sum / stats.ats_n).toFixed(2)) : null,
    avg_human: stats.human_n ? Number((stats.human_sum / stats.human_n).toFixed(2)) : null,
    interview_rate: stats.outcome_n ? Number((stats.interview_hits / stats.outcome_n).toFixed(3)) : null,
    offer_rate: stats.outcome_n ? Number((stats.offer_hits / stats.outcome_n).toFixed(3)) : null,
  })).sort((a, b) => b.weighted_selected - a.weighted_selected);

  const pairStats = Object.entries(state.pair_synergy).map(([key, meta]) => ({
    pair: key,
    count: meta.count,
    avg_reward_delta: meta.weight ? Number((meta.reward_sum / meta.weight).toFixed(3)) : 0,
  })).sort((a, b) => b.avg_reward_delta - a.avg_reward_delta);

  const plannerCounterfactual = Object.entries(state.planner_versions).map(([version, meta]) => ({
    planner_version: version,
    runs: meta.runs,
    weighted_runs: Number(meta.weighted_runs.toFixed(3)),
    avg_ats: meta.weighted_runs ? Number((meta.ats_sum / meta.weighted_runs).toFixed(2)) : null,
    avg_oracle: meta.weighted_runs && meta.oracle_sum != null
      ? Number((meta.oracle_sum / meta.weighted_runs).toFixed(2))
      : null,
    avg_reward: meta.weighted_runs ? Number((meta.reward_sum / meta.weighted_runs).toFixed(3)) : null,
  })).sort((a, b) => a.planner_version.localeCompare(b.planner_version));

  return {
    generated_at: new Date(now).toISOString(),
    replay_schema_version: 1,
    decay_lambda: decayLambda,
    event_count: events.length,
    outcomes_logged: state.outcomes_logged,
    regret_frequency: topWeighted(state.regrets, 15),
    missing_but_supported: topWeighted(state.missing_supported),
    authoring_queue: authoringQueue,
    career_signals: topWeighted(state.unclaimable, 25).map((item) => ({
      skill: item.key,
      weighted_demand: item.weighted_count,
      status: "unsupported_evidence",
    })),
    deduction_breakdown: deductionBreakdown,
    planner_stats: {
      ac_selection_frequency: topWeighted(state.ac_selection, 30),
      rejection_reason_frequency: topWeighted(state.rejection_reasons, 30),
      unused_better_candidate_frequency: topWeighted(state.unused_better, 20),
    },
    ac_ratings: acRatings,
    pair_stats: pairStats,
    planner_counterfactual: plannerCounterfactual,
    avg_reward: state.rewards.length
      ? Number((state.rewards.reduce((s, r) => s + r.reward * r.weight, 0)
        / state.rewards.reduce((s, r) => s + r.weight, 0)).toFixed(3))
      : null,
  };
}

export function writeProjection(name, projection) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(projection, null, 2)}\n`);
  return file;
}

export function replayAll(options = {}) {
  const projection = replayProject(readEvents(), options);
  writeProjection("aggregates", projection);
  writeProjection("authoring_queue", { generated_at: projection.generated_at, queue: projection.authoring_queue });
  writeProjection("ac_ratings", { generated_at: projection.generated_at, ratings: projection.ac_ratings });
  writeProjection("pair_stats", { generated_at: projection.generated_at, pairs: projection.pair_stats });
  writeProjection("planner_counterfactual", {
    generated_at: projection.generated_at,
    versions: projection.planner_counterfactual,
  });
  return projection;
}

export function loadProjection(name = "aggregates") {
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return replayAll();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
