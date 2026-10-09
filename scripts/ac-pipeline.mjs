// Unified resume pipeline — single entry for all AC generation paths.
//
// JD → loadBank → thesis + proof template → beam search (N candidates)
//   → RCS scoring → contribution prune → INVARIANT check → artifacts

import { assessJdGate } from "./ac-jd-gate.mjs";
import { loadBank, buildBullet, enrichComposition } from "./ac-bank.mjs";
import { loadPlannerConfig } from "./ac-planner.mjs";
import { beamSearch, BEAM_VARIANTS } from "./ac-beam.mjs";
import { compose } from "./ac-bank.mjs";
import { buildPlannerRuntimeConfig } from "./ac-planner.mjs";
import { acTier } from "./ac-bank.mjs";
import { scoreResumeCandidate } from "./ac-artifacts.mjs";
import { optimizeResumeGlobally } from "./ac-global-optimize.mjs";
import { buildComposeExplain } from "./ac-compose-explain.mjs";
import { bankForTrack, classifyTrack, trackPins } from "./ac-tracks.mjs";

// Part of every resume cache key: bump it when the output changes for the same JD and bank
// (2.1.0: role tracks, title-only experience lines, Education after the header; 2.1.1: AI track
// Accolite 3 -> 2 so the page fits; 2.1.2: no ligatures in resume text; 2.1.3: Accolite title
// "Senior Software Developer").
export const PIPELINE_VERSION = "2.2.0";

export const PIPELINE_STEPS = [
  "load_bank",
  "keyword_planner",
  "thesis_selection",
  "proof_template",
  "beam_search",
  "rcs_scoring",
  "contribution_prune",
  "delete_test",
  "skills_evidence",
  "invariant_check",
  "global_optimize",
  "artifact_assembly",
];

function shouldUseBeam(planner, cfg = null) {
  const config = cfg || loadPlannerConfig(planner);
  if (planner === "v1") return false;
  return config.beam_search !== false;
}

function applyContributionPruning(composition, contribution, bank, { minExperienceBullets = 6 } = {}) {
  if (!contribution?.contributions?.length) return { composition, pruned: [] };

  const proofIds = new Set((composition.narrative?.proof_chain || []).map((p) => p.ac_id));
  const prunable = contribution.contributions.filter((row) => {
    if (row.contribution >= -0.5) return false;
    if (row.verdict !== "omit_candidate") return false;
    if (proofIds.has(row.ac_id)) return false;
    const tier = acTier(row.ac_id, bank);
    return tier === "C";
  });

  const omit = new Set(prunable.map((r) => r.ac_id));
  if (!omit.size) return { composition, pruned: [] };

  const countBullets = (c) => {
    let n = 0;
    for (const role of c.experience || []) n += (role.bullets || []).length;
    for (const project of c.projects || []) n += (project.bullets || []).length;
    return n;
  };

  const pruned = [];
  let current = composition;

  for (const acId of omit) {
    const trial = {
      ...current,
      experience: (current.experience || []).map((role) => ({
        ...role,
        bullets: (role.bullets || []).filter((b) => (b.ac?.id || b.ac_id) !== acId),
      })),
      projects: (current.projects || []).map((project) => ({
        ...project,
        bullets: (project.bullets || []).filter((b) => (b.ac?.id || b.ac_id) !== acId),
      })),
    };
    if (countBullets(trial) < minExperienceBullets) continue;
    current = trial;
    pruned.push(acId);
  }

  return { composition: current, pruned };
}

function scoreCandidate(args) {
  return scoreResumeCandidate(args);
}

function finalizeCandidate(candidate, { bank, jd, title, location, pages = 1 }) {
  const baselineRcs = candidate.resume_confidence_score;
  const { composition: pruned, pruned: prunedIds } = applyContributionPruning(
    candidate.composition,
    candidate.contribution,
    bank,
  );
  if (!prunedIds.length) {
    return { ...candidate, contribution_pruned: [], beam_variant: candidate.variant_id };
  }
  const rescored = scoreCandidate({ composition: pruned, bank, jd, title, location, pages });
  if (rescored.resume_confidence_score < baselineRcs * 0.97) {
    return {
      ...candidate,
      contribution_pruned: [],
      prune_reverted: true,
      beam_variant: candidate.variant_id,
    };
  }
  return {
    ...rescored,
    variant_id: candidate.variant_id,
    variant_label: candidate.variant_label,
    contribution_pruned: prunedIds,
    beam_variant: candidate.variant_id,
  };
}

export { scoreResumeCandidate } from "./ac-artifacts.mjs";

function themeFromComposition(composition, bank) {
  const name = composition.theme;
  if (!name) return null;
  const raw = bank.themes?.[name];
  return raw ? { name, ...raw } : { name };
}

function applyGlobalOptimize(candidate, { bank, jd, planner, meta, pages, cfg }) {
  if (cfg.global_optimize === false || !candidate?.composition) return candidate;

  const runtime = buildPlannerRuntimeConfig(planner, { jd, bank, company: meta.company, title: meta.title });
  runtime.narrative_first = cfg.narrative_first !== false;

  const opt = optimizeResumeGlobally(candidate.composition, bank, jd, {
    cfg,
    composeCtx: {
      jd,
      theme: themeFromComposition(candidate.composition, bank),
      plan: candidate.composition.plan,
      narrative: candidate.composition.narrative,
    },
    buildBullet,
  });

  if (!opt.improved) {
    return {
      ...candidate,
      global_optimize: { applied: false, before: opt.before, after: opt.after, swaps: [] },
    };
  }

  const enriched = enrichComposition(opt.composition, bank, jd, runtime);
  const rescored = scoreCandidate({
    composition: enriched,
    bank,
    jd,
    title: meta.title,
    location: meta.location,
    pages,
  });

  return {
    ...rescored,
    variant_id: candidate.variant_id,
    variant_label: candidate.variant_label,
    contribution_pruned: candidate.contribution_pruned,
    beam_variant: candidate.beam_variant,
    global_optimize: { applied: true, ...opt },
  };
}

/**
 * A track with a pinned set (TRACKS.yaml tracks.<id>.pinned) uses exactly those bullets: the set that was tested for
 * that role (docs/resume-tracks/). They replace what the pipeline chose; skills, coverage and scores are rebuilt for
 * this JD. "AC-001:fde" is that entry's wording with facet fde; a bare id is its first wording.
 */
function applyTrackPins(candidate, { trackBank, jd, planner, meta, pages }) {
  const track = classifyTrack(meta.title);
  // The set is chosen on the real posting (meta.postingJd), even when composing ran on a baseline JD.
  const pins = trackPins(track, undefined, { title: meta.title, jd: meta.postingJd || jd });
  if (!pins || !candidate?.composition) return candidate;
  const byId = new Map(trackBank.acs.map((a) => [a.id, a]));
  const resolve = (ref) => {
    const [id, facet] = String(ref).split(":");
    const ac = byId.get(id);
    const face = ac && (facet ? ac.variants.find((v) => v.facet === facet) : ac.variants[0]);
    if (!face) throw new Error(`Track ${track}: pinned bullet ${ref} isn't in its bank`);
    return { ac, face };
  };
  const section = (rows = {}, stacks = {}) => Object.entries(rows).map(([role, refs]) => ({
    role, bullets: refs.map(resolve), ...(stacks[role]?.length ? { stack: stacks[role] } : {}),
  }));
  const composition = { ...candidate.composition, experience: section(pins.experience), projects: section(pins.projects, pins.project_stacks) };
  const runtime = buildPlannerRuntimeConfig(planner, { jd, bank: trackBank, company: meta.company, title: meta.title });
  runtime.narrative_first = loadPlannerConfig(planner).narrative_first !== false;
  enrichComposition(composition, trackBank, jd, runtime);
  const rescored = scoreCandidate({ composition, bank: trackBank, jd, title: meta.title, location: meta.location, pages });
  return {
    ...rescored,
    variant_id: "track-pinned",
    variant_label: `${track} pinned set (${pins.name})`,
    beam_variant: candidate.beam_variant ?? candidate.variant_id,
    contribution_pruned: [],
    global_optimize: candidate.global_optimize,
    pinned_track: track,
    pinned_set: pins.name,
  };
}

function gateBlocksCompose(gate, { forceBorderline = false } = {}) {
  if (!gate) return false;
  if (gate.outcome === "blocked" || gate.outcome === "unsupported") return true;
  if (gate.outcome === "borderline" && !gate.can_compose && !forceBorderline) return true;
  return false;
}

function singleCompose({ jd, bank, trackBank = bank, planner, meta, pages = 1, jdGate = null, forceBorderline = false }) {
  const gate = jdGate || assessJdGate(jd, { title: meta.title, forceBorderline });
  if (gateBlocksCompose(gate, { forceBorderline })) {
    return {
      pipeline_version: PIPELINE_VERSION,
      pipeline_steps: PIPELINE_STEPS,
      planner,
      beam: null,
      unsupported_jd: true,
      jd_gate: gate,
      jd_relevance: gate.relevance,
      result: null,
      bank,
      jd,
    };
  }
  const runtime = buildPlannerRuntimeConfig(planner, { jd, bank, company: meta.company, title: meta.title });
  runtime.narrative_first = loadPlannerConfig(planner).narrative_first !== false;
  runtime.force_borderline = forceBorderline;
  runtime.title = meta.title;
  const composition = compose(jd, bank, runtime);
  if (composition.unsupported_jd) {
    return {
      pipeline_version: PIPELINE_VERSION,
      pipeline_steps: PIPELINE_STEPS,
      planner,
      beam: null,
      unsupported_jd: true,
      jd_gate: composition.jd_gate || gate,
      jd_relevance: composition.jd_relevance,
      result: null,
      bank,
      jd,
    };
  }
  const scored = scoreCandidate({ composition, bank, jd, title: meta.title, location: meta.location, pages });
  let finalized = finalizeCandidate({ ...scored, variant_id: "compose", variant_label: "Direct compose" }, {
    bank, jd, title: meta.title, location: meta.location, pages,
  });
  const cfg = loadPlannerConfig(planner);
  finalized = applyGlobalOptimize(finalized, {
    bank, jd, planner, meta, pages, cfg,
  });
  finalized = applyTrackPins(finalized, { trackBank, jd, planner, meta, pages });
  return {
    pipeline_version: PIPELINE_VERSION,
    pipeline_steps: PIPELINE_STEPS,
    planner,
    beam: null,
    borderline_jd: gate.outcome === "borderline",
    jd_gate: gate.outcome === "borderline" ? gate : undefined,
    result: finalized,
    bank,
    jd,
  };
}

export function generateResume({
  jd,
  bank = null,
  planner = "v2",
  meta = {},
  pages = 1,
  beamVariants = BEAM_VARIANTS,
  requireEngineeringJd = true,
  forceBorderline = false,
  strictJdGate = false,
  jdGate = null,
}) {
  // The job's track sees its own bullets (bankForTrack). Compose runs on the bullets every track shares: a track's
  // own bullets may open with a verb a shared one uses, and compose refuses repeated verbs. A track with a pinned set
  // then takes its bullets from its own bank (applyTrackPins); other tracks keep the shared composition.
  const fullBank = bank || loadBank();
  const trackBank = bankForTrack(fullBank, classifyTrack(meta.title));
  const loadedBank = bankForTrack(fullBank, null);
  const gate = jdGate || assessJdGate(jd, {
    title: meta.title,
    forceBorderline,
    strict: strictJdGate,
  });
  if (requireEngineeringJd && gateBlocksCompose(gate, { forceBorderline })) {
    return {
      pipeline_version: PIPELINE_VERSION,
      pipeline_steps: PIPELINE_STEPS,
      planner,
      beam: null,
      unsupported_jd: true,
      jd_gate: gate,
      jd_relevance: gate.relevance,
      result: null,
      bank: loadedBank,
      jd,
    };
  }
  const cfg = loadPlannerConfig(planner);

  if (!shouldUseBeam(planner, cfg)) {
    return singleCompose({
      jd, bank: loadedBank, trackBank, planner, meta, pages, jdGate: gate, forceBorderline,
    });
  }

  const beam = beamSearch({
    jd,
    bank: loadedBank,
    planner,
    meta,
    pages,
    variants: beamVariants,
    forceBorderline,
  });

  let finalized = finalizeCandidate(beam.best, {
    bank: loadedBank,
    jd,
    title: meta.title,
    location: meta.location,
    pages,
  });
  finalized = applyGlobalOptimize(finalized, {
    bank: loadedBank, jd, planner, meta, pages, cfg,
  });
  finalized = applyTrackPins(finalized, { trackBank, jd, planner, meta, pages });

  return {
    pipeline_version: PIPELINE_VERSION,
    pipeline_steps: PIPELINE_STEPS,
    planner,
    beam: {
      width: beam.beam_width,
      winner: finalized.variant_id,
      candidates: beam.candidates,
    },
    borderline_jd: gate.outcome === "borderline",
    jd_gate: gate.outcome === "borderline" ? gate : undefined,
    result: finalized,
    bank: loadedBank,
    jd,
  };
}

export function compactPipelineResult(pipeline) {
  const r = pipeline.result;
  if (!r) {
    return {
      pipeline_version: pipeline.pipeline_version,
      planner: pipeline.planner,
      unsupported_jd: pipeline.unsupported_jd,
      jd_gate: pipeline.jd_gate,
      jd_relevance: pipeline.jd_relevance,
    };
  }
  return {
    pipeline_version: pipeline.pipeline_version,
    planner: pipeline.planner,
    beam: pipeline.beam,
    resume_confidence_score: r.resume_confidence_score,
    thesis: r.composition.narrative?.thesis,
    proof_template: r.composition.narrative?.proof_template,
    proof_chain: r.composition.narrative?.proof_chain,
    selected_acs: r.gate.metrics?.selected_acs,
    contribution_pruned: r.contribution_pruned,
    ac_contribution: r.contribution,
    hiring_manager_test: r.composition.quality?.hiring_manager_test,
    score_components: r.gate.score?.components,
    visual: r.gate.visual,
    skills: r.skills,
    ats_matrix: r.composition.ats_matrix,
    header_title: r.headerTitle,
    composition: r.compact,
    oracle: r.oracle,
    rulebook: r.rulebook,
    global_optimize: r.global_optimize,
    engineering_identity: r.global_optimize?.engineering_identity || r.global_optimize?.after?.engineering_identity,
    explain: buildComposeExplain(pipeline, pipeline.jd_gate),
  };
}
