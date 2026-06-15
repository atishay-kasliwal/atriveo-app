#!/usr/bin/env node
/**
 * Global 15-bullet optimizer — hill-climb on evidence coverage, not per-role greed.
 */
import {
  buildResumeEvidenceProfile,
  capabilityEntropyScore,
  differentiatorScore,
  interviewSurvivabilityScore,
  metricDiversityScore,
  positionWeightedStrength,
  loadEvidenceTaxonomy,
  flattenResumeBullets,
} from "./ac-evidence.mjs";
import {
  buildCoverageState,
  evidenceDensityScore,
  engineeringIdentityConfidence,
  graphCapabilityScore,
  loadCapabilityGraph,
  negativeBreadthPenalty,
  storyTransitionScore,
  technologyWeightedScore,
} from "./ac-capability-graph.mjs";
import { auditSelectionRejections } from "./ac-rejection-audit.mjs";
import { scoreAtsMatrix } from "./ac-ats-matrix.mjs";

export const GLOBAL_OBJECTIVE_WEIGHTS = {
  graph_coverage: 0.18,
  information_gain: 0.12,
  capability_entropy: 0.10,
  technology_weighted: 0.08,
  evidence_density: 0.10,
  story_transitions: 0.08,
  differentiator: 0.12,
  interview_survivability: 0.06,
  position_strength: 0.08,
  identity_confidence: 0.10,
  ats: 0.05,
  metric_diversity: 0.03,
};

function bulletAcId(bullet) {
  return bullet.ac?.id || bullet.ac_id;
}

function cloneComposition(composition) {
  return JSON.parse(JSON.stringify(composition));
}

function collectUsedIds(composition) {
  return new Set(flattenResumeBullets(composition).map((b) => bulletAcId(b)).filter(Boolean));
}

function roleCandidateAcs(bank, role, usedIds, pinnedIds, composition, cfg = {}) {
  const pool = packageSwapPool(role, composition, cfg, pinnedIds);
  return (bank.acs || []).filter((ac) => {
    if (ac.role !== role) return false;
    if (ac.visibility?.default === false) return false;
    if (pinnedIds.has(ac.id)) return false;
    if (usedIds.has(ac.id)) return false;
    if (pool && !pool.has(ac.id)) return false;
    return true;
  });
}

function packageSwapPool(role, composition, cfg, pinnedIds) {
  const poolCfg = cfg.canonical_pools?.[role];
  if (!poolCfg?.packages_only) return null;

  const winner = composition.selection_trace?.package_winners?.[role];
  if (winner?.ac_ids?.length) {
    return new Set(winner.ac_ids.filter((id) => !pinnedIds.has(id)));
  }

  const ids = new Set();
  for (const pkg of poolCfg.story_packages || []) {
    for (const id of pkg.ids || []) {
      if (!pinnedIds.has(id)) ids.add(id);
    }
  }
  return ids.size ? ids : null;
}

/**
 * @param {object} composition
 * @param {object} bank
 * @param {string} jd
 * @param {object} [opts]
 */
export function scoreGlobalResume(composition, bank, jd = "", opts = {}) {
  const tax = opts.taxonomy || loadEvidenceTaxonomy();
  const graph = opts.graph || loadCapabilityGraph();
  const profile = buildResumeEvidenceProfile(composition, bank, tax);
  const coverageState = buildCoverageState(profile.bullets, graph);
  profile.graph_coverage = coverageState.coverage;
  profile.per_bullet_information_gain = coverageState.per_bullet;
  profile.total_information_gain = coverageState.total_gain;
  profile.engineering_identity = engineeringIdentityConfidence(coverageState.coverage, graph);

  const skills = composition.skills || [];
  const ats = composition.ats_matrix?.score ?? scoreAtsMatrix(composition, skills);

  const components = {
    graph_coverage: graphCapabilityScore(profile.graph_coverage || {}, graph),
    information_gain: Number(Math.min(100, (profile.total_information_gain || 0) * 2.2).toFixed(2)),
    capability_entropy: capabilityEntropyScore(profile),
    technology_weighted: technologyWeightedScore(profile, graph),
    evidence_density: evidenceDensityScore(profile.bullets, graph),
    story_transitions: storyTransitionScore(profile.bullets, graph),
    differentiator: differentiatorScore(profile, tax),
    interview_survivability: interviewSurvivabilityScore(profile),
    position_strength: positionWeightedStrength(profile, tax),
    identity_confidence: (profile.engineering_identity?.confidence ?? 0) * 100,
    ats: Number((ats * 100).toFixed(2)),
    metric_diversity: metricDiversityScore(profile),
  };

  const weights = { ...GLOBAL_OBJECTIVE_WEIGHTS, ...opts.weights };
  let total = 0;
  for (const [key, w] of Object.entries(weights)) {
    total += (components[key] ?? 0) * w;
  }

  const redundancy = detectRedundancy(profile);
  total -= redundancy.penalty;

  const breadth = negativeBreadthPenalty(profile.bullets, graph);
  total -= breadth.penalty;

  const differentiatorGap = differentiatorCoveragePenalty(profile, tax);
  total -= differentiatorGap;

  const constraints = checkBankConstraints(composition, bank);
  total -= constraints.penalty;

  return {
    global_score: Number(total.toFixed(2)),
    components,
    weights,
    profile,
    engineering_identity: profile.engineering_identity,
    redundancy,
    breadth_penalty: breadth,
    constraints,
  };
}

function detectRedundancy(profile) {
  const issues = [];
  let penalty = 0;

  for (const [tech, count] of Object.entries(profile.technology_counts)) {
    if (count >= 4) {
      issues.push({ type: "technology", tag: tech, count });
      penalty += (count - 3) * 6;
    }
  }
  for (const [cluster, count] of Object.entries(profile.novelty_clusters)) {
    if (count >= 3) {
      issues.push({ type: "novelty_cluster", tag: cluster, count });
      penalty += (count - 2) * 10;
    }
  }
  const langchain = profile.technology_counts.langchain || profile.technology_counts["lang chain"] || 0;
  if (langchain >= 3) {
    issues.push({ type: "langchain_stack", count: langchain });
    penalty += 8;
  }

  return { issues, penalty: Number(penalty.toFixed(2)) };
}

function differentiatorCoveragePenalty(profile, tax) {
  const diffThemes = new Set(
    profile.bullets.filter((b) => b.evidence.differentiator).map((b) => b.evidence.achievement_theme),
  );
  let penalty = 0;
  if (diffThemes.size < 3) penalty += (3 - diffThemes.size) * 8;

  const topDiff = profile.bullets.some((b) => b.position <= 6 && b.evidence.differentiator);
  if (!topDiff) penalty += 12;

  return Number(penalty.toFixed(2));
}

function checkBankConstraints(composition, bank) {
  const constraints = bank.constraints || {};
  const issues = [];
  let penalty = 0;
  const bullets = flattenResumeBullets(composition);

  let aiCount = 0;
  let backendCount = 0;
  for (const b of bullets) {
    const caps = b.ac?.capabilities || {};
    if ((caps.ai ?? 0) >= 80) aiCount += 1;
    if ((caps.backend ?? 0) >= 80) backendCount += 1;
  }
  if (constraints.max_ai_bullets && aiCount > constraints.max_ai_bullets) {
    issues.push({ rule: "max_ai_bullets", actual: aiCount, limit: constraints.max_ai_bullets });
    penalty += (aiCount - constraints.max_ai_bullets) * 12;
  }
  if (constraints.max_backend_bullets && backendCount > constraints.max_backend_bullets) {
    issues.push({ rule: "max_backend_bullets", actual: backendCount, limit: constraints.max_backend_bullets });
    penalty += (backendCount - constraints.max_backend_bullets) * 8;
  }

  return { issues, penalty: Number(penalty.toFixed(2)) };
}

function locateBullet(composition, slotKind, slotRole, index) {
  const block = slotKind === "experience"
    ? composition.experience?.find((r) => r.role === slotRole)
    : composition.projects?.find((p) => p.role === slotRole);
  return block?.bullets?.[index] ?? null;
}

function setBullet(composition, slotKind, slotRole, index, bullet) {
  const block = slotKind === "experience"
    ? composition.experience?.find((r) => r.role === slotRole)
    : composition.projects?.find((p) => p.role === slotRole);
  if (block?.bullets?.[index] != null) block.bullets[index] = bullet;
}

function pinnedSet(cfg = {}) {
  const pinned = new Set();
  for (const ids of Object.values(cfg.pinned_ac_ids || {})) {
    for (const id of ids || []) pinned.add(id);
  }
  for (const ids of Object.values(cfg.lead_ac_ids || {})) {
    for (const id of ids || []) pinned.add(id);
  }
  return pinned;
}

/**
 * Hill-climb: swap one bullet at a time until convergence.
 */
export function optimizeResumeGlobally(composition, bank, jd, opts = {}) {
  const {
    cfg = {},
    composeCtx = {},
    maxIterations = 24,
    maxSwapsPerIter = 80,
    minImprovement = 0.15,
  } = opts;

  const pinned = pinnedSet(cfg);
  const buildBullet = opts.buildBullet;
  if (!buildBullet) {
    throw new Error("optimizeResumeGlobally requires buildBullet(ac, composeCtx)");
  }

  let current = cloneComposition(composition);
  let bestScore = scoreGlobalResume(current, bank, jd, opts);
  const swaps = [];
  let iterations = 0;
  let improved = false;

  const slots = [];
  for (const role of current.experience || []) {
    (role.bullets || []).forEach((bullet, index) => {
      slots.push({ slotKind: "experience", slotRole: role.role, index, acId: bulletAcId(bullet) });
    });
  }
  for (const project of current.projects || []) {
    (project.bullets || []).forEach((bullet, index) => {
      slots.push({ slotKind: "project", slotRole: project.role, index, acId: bulletAcId(bullet) });
    });
  }

  while (iterations < maxIterations) {
    iterations += 1;
    let iterBest = null;

    const shuffled = [...slots].sort(() => Math.random() - 0.5).slice(0, maxSwapsPerIter);
    for (const slot of shuffled) {
      if (pinned.has(slot.acId)) continue;

      const used = collectUsedIds(current);
      used.delete(slot.acId);
      const candidates = roleCandidateAcs(bank, slot.slotRole, used, pinned, current, cfg);

      for (const ac of candidates) {
        const trial = cloneComposition(current);
        const newBullet = buildBullet(ac, { ...composeCtx, jd, composition: trial });
        setBullet(trial, slot.slotKind, slot.slotRole, slot.index, newBullet);

        const scored = scoreGlobalResume(trial, bank, jd, opts);
        if (!iterBest || scored.global_score > iterBest.scored.global_score) {
          iterBest = { trial, scored, from: slot.acId, to: ac.id, slot };
        }
      }
    }

    if (!iterBest || iterBest.scored.global_score <= bestScore.global_score + minImprovement) break;

    improved = true;
    current = iterBest.trial;
    bestScore = iterBest.scored;
    iterBest.slot.acId = iterBest.to;
    swaps.push({
      iteration: iterations,
      from: iterBest.from,
      to: iterBest.to,
      role: iterBest.slot.slotRole,
      position: iterBest.slot.index + 1,
      delta: Number((iterBest.scored.global_score - (swaps.length
        ? swaps[swaps.length - 1].score_after
        : scoreGlobalResume(composition, bank, jd, opts).global_score)).toFixed(3)),
      score_after: iterBest.scored.global_score,
      reason: swapReason(iterBest.from, iterBest.to, bank, bestScore),
    });
  }

  const before = scoreGlobalResume(composition, bank, jd, opts);

  const graph = loadCapabilityGraph();
  const identityMin = graph.identity_confidence_min ?? 0.55;
  let identityRetry = null;
  if ((bestScore.engineering_identity?.confidence ?? 0) < identityMin && improved) {
    identityRetry = optimizeResumeGlobally(current, bank, jd, {
      ...opts,
      minImprovement: 0.1,
      maxIterations: 8,
      weights: { ...opts.weights, identity_confidence: 0.22, differentiator: 0.16 },
    });
    if (identityRetry.improved && identityRetry.after.global_score >= bestScore.global_score - 1) {
      current = identityRetry.composition;
      bestScore = identityRetry.after;
      swaps.push(...identityRetry.swaps.map((s) => ({ ...s, pass: "identity_retry" })));
    }
  }

  const rejection_audit = opts.audit_rejections !== false
    ? auditSelectionRejections(current, bank, cfg)
    : null;

  return {
    composition: current,
    improved: improved || identityRetry?.improved,
    iterations,
    swaps,
    before,
    after: bestScore,
    delta: Number((bestScore.global_score - before.global_score).toFixed(3)),
    engineering_identity: bestScore.engineering_identity,
    identity_retry: identityRetry,
    rejection_audit,
  };
}

function taxDifferentiator(ac) {
  const tax = loadEvidenceTaxonomy();
  return (tax.differentiator_themes || []).includes(ac?.achievement_theme);
}

function swapReason(fromId, toId, bank, score) {
  const byId = new Map((bank.acs || []).map((a) => [a.id, a]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  const parts = [];
  if (from?.achievement_theme && to?.achievement_theme
    && (taxDifferentiator(from) || taxDifferentiator(to))
    && from.achievement_theme !== to.achievement_theme) {
    parts.push(`differentiator ${from.achievement_theme} → ${to.achievement_theme}`);
  }
  if (score.redundancy?.issues?.length) {
    parts.push("reduce redundancy");
  }
  if (to && score.profile) {
    const caps = score.profile.capability_counts;
    const newCaps = to.achievement_theme || to.id;
    if (!caps[newCaps]) parts.push("new capability coverage");
  }
  return parts.join("; ") || "higher global evidence score";
}

export function formatGlobalOptimizeReport(result) {
  const id = result.engineering_identity;
  const lines = [
    `Global score: ${result.before.global_score} → ${result.after.global_score} (${result.delta >= 0 ? "+" : ""}${result.delta})`,
    `Identity: ${id?.primary}${id?.secondary ? ` / ${id.secondary}` : ""} · confidence ${id?.confidence ?? "—"}`,
    `Information gain: ${result.after.profile?.total_information_gain?.toFixed(1) ?? "—"}`,
  ];
  if (result.swaps.length) {
    lines.push("Swaps:");
    for (const s of result.swaps) {
      lines.push(`  ${s.from} → ${s.to} (${s.role} slot ${s.position}) · ${s.reason}`);
    }
  } else {
    lines.push("No swaps — local optimum.");
  }
  return lines.join("\n");
}

async function cliMain() {
  const { loadBank, compose, buildBullet } = await import("./ac-bank.mjs");
  const { loadPlannerConfig, buildPlannerRuntimeConfig } = await import("./ac-planner.mjs");

  const jd = process.argv.slice(2).join(" ") || "AI Engineer Python FastAPI LangChain AWS backend distributed systems";
  const bank = loadBank();
  const cfg = buildPlannerRuntimeConfig("v2", { jd, bank });
  const composition = compose(jd, bank, cfg);
  const themeRaw = bank.themes?.[composition.theme];
  const ctx = {
    jd,
    theme: themeRaw ? { name: composition.theme, ...themeRaw } : null,
    plan: composition.plan,
    narrative: composition.narrative,
  };
  const result = optimizeResumeGlobally(composition, bank, jd, {
    cfg: loadPlannerConfig("v2"),
    composeCtx: ctx,
    buildBullet: (ac, c) => buildBullet(ac, c),
  });
  console.log(formatGlobalOptimizeReport(result));
}

if (process.argv[1]?.endsWith("ac-global-optimize.mjs")) {
  cliMain().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
