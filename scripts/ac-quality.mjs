// Quality evaluation: optimize the hiring decision, not the resume artifact.
// Thesis → proof chain → information density → delete test → hiring manager confidence.

const FILLER_PATTERNS = [
  /^worked on\b/i,
  /^responsible for\b/i,
  /developing and implementing/i,
  /\bvarious\b/i,
  /\bhelped with\b/i,
  /\bassisted in\b/i,
  /\bin order to\b/i,
];

const STRONG_VERBS = new Set([
  "built", "engineered", "developed", "designed", "architected", "deployed",
  "optimized", "reduced", "achieved", "delivered", "implemented", "scaled",
  "automated", "orchestrated", "cut", "shipped", "launched",
]);

const WEAK_VERBS = new Set([
  "worked", "helped", "assisted", "participated", "supported", "contributed",
  "involved", "responsible",
]);

const TECH_TERMS = [
  "fastapi", "aws", "kafka", "docker", "python", "react", "pytorch", "langchain",
  "redis", "postgresql", "mongodb", "terraform", "kubernetes", "typescript",
  "node.js", "graphql", "elastic", "spark", "airflow", "celery", "nginx",
];

export const PROOF_CHAIN_STEPS = [
  {
    id: "result",
    label: "Big result",
    signals: [/reduced|cut|from\s+3|days?\s+to|under\s+\d+\s*min|\d+%/i],
    ac_ids: ["AC-001", "AC-023", "AC-019", "AC-042"],
  },
  {
    id: "how",
    label: "How",
    signals: [/built|engineered|fastapi|event-driven|platform|pipeline|microservice/i],
    ac_ids: ["AC-001", "AC-002", "AC-007", "AC-017"],
  },
  {
    id: "depth",
    label: "Depth",
    signals: [/agent|llm|rag|model|accuracy|debate|predictive|ml\b|pytorch/i],
    ac_ids: ["AC-023", "AC-024", "AC-025", "AC-016", "AC-022"],
  },
  {
    id: "scale",
    label: "Scale",
    signals: [/aws|deploy|production|users|kafka|million|years?\s+of|orchestrat/i],
    ac_ids: ["AC-001", "AC-007", "AC-015", "AC-002", "AC-017"],
  },
];

function bulletText(bullet) {
  return String(bullet.face?.text || bullet.text || "").trim();
}

function acId(bullet) {
  return bullet.ac?.id || bullet.ac_id;
}

export function analyzeBulletDensity(text) {
  const t = String(text || "").trim();
  const words = t.split(/\s+/).filter(Boolean);
  const wordCount = words.length || 1;
  const metrics = (t.match(/\d+[%+.]?|\d+\s*(min|minute|hour|day|year|k\+?)|under\s+\d+/gi) || []).length;
  const techs = new Set();
  const lower = t.toLowerCase();
  for (const tech of TECH_TERMS) {
    if (lower.includes(tech)) techs.add(tech);
  }
  const verb = words[0]?.toLowerCase().replace(/[^a-z]/g, "") || "";
  const strongVerb = STRONG_VERBS.has(verb) ? 1 : 0;
  const weakVerb = WEAK_VERBS.has(verb) ? 1 : 0;
  const fillerHits = FILLER_PATTERNS.filter((re) => re.test(t)).length;

  let wordsBeforeImpact = wordCount;
  const impactMatch = t.match(/\d|built|engineered|developed|reduced|achieved|deployed/i);
  if (impactMatch?.index != null) {
    wordsBeforeImpact = t.slice(0, impactMatch.index).split(/\s+/).filter(Boolean).length;
  }

  let score = 5;
  score += Math.min(2, metrics * 0.8);
  score += Math.min(2, techs.size * 0.5);
  score += strongVerb * 1.2;
  score -= weakVerb * 1.5;
  score -= fillerHits * 1.2;
  score -= Math.max(0, wordsBeforeImpact - 4) * 0.25;
  score = Math.max(0, Math.min(10, score));

  return {
    score: Number(score.toFixed(2)),
    metrics,
    technologies: [...techs],
    strong_verb: Boolean(strongVerb),
    weak_verb: Boolean(weakVerb),
    filler_hits: fillerHits,
    words_before_impact: wordsBeforeImpact,
    word_count: wordCount,
  };
}

export function classifyProofStep(text, acIdValue, templateSteps = null) {
  const steps = templateSteps || PROOF_CHAIN_STEPS;
  let best = null;
  let bestScore = 0;
  for (const step of steps) {
    let s = 0;
    if (step.ac_ids?.includes(acIdValue)) s += 1.5;
    for (const sig of step.signals || []) {
      if (sig.test(text)) s += 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = step.id;
    }
  }
  return bestScore > 0 ? best : null;
}

import { proofStepsForTemplate, resolveProofTemplate } from "./ac-proof-templates.mjs";

export function selectProofChain(bullets, narrative, templateSteps = null) {
  const steps = templateSteps || narrative?.proof_template_steps || [];
  const chain = [];
  const used = new Set();

  for (const step of steps) {
    let best = null;
    let bestScore = -1;
    for (const bullet of bullets) {
      const id = acId(bullet);
      if (!id || used.has(id)) continue;
      const text = bulletText(bullet);
      let s = 0;
      if (step.ac_ids?.includes(id)) s += 3;
      for (const sig of step.signals || []) if (sig.test(text)) s += 1.5;
      if (narrative) {
        const pillarBoost = (narrative.pillars || []).findIndex((p) => p.ac_ids?.includes(id));
        if (pillarBoost >= 0) s += 1 / (pillarBoost + 1);
      }
      if (s > bestScore) {
        bestScore = s;
        best = { step: step.id, label: step.label, ac_id: id, score: Number(s.toFixed(2)), preview: text.slice(0, 120) };
      }
    }
    if (best && bestScore > 0) {
      chain.push(best);
      used.add(best.ac_id);
    }
  }

  return chain;
}

export function orderBulletsForProofChain(bullets, proofChain, templateSteps = null) {
  if (!bullets?.length) return bullets;
  const steps = templateSteps || [];
  const stepOrder = new Map(steps.map((s, i) => [s.id, i]));
  const chainRank = new Map((proofChain || []).map((row, i) => [row.ac_id, i]));

  return [...bullets].sort((a, b) => {
    const aId = acId(a);
    const bId = acId(b);
    const aChain = chainRank.has(aId) ? chainRank.get(aId) : 99;
    const bChain = chainRank.has(bId) ? chainRank.get(bId) : 99;
    if (aChain !== bChain) return aChain - bChain;

    const aStep = classifyProofStep(bulletText(a), aId, steps);
    const bStep = classifyProofStep(bulletText(b), bId, steps);
    return (stepOrder.get(aStep) ?? 99) - (stepOrder.get(bStep) ?? 99);
  });
}

export function bulletQualityScore(ac, narrative = null, coveredPillars = new Set()) {
  const text = ac?.variants?.[0]?.text || ac?.fact || "";
  const density = analyzeBulletDensity(text);
  const recruiter = (ac?.strength?.recruiter || 8) / 10;
  let thesisMatch = 0.5;
  if (narrative?.pillars?.length) {
    let best = 0;
    for (const pillar of narrative.pillars) {
      if (pillar.ac_ids?.includes(ac.id)) best = Math.max(best, 0.85);
      const kwHit = (pillar.keywords || []).some((kw) => text.toLowerCase().includes(kw));
      if (kwHit) best = Math.max(best, 0.55);
    }
    thesisMatch = best || 0.35;
    if (coveredPillars.size && narrative.pillars.some((p) => coveredPillars.has(p.id) && p.ac_ids?.includes(ac.id))) {
      thesisMatch *= 0.75;
    }
  }
  const score = density.score / 10 * 0.45 + recruiter * 0.25 + thesisMatch * 0.3;
  return Number(score.toFixed(4));
}

function collectBullets(composition) {
  const bullets = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) bullets.push({ ...b, section: "experience", role: role.role });
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) bullets.push({ ...b, section: "project", role: project.role });
  }
  return bullets;
}

function thesisCoverage(composition, narrative) {
  if (!narrative?.pillars?.length) return 1;
  const ids = new Set(collectBullets(composition).map(acId).filter(Boolean));
  const covered = narrative.pillars.filter((p) => (p.ac_ids || []).some((id) => ids.has(id))).length;
  return covered / narrative.pillars.length;
}

function proofChainCompleteness(proofChain) {
  return (proofChain?.length || 0) / PROOF_CHAIN_STEPS.length;
}

function compositionValue(composition, narrative, proofChain) {
  const bullets = collectBullets(composition);
  const densities = bullets.map((b) => analyzeBulletDensity(bulletText(b)));
  const avgDensity = densities.length
    ? densities.reduce((s, d) => s + d.score, 0) / densities.length
    : 0;
  return (
    avgDensity * 0.35
    + thesisCoverage(composition, narrative) * 3
    + proofChainCompleteness(proofChain) * 2.5
    + bullets.length * 0.15
  );
}

export function runDeleteTest(composition, narrative, proofChain) {
  const baseline = compositionValue(composition, narrative, proofChain);
  const results = [];

  for (const role of composition.experience || []) {
    for (const bullet of role.bullets || []) {
      const id = acId(bullet);
      const without = {
        ...composition,
        experience: composition.experience.map((r) => ({
          ...r,
          bullets: r.bullets.filter((b) => acId(b) !== id),
        })),
      };
      const delta = baseline - compositionValue(without, narrative, proofChain.filter((p) => p.ac_id !== id));
      const text = bulletText(bullet);
      const density = analyzeBulletDensity(text);
      const replaceable = delta < 0.35 && density.score < 6.5;
      results.push({
        ac_id: id,
        role: role.role,
        replaceable,
        delta: Number(delta.toFixed(3)),
        verdict: replaceable ? "Not really." : "Story weakens without it.",
        density: density.score,
      });
    }
  }

  for (const project of composition.projects || []) {
    for (const bullet of project.bullets || []) {
      const id = acId(bullet);
      const without = {
        ...composition,
        projects: composition.projects.map((p) => ({
          ...p,
          bullets: p.bullets.filter((b) => acId(b) !== id),
        })),
      };
      const delta = baseline - compositionValue(without, narrative, proofChain.filter((p) => p.ac_id !== id));
      const density = analyzeBulletDensity(bulletText(bullet));
      const replaceable = delta < 0.3 && density.score < 6;
      results.push({
        ac_id: id,
        role: project.role,
        section: "project",
        replaceable,
        delta: Number(delta.toFixed(3)),
        verdict: replaceable ? "Not really." : "Story weakens without it.",
        density: density.score,
      });
    }
  }

  return {
    baseline_score: Number(baseline.toFixed(3)),
    bullets: results,
    deletable: results.filter((r) => r.replaceable).map((r) => r.ac_id),
    passes: results.every((r) => !r.replaceable),
  };
}

export function applyDeleteTest(composition, deleteResult) {
  const drop = new Set(deleteResult?.deletable || []);
  if (!drop.size) return composition;

  return {
    ...composition,
    experience: (composition.experience || []).map((role) => ({
      ...role,
      bullets: (role.bullets || []).filter((b) => !drop.has(acId(b))),
    })),
    projects: (composition.projects || []).map((project) => ({
      ...project,
      bullets: (project.bullets || []).filter((b) => !drop.has(acId(b))),
    })),
    quality_pruning: {
      removed_ac_ids: [...drop],
      reason: "delete_test",
    },
  };
}

export function analyzeInformationDensity(composition) {
  const bullets = collectBullets(composition);
  const perBullet = bullets.map((b) => {
    const text = bulletText(b);
    return {
      ac_id: acId(b),
      role: b.role,
      section: b.section,
      ...analyzeBulletDensity(text),
    };
  });

  const n = perBullet.length || 1;
  const avg = (key) => Number((perBullet.reduce((s, row) => s + (row[key] || 0), 0) / n).toFixed(2));

  const lowDensity = perBullet.filter((b) => b.score < 5.5).map((b) => b.ac_id);
  const fillerBullets = perBullet.filter((b) => b.filler_hits > 0 || b.weak_verb).map((b) => b.ac_id);

  return {
    bullets: perBullet,
    aggregate: {
      avg_density: avg("score"),
      avg_metrics_per_bullet: avg("metrics"),
      avg_technologies_per_bullet: Number((perBullet.reduce((s, b) => s + (b.technologies?.length || 0), 0) / n).toFixed(2)),
      avg_words_before_impact: avg("words_before_impact"),
      low_density_ac_ids: lowDensity,
      filler_ac_ids: fillerBullets,
    },
    passes: lowDensity.length === 0 && fillerBullets.length === 0,
    diagnosis: lowDensity.length
      ? `${lowDensity.length} bullet(s) below density threshold — tighten or delete.`
      : "Every line packs evidence and impact.",
  };
}

export function hiringManagerTest(composition, narrative, bank, { skillsAudit = null } = {}) {
  const bullets = collectBullets(composition);
  const densities = bullets.map((b) => analyzeBulletDensity(bulletText(b)));
  const avgDensity = densities.length
    ? densities.reduce((s, d) => s + d.score, 0) / densities.length
    : 0;
  const metricBullets = densities.filter((d) => d.metrics > 0).length / (densities.length || 1);
  const techBullets = densities.filter((d) => d.technologies.length > 0).length / (densities.length || 1);
  const productionSignals = bullets.filter((b) => /production|deploy|users|aws|shipped/i.test(bulletText(b))).length;
  const proofChain = composition.narrative?.proof_chain || [];
  const deleteTest = composition.delete_test;

  const technicalConfidence = Math.min(10, 5 + techBullets * 3 + avgDensity * 0.25 + (proofChain.length >= 2 ? 1 : 0));
  const businessImpact = Math.min(10, 4 + metricBullets * 4 + (thesisCoverage(composition, narrative) * 2));
  const executionConfidence = Math.min(10, 4 + (productionSignals / (bullets.length || 1)) * 4 + proofChainCompleteness(proofChain) * 2);
  const uniqueness = Math.min(10, 6 + (deleteTest?.passes ? 1.5 : 0) + (narrative?.thesis ? 1 : 0));
  const unsupportedInOutput = (skillsAudit || []).filter((s) => {
    if (s.covered) return false;
    return (composition.skills || []).some((line) => line.toLowerCase().includes(s.skill.toLowerCase()));
  });
  const unclaimable = composition.coverage?.unclaimable?.length || 0;
  const riskOfOverclaiming = Number(Math.min(1, (unclaimable * 0.08 + unsupportedInOutput.length * 0.15)).toFixed(2));

  const composite = (
    technicalConfidence * 0.28
    + businessImpact * 0.28
    + executionConfidence * 0.24
    + uniqueness * 0.2
  ) - riskOfOverclaiming * 2;

  const because = [];
  const concerns = [];

  if (metricBullets >= 0.6) because.push("Exceptional quantified impact");
  else if (metricBullets >= 0.4) because.push("Solid measurable outcomes");

  if (technicalConfidence >= 8.5) because.push("Strong technical depth with named systems");
  if (businessImpact >= 8) because.push("Clear business and research impact");
  if (executionConfidence >= 8) because.push("Production delivery signals");
  if (proofChain.length >= 3) because.push("Proof chain builds confidence step by step");
  if (deleteTest?.passes) because.push("Every bullet earns its place");
  if (avgDensity >= 7.5) because.push("High information density");

  if (technicalConfidence < 7.5) concerns.push("Technical depth not immediately obvious");
  if (businessImpact < 7) concerns.push("Business impact could be sharper");
  if (proofChain.length < 3) concerns.push("Incomplete proof chain (result → how → depth → scale)");
  if (riskOfOverclaiming > 0.3) concerns.push("Risk of overclaiming on skills or keywords");
  for (const row of (skillsAudit || []).filter((s) => s.jd_relevant && !s.covered).slice(0, 4)) {
    concerns.push(`No ${row.skill} evidence`);
  }
  if (!deleteTest?.passes) concerns.push("Replaceable bullets weaken the story");

  const wouldInterview = composite >= 7.8
    && technicalConfidence >= 7.5
    && businessImpact >= 7
    && riskOfOverclaiming <= 0.45
    && (deleteTest?.passes !== false);

  return {
    objective: "optimize_hiring_decision",
    thesis: narrative?.thesis || null,
    technical_confidence: Number(technicalConfidence.toFixed(1)),
    business_impact: Number(businessImpact.toFixed(1)),
    execution_confidence: Number(executionConfidence.toFixed(1)),
    uniqueness: Number(uniqueness.toFixed(1)),
    risk_of_overclaiming: riskOfOverclaiming,
    would_interview: wouldInterview,
    because,
    concerns: [...new Set(concerns)],
    composite: Number(composite.toFixed(1)),
    questions: {
      can_do_job: technicalConfidence >= 7.5,
      solves_problems: businessImpact >= 7,
      would_interview: wouldInterview,
    },
    diagnosis: wouldInterview
      ? "A hiring manager would likely advance this candidate to interview."
      : "Confidence gaps remain — strengthen proof chain, metrics, or remove weak bullets.",
  };
}

export function runQualityEvaluation(composition, narrative, bank, { skillsAudit = null } = {}) {
  const proofChain = composition.narrative?.proof_chain
    || selectProofChain(collectBullets(composition), narrative);
  const deleteTest = runDeleteTest(composition, narrative, proofChain);
  const informationDensity = analyzeInformationDensity(composition);
  const hiringManager = hiringManagerTest(composition, narrative, bank, { skillsAudit });

  return {
    proof_chain: proofChain,
    delete_test: deleteTest,
    information_density: informationDensity,
    hiring_manager_test: hiringManager,
  };
}
