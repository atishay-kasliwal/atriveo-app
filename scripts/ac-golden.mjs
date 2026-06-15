#!/usr/bin/env node
/**
 * Golden resume regression — unified pipeline + RCS + visual layout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBank } from "./ac-bank.mjs";
import { generateResume, compactPipelineResult } from "./ac-pipeline.mjs";
import { compareVisual } from "./ac-visual.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_DIR = path.join(ROOT, "tests", "golden");
const MANIFEST = path.join(GOLDEN_DIR, "manifest.json");
const BASELINES = path.join(GOLDEN_DIR, "baselines");
const JD_DIR = path.join(GOLDEN_DIR, "jds");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function extractMetrics(pipeline) {
  const r = pipeline.result;
  const hm = r.composition.quality?.hiring_manager_test || {};
  return {
    resume_confidence_score: r.resume_confidence_score,
    oracle_score: r.oracle.oracle_score,
    hiring_manager_composite: hm.composite ?? null,
    would_interview: hm.would_interview ?? null,
    proof_chain_steps: r.composition.narrative?.proof_chain?.length ?? 0,
    avg_density: r.composition.quality?.information_density?.aggregate?.avg_density ?? null,
    diversity: r.gate.score?.components?.diversity ?? null,
    evidence_compression: r.gate.evidence_compression?.ratio ?? null,
    beam_winner: pipeline.beam?.winner,
    selected_acs: r.gate.metrics?.selected_acs || [],
    visual: r.gate.visual,
    contribution_pruned: r.contribution_pruned || [],
  };
}

function compareMetrics(baseline, current, id) {
  const regressions = [];
  if (current.resume_confidence_score < baseline.resume_confidence_score - 1.5) {
    regressions.push({ id, metric: "resume_confidence_score", baseline: baseline.resume_confidence_score, current: current.resume_confidence_score });
  }
  for (const key of ["oracle_score", "diversity"]) {
    if (baseline[key] == null || current[key] == null) continue;
    if (current[key] < baseline[key] - 0.05) {
      regressions.push({ id, metric: key, baseline: baseline[key], current: current[key] });
    }
  }
  if (baseline.visual && current.visual) {
    regressions.push(...compareVisual(baseline.visual, current.visual).map((r) => ({ id, ...r })));
  }
  return regressions;
}

function runGolden(entry, bank, update) {
  const jd = fs.readFileSync(path.join(JD_DIR, entry.jd), "utf8").trim();
  const pipeline = generateResume({
    jd, bank, planner: entry.planner || "v2", meta: { company: entry.company, title: entry.title },
  });
  const metrics = extractMetrics(pipeline);
  const baselinePath = path.join(BASELINES, `${entry.id}.json`);

  if (update || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify({
      id: entry.id,
      updated_at: new Date().toISOString(),
      pipeline_version: pipeline.pipeline_version,
      metrics,
      beam: pipeline.beam,
    }, null, 2)}\n`);
    return { id: entry.id, action: "updated", metrics };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  return { id: entry.id, action: "compared", metrics, regressions: compareMetrics(baseline.metrics, metrics, entry.id) };
}

function main() {
  const update = hasFlag("update");
  const bank = loadBank();
  const results = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).goldens.map((e) => runGolden(e, bank, update));

  console.log(`Golden (${update ? "UPDATE" : "COMPARE"}) — pipeline + bank v${bank.bank_version}`);
  let failed = false;
  for (const row of results) {
    if (row.action === "updated") {
      console.log(`  [updated] ${row.id} — RCS ${row.metrics.resume_confidence_score}`);
      continue;
    }
    if (row.regressions?.length) {
      failed = true;
      console.log(`  [REGRESSION] ${row.id}`);
      for (const r of row.regressions) console.log(`    ${r.metric}: ${r.baseline} → ${r.current}`);
    } else {
      console.log(`  [ok] ${row.id} — RCS ${row.metrics.resume_confidence_score}`);
    }
  }
  if (failed) process.exit(1);
}

main();
