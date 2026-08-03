// Beam search — generate N candidates, score with RCS, return best.

import { compose } from "./ac-bank.mjs";
import { buildPlannerRuntimeConfig } from "./ac-planner.mjs";
import { analyzeAcContribution } from "./ac-contribution.mjs";
import { scoreResumeCandidate } from "./ac-artifacts.mjs";
import { orderBulletsForProofChain } from "./ac-quality.mjs";
import { diversifyBulletOrder } from "./ac-diversify.mjs";

const BEAM_VARIANTS = [
  { id: "default", label: "Default" },
  { id: "quality-strict", label: "Strict quality", min_bullet_quality: 0.45 },
  { id: "quality-balanced", label: "Balanced", min_bullet_quality: 0.38 },
  { id: "tier-focused", label: "Tier S/A focus", enforce_tiers: true, min_s_tier: 2, max_c_tier: 1 },
  { id: "plan-heavy", label: "Keyword routes", plan_priority_weight: 4 },
  { id: "strength-first", label: "Strong ACs first", strength_divisor: 400 },
  { id: "diverse-verbs", label: "Verb diversity", diversify_verbs: true },
];

function buildRuntime(planner, variant, meta) {
  const runtime = buildPlannerRuntimeConfig(planner, meta);
  Object.assign(runtime, variant);
  runtime.beam_variant = variant.id;
  return runtime;
}

function applyDiversify(composition, variant) {
  if (!variant.diversify_verbs) return composition;
  const packageWinners = composition.selection_trace?.package_winners || {};
  const exp = composition.experience?.map((role) => {
    if (role.role !== "stony-brook") return role;
    if (packageWinners["stony-brook"]?.source === "package") return role;
    const diversified = diversifyBulletOrder(role.bullets, composition.narrative?.proof_chain);
    return { ...role, bullets: diversified };
  });
  return { ...composition, experience: exp };
}

export function beamSearch({
  jd,
  bank,
  planner = "v2",
  meta = {},
  variants = BEAM_VARIANTS,
  pages = 1,
}) {
  const candidates = [];

  for (const variant of variants) {
    const runtime = buildRuntime(planner, variant, { jd, bank, company: meta.company });
    let composition = compose(jd, bank, runtime);
    composition = applyDiversify(composition, variant);

    const scored = scoreResumeCandidate({
      composition,
      bank,
      jd,
      title: meta.title,
      location: meta.location,
      pages,
    });
    const gate = scored.gate;

    if (!gate.invariant.passes) continue;

    const contribution = analyzeAcContribution({
      ...scored.compact,
      skills: scored.skills,
      skills_audit: composition.skills_audit,
      quality: composition.quality,
      narrative: composition.narrative,
      delete_test: composition.delete_test,
      coverage: composition.coverage,
    }, {
      oracle: scored.oracle,
      skills: scored.skills,
      invariantPass: true,
    });

    candidates.push({
      variant_id: variant.id,
      variant_label: variant.label,
      ...scored,
      contribution,
      resume_confidence_score: gate.resume_confidence_score,
    });
  }

  if (!candidates.length) {
    const runtime = buildRuntime(planner, { id: "fallback" }, { jd, bank, company: meta.company });
    const composition = compose(jd, bank, runtime);
    const scored = scoreResumeCandidate({ composition, bank, jd, title: meta.title, location: meta.location, pages });
    return {
      best: { ...scored, variant_id: "fallback", contribution_pruned: [] },
      candidates: [],
      beam_width: variants.length,
    };
  }

  candidates.sort((a, b) => b.resume_confidence_score - a.resume_confidence_score);
  return {
    best: candidates[0],
    candidates: candidates.map((c) => ({
      variant_id: c.variant_id,
      resume_confidence_score: c.resume_confidence_score,
      selected_acs: c.gate.metrics?.selected_acs,
      diversity: c.gate.score?.components?.diversity,
    })),
    beam_width: variants.length,
  };
}

export { BEAM_VARIANTS };
