// Proof chain templates — selected by thesis/narrative, not one-size-fits-all.

export const PROOF_TEMPLATES = {
  "ai-engineer": {
    id: "ai-result-how-depth-scale",
    steps: [
      { id: "result", label: "Big result", signals: [/reduced|cut|days?\s+to|under\s+\d+\s*min|\d+%/i], ac_ids: ["AC-001", "AC-023", "AC-019"] },
      { id: "how", label: "How", signals: [/built|engineered|fastapi|event-driven|platform|pipeline/i], ac_ids: ["AC-001", "AC-002", "AC-007", "AC-017"] },
      { id: "depth", label: "AI depth", signals: [/agent|llm|rag|model|accuracy|debate|predictive/i], ac_ids: ["AC-023", "AC-024", "AC-025", "AC-022"] },
      { id: "scale", label: "Scale", signals: [/aws|deploy|production|users|kafka|million/i], ac_ids: ["AC-001", "AC-007", "AC-015", "AC-002"] },
    ],
  },
  "backend-engineer": {
    id: "backend-scale-arch-perf-impact",
    steps: [
      { id: "scale", label: "Scale", signals: [/million|10k|200k|users|transactions|records/i], ac_ids: ["AC-001", "AC-008", "AC-002", "AC-017"] },
      { id: "architecture", label: "Architecture", signals: [/event-driven|microservice|kafka|fastapi|pipeline|streaming/i], ac_ids: ["AC-001", "AC-002", "AC-007", "AC-017"] },
      { id: "performance", label: "Performance", signals: [/latency|200ms|p99|optimized|performance|under\s+\d+/i], ac_ids: ["AC-001", "AC-007", "AC-008"] },
      { id: "business-impact", label: "Business impact", signals: [/uptime|99%|profit|return|reduced|cut/i], ac_ids: ["AC-001", "AC-002", "AC-008"] },
    ],
  },
  "data-engineer": {
    id: "data-pipeline-scale-platform",
    steps: [
      { id: "pipeline", label: "Pipeline", signals: [/pipeline|etl|kafka|streaming|ingestion/i], ac_ids: ["AC-001", "AC-002", "AC-017", "AC-031"] },
      { id: "scale", label: "Scale", signals: [/million|200k|years|records/i], ac_ids: ["AC-001", "AC-002", "AC-031"] },
      { id: "platform", label: "Platform", signals: [/postgres|elastic|warehouse|platform|production/i], ac_ids: ["AC-017", "AC-015", "AC-031"] },
      { id: "impact", label: "Impact", signals: [/ml|model|feature|research|accuracy/i], ac_ids: ["AC-002", "AC-031", "AC-019"] },
    ],
  },
  "full-stack": {
    id: "product-ownership-execution",
    steps: [
      { id: "ownership", label: "Ownership", signals: [/built|shipped|launched|product|platform/i], ac_ids: ["AC-015", "AC-040", "AC-030"] },
      { id: "execution", label: "Execution", signals: [/react|fastapi|full-stack|users|production/i], ac_ids: ["AC-015", "AC-040", "AC-029"] },
      { id: "speed", label: "Speed", signals: [/reduced|35%|automated|under\s+\d+/i], ac_ids: ["AC-029", "AC-041", "AC-028"] },
      { id: "impact", label: "Impact", signals: [/1k|3k|users|employees|engagement/i], ac_ids: ["AC-015", "AC-040", "AC-030"] },
    ],
  },
  startup: {
    id: "startup-ownership-speed-impact",
    steps: [
      { id: "ownership", label: "Ownership", signals: [/built|shipped|launched|end to end|product/i], ac_ids: ["AC-015", "AC-040", "AC-016"] },
      { id: "execution", label: "Execution", signals: [/production|deploy|users|fastapi|react/i], ac_ids: ["AC-015", "AC-040", "AC-001"] },
      { id: "speed", label: "Speed", signals: [/under\s+\d+|reduced|automated|cut/i], ac_ids: ["AC-001", "AC-041", "AC-029"] },
      { id: "impact", label: "Impact", signals: [/1k|users|accuracy|return|profit/i], ac_ids: ["AC-023", "AC-015", "AC-002"] },
    ],
  },
};

export function resolveProofTemplate(narrative, jd) {
  const hay = ` ${String(jd || "").toLowerCase()} `;
  if (/startup|founding|0\s*to\s*1|early.?stage|seed/i.test(hay)) {
    return { ...PROOF_TEMPLATES.startup, narrative_id: narrative?.id };
  }
  const key = narrative?.id || "backend-engineer";
  return { ...(PROOF_TEMPLATES[key] || PROOF_TEMPLATES["backend-engineer"]), narrative_id: key };
}

export function proofStepsForTemplate(template) {
  return template?.steps || PROOF_TEMPLATES["ai-engineer"].steps;
}
