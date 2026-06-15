// PDF gate — judge and score candidates; never the executioner.

import { verifyInvariant } from "./ac-invariant.mjs";
import { evidenceCompressionRatio } from "./ac-pdf-gate-metrics.mjs";
import { resumeConfidenceScore } from "./ac-resume-score.mjs";
import { analyzeVisualLayout } from "./ac-visual.mjs";

export { evidenceCompressionRatio } from "./ac-pdf-gate-metrics.mjs";

function collectBullets(composition) {
  const bullets = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) bullets.push(b);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) bullets.push(b);
  }
  return bullets;
}

export function scorePdf({
  composition,
  bank,
  skills,
  pages,
  oracle,
  tex,
}) {
  const invariant = verifyInvariant({ ...composition, skills }, bank);
  const compression = evidenceCompressionRatio(composition, skills);
  const visual = tex ? analyzeVisualLayout(tex) : null;
  const bullets = collectBullets(composition);

  const score = resumeConfidenceScore({
    composition,
    oracle,
    evidenceCompression: compression,
    pages,
    invariantPass: invariant.passes,
    skills,
  });

  const signals = {
    one_page: pages === 1,
    bullet_count: bullets.length,
    invariant: invariant.passes,
    duplicate_metric_penalty: score.components.diversity < 70,
    repeated_verb_penalty: score.components.diversity < 80,
    proof_chain_steps: composition.narrative?.proof_chain?.length ?? 0,
  };

  return {
    ...score,
    invariant,
    evidence_compression: compression,
    visual,
    signals,
    metrics: {
      pages,
      bullet_count: bullets.length,
      word_count: compression.words_in_resume,
      oracle_score: oracle?.oracle_score ?? null,
      selected_acs: invariant.selected_acs,
    },
  };
}

/** @deprecated use scorePdf — kept as alias for compatibility */
export function runPdfGate(args) {
  const scored = scorePdf(args);
  return {
    contract: "pdf",
    passes: scored.invariant.passes,
    hard_passes: scored.invariant.passes,
    resume_confidence_score: scored.resume_confidence_score,
    score: scored,
    checks: Object.entries(scored.signals).map(([id, pass]) => ({ id, pass, label: id })),
    failed: Object.entries(scored.signals).filter(([, p]) => !p).map(([id]) => id),
    invariant: scored.invariant,
    evidence_compression: scored.evidence_compression,
    visual: scored.visual,
    metrics: scored.metrics,
  };
}

export function formatGateReport(gate) {
  const rcs = gate.resume_confidence_score ?? gate.score?.resume_confidence_score;
  const lines = [`Resume Confidence Score: ${rcs}`];
  const components = gate.score?.components || gate.components;
  if (components) {
    for (const [k, v] of Object.entries(components)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  if (gate.candidates?.length) {
    lines.push("Beam candidates:");
    for (const c of gate.candidates) {
      lines.push(`  ${c.variant_id}: ${c.resume_confidence_score}`);
    }
  }
  return lines.join("\n");
}
