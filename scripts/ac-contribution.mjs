// AC contribution analysis — leave-one-out marginal impact on Resume Confidence Score.

import { resumeConfidenceScore } from "./ac-resume-score.mjs";
import { evidenceCompressionRatio } from "./ac-pdf-gate.mjs";

function acIds(composition) {
  const ids = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  return [...new Set(ids.filter(Boolean))];
}

function withoutAc(composition, dropId) {
  return {
    ...composition,
    experience: (composition.experience || []).map((role) => ({
      ...role,
      bullets: (role.bullets || []).filter((b) => (b.ac_id || b.ac?.id) !== dropId),
    })),
    projects: (composition.projects || []).map((project) => ({
      ...project,
      bullets: (project.bullets || []).filter((b) => (b.ac_id || b.ac?.id) !== dropId),
    })),
  };
}

function scoreComposition(composition, { oracle, skills, invariantPass = true } = {}) {
  const compression = evidenceCompressionRatio(composition, skills);
  return resumeConfidenceScore({
    composition,
    oracle,
    evidenceCompression: compression,
    invariantPass,
  }).resume_confidence_score;
}

export function analyzeAcContribution(composition, { oracle, skills, invariantPass = true } = {}) {
  const baseline = scoreComposition(composition, { oracle, skills, invariantPass });
  const contributions = [];

  for (const id of acIds(composition)) {
    const removed = withoutAc(composition, id);
    const without = scoreComposition(removed, { oracle, skills, invariantPass });
    const contribution = Number((baseline - without).toFixed(2));
    contributions.push({
      ac_id: id,
      contribution,
      verdict: contribution < 0 ? "omit_candidate" : contribution < 0.5 ? "weak" : "keep",
    });
  }

  contributions.sort((a, b) => b.contribution - a.contribution);
  return {
    baseline_score: Number(baseline.toFixed(1)),
    contributions,
    omit_candidates: contributions.filter((c) => c.contribution < 0).map((c) => c.ac_id),
  };
}
