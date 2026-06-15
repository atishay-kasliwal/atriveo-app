// Resume Confidence Score — single north-star objective for beam search.

import { scoreAtsMatrix } from "./ac-ats-matrix.mjs";

const WEIGHTS = {
  hiring_manager: 0.30,
  information_density: 0.20,
  evidence_compression: 0.15,
  proof_chain: 0.15,
  diversity: 0.10,
  ats: 0.05,
};

function bulletText(bullet) {
  return String(bullet.face?.text || bullet.text || "").trim();
}

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

function extractVerbs(composition) {
  return collectBullets(composition)
    .map((b) => bulletText(b).split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

function extractMetrics(text) {
  return (String(text).match(/\d+[%+.]?|\d+\s*(min|minute|hour|day|year|k\+?)|under\s+\d+|\$\d[\d.,k]*/gi) || [])
    .map((m) => m.toLowerCase());
}

function norm0to100(value, max = 10) {
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function scoreDiversity(composition) {
  const verbs = extractVerbs(composition);
  const uniqueVerbs = new Set(verbs).size;
  const verbRatio = verbs.length ? uniqueVerbs / verbs.length : 0;

  const metrics = collectBullets(composition).flatMap((b) => extractMetrics(bulletText(b)));
  const uniqueMetrics = new Set(metrics).size;
  const metricDupes = metrics.length - uniqueMetrics;
  const metricPenalty = Math.min(30, metricDupes * 8);

  const verbPenalty = verbs.length > uniqueVerbs ? (verbs.length - uniqueVerbs) * 6 : 0;
  const raw = verbRatio * 100 - metricPenalty - verbPenalty;
  return Number(Math.max(0, Math.min(100, raw)).toFixed(1));
}

export function scoreProofChain(composition, templateSteps) {
  const chain = composition.narrative?.proof_chain || [];
  const required = templateSteps?.length || 4;
  const completeness = chain.length / required;
  const thesisHits = (composition.narrative?.pillars || []).filter((p) =>
    (p.ac_ids || []).some((id) => collectBullets(composition).some((b) => (b.ac_id || b.ac?.id) === id)),
  ).length;
  const thesisBoost = Math.min(20, thesisHits * 5);
  return Number(Math.min(100, completeness * 80 + thesisBoost).toFixed(1));
}

export function resumeConfidenceScore({
  composition,
  oracle,
  evidenceCompression,
  pages = 1,
  invariantPass = true,
  skills = [],
}) {
  const quality = composition.quality || {};
  const hm = quality.hiring_manager_test || {};
  const density = quality.information_density?.aggregate || {};

  const skillsLines = skills.length ? skills : composition.skills || [];
  const matrixScore = composition.ats_matrix?.score ?? scoreAtsMatrix(composition, skillsLines);
  const jdCoverage = (composition.coverage?.weighted_coverage ?? 0) * 100;

  const components = {
    hiring_manager: norm0to100(hm.composite ?? 0, 10),
    information_density: norm0to100(density.avg_density ?? 0, 10),
    evidence_compression: norm0to100((evidenceCompression?.ratio ?? 0) * 100, 40),
    proof_chain: scoreProofChain(composition, composition.narrative?.proof_template_steps),
    diversity: scoreDiversity(composition),
    ats: Number((matrixScore * 0.55 + jdCoverage * 0.45).toFixed(1)),
  };

  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += (components[key] ?? 0) * weight;
  }

  if (pages > 1) score -= 15;
  if (!invariantPass) score -= 50;

  return {
    resume_confidence_score: Number(score.toFixed(1)),
    components,
    weights: WEIGHTS,
    formula: "0.30×HM + 0.20×Density + 0.15×Compression + 0.15×Proof + 0.10×Diversity + 0.05×ATS",
  };
}

export { WEIGHTS };
