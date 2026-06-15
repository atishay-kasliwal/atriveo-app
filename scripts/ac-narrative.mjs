// Narrative-first planning: select a thesis and proof chain before AC selection.
// Objective: maximize hiring-manager confidence, not keyword count.

import {
  selectProofChain,
  orderBulletsForProofChain,
  bulletQualityScore,
} from "./ac-quality.mjs";
import { resolveProofTemplate, proofStepsForTemplate } from "./ac-proof-templates.mjs";

const NARRATIVES = {
  "ai-engineer": {
    id: "ai-engineer",
    title: "AI Engineer",
    thesis: "Engineer who builds production AI systems with measurable business impact.",
    pillars: [
      { id: "multi-agent", label: "Multi-Agent Systems", keywords: ["agent", "agents", "mcp", "langgraph", "orchestr"], ac_ids: ["AC-023", "AC-024", "AC-025", "AC-016"], facets: ["llm", "mcp-agents", "ai"] },
      { id: "llm-evaluation", label: "LLM Evaluation", keywords: ["evaluation", "benchmark", "accuracy", "rag", "llm"], ac_ids: ["AC-022", "AC-023", "AC-025"], facets: ["llm"] },
      { id: "backend-infra", label: "Backend Infrastructure", keywords: ["fastapi", "api", "microservice", "backend"], ac_ids: ["AC-001", "AC-002", "AC-017", "AC-018"], facets: ["backend", "performance"] },
      { id: "performance", label: "Performance Optimization", keywords: ["performance", "latency", "optimization", "throughput"], ac_ids: ["AC-001", "AC-002", "AC-018"], facets: ["performance"] },
      { id: "production", label: "Production Deployment", keywords: ["production", "deploy", "users", "uptime", "cloud"], ac_ids: ["AC-015", "AC-001", "AC-003", "AC-020"], facets: ["cloud", "reliability"] },
    ],
    proof_candidates: ["AC-026", "AC-001", "AC-023", "AC-025", "AC-002", "AC-012"],
    jd_signals: ["ai engineer", "llm", "agent", "machine learning", "rag", "generative"],
  },
  "backend-engineer": {
    id: "backend-engineer",
    title: "Backend Engineer",
    thesis: "Backend engineer specializing in high-performance event-driven systems.",
    pillars: [
      { id: "fastapi-apis", label: "FastAPI & APIs", keywords: ["fastapi", "rest", "api", "graphql"], ac_ids: ["AC-001", "AC-002", "AC-003", "AC-021"], facets: ["backend"] },
      { id: "event-driven", label: "Event-Driven Systems", keywords: ["event", "kafka", "streaming", "pipeline"], ac_ids: ["AC-001", "AC-002", "AC-004", "AC-006"], facets: ["data-pipeline", "backend"] },
      { id: "performance", label: "Performance", keywords: ["performance", "latency", "optimization"], ac_ids: ["AC-001", "AC-002", "AC-019"], facets: ["performance"] },
      { id: "cloud", label: "Cloud", keywords: ["aws", "cloud", "docker", "deploy"], ac_ids: ["AC-001", "AC-003", "AC-015", "AC-020"], facets: ["cloud"] },
      { id: "reliability", label: "Reliability", keywords: ["reliability", "gateway", "auth", "security"], ac_ids: ["AC-021", "AC-018", "AC-027"], facets: ["reliability", "security"] },
    ],
    proof_candidates: ["AC-026", "AC-001", "AC-002", "AC-003", "AC-004"],
    jd_signals: ["backend", "fastapi", "microservice", "api", "distributed"],
  },
  "data-engineer": {
    id: "data-engineer",
    title: "Data Engineer",
    thesis: "Data engineer who transforms complex pipelines into scalable production platforms.",
    pillars: [
      { id: "pipelines", label: "Data Pipelines", keywords: ["pipeline", "etl", "kafka", "streaming"], ac_ids: ["AC-002", "AC-004", "AC-006", "AC-031"], facets: ["data", "data-pipeline"] },
      { id: "scale", label: "Scale", keywords: ["million", "200k", "years", "records"], ac_ids: ["AC-001", "AC-002", "AC-031"], facets: ["data"] },
      { id: "ml-data", label: "ML on Data", keywords: ["machine learning", "pytorch", "model"], ac_ids: ["AC-002", "AC-019", "AC-042"], facets: ["ml", "nlp-ai"] },
      { id: "storage", label: "Storage", keywords: ["postgres", "mongo", "elastic", "redis"], ac_ids: ["AC-015", "AC-017", "AC-018"], facets: ["data-pipeline"] },
    ],
    proof_candidates: ["AC-001", "AC-017", "AC-002", "AC-031"],
    jd_signals: ["data engineer", "etl", "pipeline", "warehouse", "spark"],
  },
  "full-stack": {
    id: "full-stack",
    title: "Full Stack Engineer",
    thesis: "Full-stack engineer who ships production products end to end.",
    pillars: [
      { id: "frontend", label: "Frontend", keywords: ["react", "typescript", "ui", "dashboard"], ac_ids: ["AC-015", "AC-040"], facets: ["frontend"] },
      { id: "backend", label: "Backend", keywords: ["fastapi", "node", "api"], ac_ids: ["AC-001", "AC-015", "AC-003"], facets: ["backend"] },
      { id: "product", label: "Product Delivery", keywords: ["users", "production", "launch"], ac_ids: ["AC-015", "AC-040", "AC-041"], facets: ["cloud-serverless"] },
      { id: "ai-product", label: "AI Product", keywords: ["llm", "recommendation", "personalized"], ac_ids: ["AC-016", "AC-025", "AC-040"], facets: ["llm-ai"] },
    ],
    proof_candidates: ["AC-015", "AC-001", "AC-016", "AC-040"],
    jd_signals: ["full stack", "fullstack", "frontend", "react"],
  },
};

function normalizeHaystack(jd) {
  return ` ${String(jd || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
}

function acText(ac) {
  return `${ac.fact || ""} ${(ac.variants || []).map((v) => v.text).join(" ")}`;
}

function acMatchesPillar(ac, pillar) {
  const text = acText(ac).toLowerCase();
  const id = ac.id;
  if (pillar.ac_ids?.includes(id)) return 0.85;
  const kwHit = (pillar.keywords || []).some((kw) => text.includes(kw.toLowerCase()));
  if (kwHit) return 0.65;
  const facetHit = (ac.variants || []).some((v) =>
    pillar.facets?.includes(v.facet || v.emphasis),
  );
  if (facetHit) return 0.55;
  return 0;
}

export function selectNarrative(jd, theme) {
  const hay = normalizeHaystack(jd);
  const themeName = theme?.name || "";

  let best = NARRATIVES["backend-engineer"];
  let bestScore = 0;

  for (const narrative of Object.values(NARRATIVES)) {
    let s = 0;
    for (const sig of narrative.jd_signals || []) {
      if (hay.includes(` ${sig} `) || hay.includes(` ${sig},`)) s += 2;
    }
    if (themeName === "ai-llm" && narrative.id === "ai-engineer") s += 4;
    if (themeName === "backend" && narrative.id === "backend-engineer") s += 4;
    if (themeName === "data-engineering" && narrative.id === "data-engineer") s += 4;
    if (themeName === "full-stack" && narrative.id === "full-stack") s += 4;
    if (s > bestScore) {
      bestScore = s;
      best = narrative;
    }
  }

  const pillars = best.pillars.map((pillar) => {
    let weight = 1;
    for (const kw of pillar.keywords || []) {
      if (hay.includes(` ${kw} `) || hay.includes(` ${kw},`)) weight += 0.35;
    }
    return { ...pillar, weight: Number(weight.toFixed(2)) };
  }).sort((a, b) => b.weight - a.weight);

  return {
    ...best,
    pillars,
    header_title: best.title,
    thesis: best.thesis,
  };
}

export function narrativeScoreAc(ac, narrative, coveredPillars = new Set()) {
  let bestPillar = null;
  let bestMatch = 0;

  for (const pillar of narrative.pillars || []) {
    const m = acMatchesPillar(ac, pillar);
    if (m > bestMatch) {
      bestMatch = m;
      bestPillar = pillar.id;
    }
  }

  let boost = bestMatch * (narrative.pillars.find((p) => p.id === bestPillar)?.weight || 1) * 0.12;
  if (bestPillar && !coveredPillars.has(bestPillar)) boost += 0.15;
  if (coveredPillars.has(bestPillar)) boost -= 0.08;

  return { boost, pillar: bestPillar, match: bestMatch };
}

export { bulletQualityScore, orderBulletsForProofChain, selectProofChain };

export function planNarrative(jd, theme, bank) {
  const narrative = selectNarrative(jd, theme);
  const proofTemplate = resolveProofTemplate(narrative, jd);
  const proof_template_steps = proofStepsForTemplate(proofTemplate);
  const candidateBullets = (bank?.acs || [])
    .filter((ac) => (narrative.proof_candidates || []).includes(ac.id))
    .map((ac) => ({ ac, face: { text: ac.variants?.[0]?.text || ac.fact || "" } }));
  const proof_chain = selectProofChain(candidateBullets, narrative, proof_template_steps);

  return {
    ...narrative,
    proof_template: proofTemplate.id,
    proof_template_steps,
    proof_chain,
    objective: "maximize_resume_confidence_score",
  };
}
