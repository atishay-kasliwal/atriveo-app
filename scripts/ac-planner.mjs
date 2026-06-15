// Planner sandbox — v2+ delegates to unified pipeline beam search.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compose, loadBank } from "./ac-bank.mjs";
import { generateResume } from "./ac-pipeline.mjs";
import { retrieveCandidateAcs } from "./ac-embeddings.mjs";
import { warmStartBoosts } from "./ac-case-memory.mjs";

const PLANNER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "planner");

export function listPlanners() {
  return fs.readdirSync(PLANNER_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadPlannerConfig(version = "v1") {
  const file = path.join(PLANNER_DIR, `${version}.json`);
  if (!fs.existsSync(file)) throw new Error(`Unknown planner: ${version}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function buildPlannerRuntimeConfig(version, { jd, bank, company = null } = {}) {
  const cfg = loadPlannerConfig(version);
  const runtime = { ...cfg, version: cfg.version || version, name: cfg.name || version };

  if (cfg.retrieval_top_k) {
    const retrieved = retrieveCandidateAcs(jd, bank, cfg.retrieval_top_k);
    runtime.retrieval_scores = Object.fromEntries(retrieved.map((row) => [row.ac_id, row.score]));
    runtime.ac_boost = Object.fromEntries(
      retrieved.map((row) => [row.ac_id, Number((row.score * 0.15).toFixed(4))]),
    );
    if (cfg.retrieval_hard_filter) {
      runtime.candidate_ac_ids = retrieved.map((row) => row.ac_id);
      runtime.always_include_roles = cfg.always_include_roles || [];
    }
  }

  if (cfg.use_case_memory && company) {
    runtime.case_memory_boost = warmStartBoosts(company, bank);
  }

  return runtime;
}

/** Returns raw composition (beam pipeline uses generateResume for production). */
export function runPlanner(version, jd, bank, meta = {}) {
  const cfg = loadPlannerConfig(version);
  if (cfg.beam_search !== false && version !== "v1") {
    const pipeline = generateResume({ jd, bank, planner: version, meta });
    return pipeline.result.composition;
  }
  const runtime = buildPlannerRuntimeConfig(version, { jd, bank, company: meta.company || null });
  runtime.narrative_first = cfg.narrative_first !== false;
  return compose(jd, bank, runtime);
}

export async function comparePlanners(versions, jd, bank, meta = {}) {
  const out = {};
  for (const version of versions) {
    out[version] = runPlanner(version, jd, bank, meta);
  }
  return out;
}
