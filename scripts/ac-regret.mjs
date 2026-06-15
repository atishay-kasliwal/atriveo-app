// Regret analysis: hindsight comparison of selected vs better alternatives.

import { createEvent } from "./ac-events.mjs";
import { scoreOracle } from "./ac-oracle.mjs";

const DUPLICATE_PAIRS = [
  ["AC-001", "AC-002"],
  ["AC-010", "AC-027"],
];

function selectedIds(composition) {
  const ids = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  return ids.filter(Boolean);
}

function swapAcInTrace(composition, fromAc, toAc) {
  const selected = selectedIds(composition);
  if (!selected.includes(fromAc) || selected.includes(toAc)) return null;
  return selected.map((id) => (id === fromAc ? toAc : id));
}

export function analyzeRegret(composition, bank, jd, plannerVersion = "v1", analyst = null) {
  const selected = selectedIds(composition);
  const regrets = [];
  const baseOracle = scoreOracle(composition, {
    humanReadability: analyst?.tasks?.readability?.parsed?.score_1_to_10,
  });

  const candidates = [];

  const weakest = analyst?.tasks?.weakest?.parsed;
  if (weakest?.replacement_ac_id && weakest?.weakest_bullet_id) {
    const fromAc = weakest.weakest_bullet_id.split(":").pop();
    candidates.push({
      from_ac: fromAc,
      to_ac: weakest.replacement_ac_id,
      reason: weakest.why || "weakest_bullet_swap",
      source: "analyst",
    });
  }

  for (const rej of composition.selection_trace?.rejected || []) {
    if (rej.reason === "lower_ranked" && rej.score > 0.6) {
      const roleSelected = (composition.selection_trace?.selected || [])
        .filter((s) => s.role === rej.role)
        .sort((a, b) => a.score - b.score)[0];
      if (roleSelected && rej.score > roleSelected.score) {
        candidates.push({
          from_ac: roleSelected.ac_id,
          to_ac: rej.ac_id,
          reason: "higher_scored_reject",
          source: "selection_trace",
        });
      }
    }
  }

  for (const c of (analyst?.tasks?.verify?.parsed?.route_changes || [])) {
    if (c.suggested_ac_id && !selected.includes(c.suggested_ac_id)) {
      const replace = selected.find((id) => id !== c.suggested_ac_id);
      if (replace) {
        candidates.push({
          from_ac: replace,
          to_ac: c.suggested_ac_id,
          reason: c.reason || "planner_verify",
          source: "verify",
        });
      }
    }
  }

  const seen = new Set();
  for (const cand of candidates) {
    const key = `${cand.from_ac}->${cand.to_ac}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const oracleDelta = estimateSwapGain(composition, baseOracle, cand, jd, bank, plannerVersion, analyst);
    regrets.push({
      from_ac: cand.from_ac,
      to_ac: cand.to_ac,
      reason: cand.reason,
      source: cand.source,
      estimated_oracle_gain: oracleDelta.oracle_gain,
      estimated_ats_gain: oracleDelta.ats_gain,
      estimated_readability_gain: oracleDelta.readability_gain,
    });
  }

  regrets.sort((a, b) => b.estimated_oracle_gain - a.estimated_oracle_gain);

  return {
    selected_acs: selected,
    base_oracle: baseOracle.oracle_score,
    regrets: regrets.slice(0, 5),
    duplicate_pairs_present: DUPLICATE_PAIRS.filter(([a, b]) => selected.includes(a) && selected.includes(b)),
  };
}

function estimateSwapGain(composition, baseOracle, cand, jd, bank, plannerVersion, analyst) {
  // Lightweight estimate without full re-compose: use rejected score delta + coverage heuristic
  const fromRej = (composition.selection_trace?.rejected || []).find((r) => r.ac_id === cand.to_ac);
  const fromSel = (composition.selection_trace?.selected || []).find((s) => s.ac_id === cand.from_ac);
  const scoreDelta = (fromRej?.score || 0) - (fromSel?.score || 0);

  const atsGain = Number((scoreDelta * 12).toFixed(2));
  const readabilityGain = cand.source === "analyst" ? 0.4 : Number((scoreDelta * 2).toFixed(2));
  const oracleGain = Number((atsGain * 0.4 + readabilityGain * 2).toFixed(2));

  return { oracle_gain: oracleGain, ats_gain: atsGain, readability_gain: readabilityGain };
}

export function regretEvents(regretAnalysis, meta = {}) {
  return (regretAnalysis.regrets || [])
    .filter((r) => r.estimated_oracle_gain > 0.5)
    .map((r) => createEvent("regret_analysis", {
      selected_acs: regretAnalysis.selected_acs,
      from_ac: r.from_ac,
      to_ac: r.to_ac,
      reason: r.reason,
      estimated_oracle_gain: r.estimated_oracle_gain,
      estimated_ats_gain: r.estimated_ats_gain,
      estimated_readability_gain: r.estimated_readability_gain,
    }, {
      correlation_id: meta.correlation_id || null,
      planner_version: meta.planner_version || "v1",
      source: "simulator",
    }));
}
