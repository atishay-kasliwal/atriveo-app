#!/usr/bin/env node
/**
 * Event-sourced learning dashboard (aggregates are replay projections).
 */
import path from "node:path";
import { LEARNING_DIR, readEvents } from "./ac-learning.mjs";
import { loadProjection, replayAll } from "./ac-replay.mjs";
import { scanMarket } from "./ac-market.mjs";
import { ingestMarketObservation } from "./ac-learning.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  const projection = hasFlag("recompute") ? replayAll() : loadProjection("aggregates");
  const events = readEvents();
  const acRatings = loadProjection("ac_ratings");
  const pairStats = loadProjection("pair_stats");
  const counterfactual = loadProjection("planner_counterfactual");

  printSection("Event store (canonical)");
  console.log(`Path: ${path.relative(ROOT, LEARNING_DIR)}`);
  console.log(`Events: ${events.length} · replayed: ${projection.event_count}`);
  console.log(`Decay λ: ${projection.decay_lambda} · outcomes logged: ${projection.outcomes_logged}`);
  console.log(`Avg multi-objective reward: ${projection.avg_reward ?? "n/a"}`);

  printSection("Authoring queue (derived)");
  for (const item of (projection.authoring_queue || []).slice(0, 12)) {
    console.log(`${item.ac} · ${item.suggestion} · wfreq ${item.weighted_frequency}`);
  }

  printSection("AC ratings (evidence-weighted)");
  for (const row of (acRatings.ratings || []).slice(0, 10)) {
    console.log(`${row.ac_id}  sel=${row.weighted_selected}  ats=${row.avg_ats}  human=${row.avg_human}  interview=${row.interview_rate}  offer=${row.offer_rate}`);
  }

  printSection("Pair synergy");
  for (const row of (pairStats.pairs || []).slice(0, 8)) {
    console.log(`${row.pair}  Δreward=${row.avg_reward_delta}  n=${row.count}`);
  }
  for (const row of (pairStats.pairs || []).slice(-3)) {
    if (row.avg_reward_delta < 0) console.log(`${row.pair}  Δreward=${row.avg_reward_delta} (redundant)`);
  }

  printSection("Planner counterfactual (incl. simulator runs)");
  for (const row of (counterfactual.versions || [])) {
    console.log(`${row.planner_version}  oracle=${row.avg_oracle}  ats=${row.avg_ats}  runs=${row.runs}`);
  }

  printSection("Regret patterns (hindsight swaps)");
  for (const item of (projection.regret_frequency || []).slice(0, 8)) {
    console.log(`${item.key.padEnd(24)} w=${item.weighted_count}`);
  }

  printSection("Rejection reasons (why AC wasn't selected)");
  for (const item of (projection.planner_stats?.rejection_reason_frequency || []).slice(0, 12)) {
    console.log(`${item.key.padEnd(36)} w=${item.weighted_count}`);
  }

  printSection("Score loss breakdown (decayed)");
  for (const item of (projection.deduction_breakdown || []).slice(0, 8)) {
    console.log(`${item.type.padEnd(24)} ${item.pct_of_loss}%`);
  }

  printSection("Career roadmap (unsupported demand)");
  for (const item of (projection.career_signals || []).slice(0, 10)) {
    console.log(`${item.skill.padEnd(24)} wdemand=${item.weighted_demand}`);
  }

  if (hasFlag("market")) {
    const { marketFrequency, marketDrift } = scanMarket();
    ingestMarketObservation(marketFrequency, marketDrift);
    printSection("Market drift (rising)");
    for (const row of (marketDrift.rising || []).slice(0, 10)) {
      console.log(`${row.term.padEnd(22)} ${row.pct_before}% -> ${row.pct_today}%`);
    }
  }
}

main();
