// Resume Oracle: deterministic composite score for planner comparison.
// Same oracle judges every planner version in the simulator.

const DUPLICATE_PAIRS = [
  ["AC-001", "AC-002"],
  ["AC-010", "AC-027"],
];

function selectedIds(composition) {
  const ids = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) ids.push(b.ac_id || b.ac?.id);
  }
  return ids.filter(Boolean);
}

function countAiBullets(composition) {
  let n = 0;
  const bullets = [];
  for (const role of composition.experience || []) bullets.push(...(role.bullets || []));
  for (const project of composition.projects || []) bullets.push(...(project.bullets || []));
  for (const b of bullets) {
    const text = String(b.text || b.face?.text || "").toLowerCase();
    const facet = String(b.facet || b.face?.facet || "").toLowerCase();
    if (/llm|machine learning|\bai\b|agent|rag|langchain/.test(`${facet} ${text}`)) n += 1;
  }
  return n;
}

function uniqueVerbs(composition) {
  const verbs = new Set();
  const bullets = [];
  for (const role of composition.experience || []) bullets.push(...(role.bullets || []));
  for (const project of composition.projects || []) bullets.push(...(project.bullets || []));
  for (const b of bullets) {
    const text = String(b.text || b.face?.text || "").trim();
    const verb = text.split(/\s+/)[0]?.toLowerCase();
    if (verb) verbs.add(verb);
  }
  return verbs.size;
}

function constraintViolations(composition) {
  const violations = [];
  const selected = selectedIds(composition);
  const ai = countAiBullets(composition);
  if (ai > 3) violations.push({ type: "ai_budget", count: ai });

  for (const [a, b] of DUPLICATE_PAIRS) {
    if (selected.includes(a) && selected.includes(b)) {
      violations.push({ type: "duplicate_story", ac_ids: [a, b] });
    }
  }

  const rejected = composition.selection_trace?.rejected || [];
  for (const r of rejected) {
    if (r.reason?.startsWith("exceeded_")) {
      violations.push({ type: "near_miss_constraint", ac_id: r.ac_id, reason: r.reason });
    }
  }
  return violations;
}

export function scoreOracle(composition, { historicalReward = null, humanReadability = null } = {}) {
  const coverage = composition.coverage || {};
  const ats = Math.round((coverage.weighted_coverage || 0) * 100);
  const readability = humanReadability ?? 8.0;
  const diversity = Math.min(100, uniqueVerbs(composition) * 12);
  const violations = constraintViolations(composition);
  const evidencePurity = Math.max(0, 100 - (coverage.unclaimable?.length || 0) * 8);
  const constraintCompliance = violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 15);
  const historical = historicalReward != null ? Math.round(historicalReward * 100) : 50;

  const components = {
    ats,
    readability: Number((readability * 10).toFixed(1)),
    diversity,
    evidence_purity: evidencePurity,
    constraint_compliance: constraintCompliance,
    historical_reward: historical,
  };

  const oracleScore = Number((
    components.ats * 0.22
    + components.readability * 0.18
    + components.diversity * 0.10
    + components.evidence_purity * 0.18
    + components.constraint_compliance * 0.17
    + components.historical_reward * 0.15
  ).toFixed(2));

  return {
    oracle_score: oracleScore,
    components,
    metrics: {
      coverage_pct: ats,
      duplicate_stories: violations.filter((v) => v.type === "duplicate_story").length,
      avg_ai_bullets: countAiBullets(composition),
      constraint_violations: violations.length,
      missing_claimable: (coverage.missing_claimable || []).length,
      unclaimable: (coverage.unclaimable || []).length,
    },
    violations,
  };
}
