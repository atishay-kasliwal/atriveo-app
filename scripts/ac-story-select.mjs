// Story-first triple selection — optimize the impression of 3 bullets together,
// not individual keyword match or theme diversity.

import { atsPenaltyForAddingTexts, bulletTextsFromAcs } from "./ac-ats-matrix.mjs";

const DEFAULT_WEIGHTS = {
  jd_match: 1.0,
  wow: 0.85,
  recruiter: 1.0,
  story_completion: 0.45,
  metric_overlap: 0.25,
  concept_overlap: 0.3,
  capability: 0.35,
};

const DEFAULT_PACKAGES = [
  {
    name: "backend",
    ids: ["AC-031", "AC-032", "AC-049"],
    jd_signals: ["backend", "distributed", "pipeline", "cloud", "infra", "platform", "microservice", "api", "engineer"],
  },
  {
    name: "ai-ml",
    ids: ["AC-031", "AC-033", "AC-044"],
    jd_signals: ["machine learning", "ml", "ai", "computer vision", "model", "deep learning", "research scientist"],
  },
  {
    name: "product",
    ids: ["AC-031", "AC-047", "AC-048"],
    jd_signals: ["frontend", "dashboard", "product manager", "full stack", "ux", "ui engineer", "frontend engineer"],
  },
  {
    name: "research",
    ids: ["AC-031", "AC-045", "AC-046"],
    jd_signals: ["research", "survival", "analytics", "data science", "statistics", "clinical", "prognosis"],
  },
];

function sortAcsByDisplayOrder(list) {
  return [...list].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

/** Preserve curated package order: pinned first, then pkg.ids sequence. */
export function orderPackageBullets(pinned, pkgIds, roleAcs) {
  const pinnedIds = new Set((pinned || []).map((a) => a.id));
  const evidence = (pkgIds || [])
    .filter((id) => !pinnedIds.has(id))
    .map((id) => roleAcs.find((a) => a.id === id))
    .filter(Boolean);
  return [...(pinned || []), ...evidence];
}

function jdSignalHits(jd, signals = []) {
  const text = String(jd || "").toLowerCase();
  return signals.filter((sig) => text.includes(String(sig).toLowerCase())).length;
}

const STRONG_FRONTEND_SIGNALS = [
  "frontend engineer",
  "front-end engineer",
  "frontend developer",
  "front end developer",
  "ui engineer",
  "ux engineer",
  "react developer",
  "frontend role",
  "clinician dashboard",
  "user interface",
  "user experience",
  "product designer",
];

const STRONG_BACKEND_SIGNALS = [
  "backend engineer",
  "backend developer",
  "java developer",
  "java software",
  "software developer",
  "software engineer",
  "platform engineer",
  "data engineer",
  "infrastructure engineer",
  "microservice",
  "distributed system",
  "apache airflow",
  "etl pipeline",
  "cloud engineer",
  "spring",
  "scalable",
  "api",
];

const INCIDENTAL_FRONTEND_TERMS = [
  "react",
  "react.js",
  "angular",
  "typescript",
  "javascript",
  "css",
  "html5",
  "html",
];

function extractJdTitle(jd) {
  const labeled = jd.match(/\*\*(?:Job Title|Role|Position|Title):\*\*\s*([^\n]+)/i)
    || jd.match(/\*\*Role:\*\*\s*([^\n]+)/i);
  if (labeled?.[1]) return labeled[1].replace(/\\-/g, "-").trim();
  for (const line of String(jd || "").split("\n")) {
    const m = line.match(/\*\*([^*]{5,80})\*\*/);
    if (!m?.[1]) continue;
    const t = m[1].replace(/\\-/g, "-").trim();
    if (/engineer|developer|scientist|architect|analyst|researcher/i.test(t)) return t;
  }
  return "";
}

export function jdRoleProfile(jd) {
  const text = String(jd || "").toLowerCase();
  const title = extractJdTitle(jd).toLowerCase();
  const strongFrontend = STRONG_FRONTEND_SIGNALS.filter((s) => text.includes(s)).length
    + (/\b(frontend|front-end|ui\/ux|ux\/ui)\b/.test(title) ? 2 : 0);
  const strongBackend = STRONG_BACKEND_SIGNALS.filter((s) => text.includes(s)).length
    + (/\b(java|backend|platform|infra|data engineer|software engineer|software developer)\b/.test(title) ? 2 : 0);
  const incidentalFrontend = INCIDENTAL_FRONTEND_TERMS.filter((s) => text.includes(s)).length;
  const titleFrontend = /\b(frontend|front-end|ui engineer|ux engineer|react developer|full.?stack)\b/.test(title);
  const titleBackend = /\b(java|backend|software engineer|software developer|platform engineer|data engineer|infra)\b/.test(title);
  const frontendPrimary = titleFrontend || strongFrontend >= 1;
  const backendPrimary = titleBackend || strongBackend >= 2;
  return {
    strongFrontend,
    strongBackend,
    incidentalFrontend,
    titleFrontend,
    titleBackend,
    frontendPrimary,
    backendPrimary,
  };
}

function packageAffinityAdjustment(jd, pkgName) {
  const profile = jdRoleProfile(jd);
  let adj = 0;

  if (pkgName === "product") {
    if (!profile.frontendPrimary) {
      adj -= 3.0;
      if (profile.backendPrimary) adj -= 2.0;
      else if (profile.incidentalFrontend >= 2 && profile.strongBackend >= 1) adj -= 1.5;
    } else {
      adj += profile.strongFrontend * 0.75;
    }
  }

  if (pkgName === "backend") {
    if (profile.backendPrimary) adj += 2.0;
    if (profile.frontendPrimary && !profile.backendPrimary) adj -= 1.25;
    adj += Math.min(profile.strongBackend, 4) * 0.35;
  }

  if (pkgName === "research" && profile.backendPrimary && !profile.frontendPrimary) {
    adj += 0.25;
  }

  // Atriveo dynamic-anchor packages
  const text = String(jd || "").toLowerCase();
  if (pkgName === "ai-product") {
    const aiHits = ["machine learning", "ai", "llm", "rag", "langchain", "nlp", "openai", "anthropic"]
      .filter((s) => text.includes(s)).length;
    adj += aiHits * 0.85;
    if (/\b(ai engineer|ml engineer|research scientist|applied scientist)\b/.test(text)) adj += 2.0;
  }
  if (pkgName === "backend") {
    if (profile.backendPrimary) adj += 1.5;
    adj += Math.min(profile.strongBackend, 4) * 0.4;
  }
  if (pkgName === "infra") {
    const infraHits = ["cloudflare", "docker", "devops", "ci/cd", "infrastructure", "serverless", "deployment"]
      .filter((s) => text.includes(s)).length;
    adj += infraHits * 0.7;
  }
  if (pkgName === "data") {
    const dataHits = ["data engineer", "etl", "index", "ingestion", "pipeline", "mongodb"]
      .filter((s) => text.includes(s)).length;
    adj += dataHits * 0.65;
  }
  if (pkgName === "fullstack") {
    if (profile.frontendPrimary || /\bfull.?stack\b/.test(text)) adj += 1.5;
    adj += profile.strongFrontend * 0.5;
  }
  if (pkgName === "product" && !profile.backendPrimary) {
    if (/chrome extension|open source|github|product manager/.test(text)) adj += 1.25;
  }

  // Stony Brook — surface backend/data packages on backend JDs; avoid AI-only routing
  if (pkgName === "backend") {
    if (profile.backendPrimary) adj += 1.75;
    if (/\bkafka\b|\bfastapi\b|\bevent.?driven\b|\bstreaming\b/.test(text)) adj += 0.85;
  }
  if (pkgName === "data") {
    const dataHits = ["data engineer", "etl", "pipeline", "kafka", "ingestion", "streaming", "warehouse", "spark", "pandas"]
      .filter((s) => text.includes(s)).length;
    adj += dataHits * 1.0;
    if (/\bdata engineer\b/.test(text)) adj += 1.5;
  }
  if (pkgName === "research") {
    const quantHits = ["quant", "macro", "economics", "forecast", "fomc", "equity", "financial analyst", "backtest"]
      .filter((s) => text.includes(s)).length;
    if (quantHits >= 2) adj += 2.0;
    else if (/research|financial/.test(text)) adj += 0.5;
    if (/\b(ai engineer|ml engineer|llm engineer|applied scientist|ai systems|machine learning)\b/.test(text)) {
      adj -= 3.0;
    }
  }
  if (pkgName === "platform") {
    if (/performance|latency|optimization|scale|throughput/.test(text)) adj += 1.35;
    if (/platform engineer|platform team/.test(text)) adj += 1.0;
  }
  if (pkgName === "agents") {
    if (/\bmcp\b|model context protocol|tool calling|tool use|agent framework|protocol design/.test(text)) {
      adj += 4.5;
    } else {
      adj -= 3.0;
    }
  }
  if (pkgName === "ai") {
    const aiHits = ["ai engineer", "machine learning", "llm", "openai", "anthropic", "xai", "deepmind", "databricks", "applied scientist", "research scientist", "perplexity", "sierra", "cognition"]
      .filter((s) => text.includes(s)).length;
    adj += aiHits * 1.1;
    if (/\b(ai engineer|ml engineer|applied scientist|research scientist)\b/.test(text)) adj += 2.75;
    if (/\bmcp\b|model context protocol|tool calling|protocol design/.test(text)) adj -= 2.5;
  }
  if (pkgName === "ai-systems") {
    if (/\b(ai engineer|ml engineer|applied scientist|research scientist)\b/.test(text)) adj += 2.25;
    if (/\bkafka\b|\bdistributed\b|\bstreaming\b|\bscale\b|200k|production systems/.test(text)) adj += 1.75;
    if (/\b(openai|anthropic|xai|databricks|deepmind|cursor|cognition|sierra|perplexity)\b/.test(text)) adj += 1.5;
  }
  if (pkgName === "ai" && profile.backendPrimary && !/\b(ai engineer|ml engineer|research scientist|applied scientist)\b/.test(text)) {
    adj -= 1.5;
  }

  return adj;
}

function sbuAiMonoculturePenalty(acs, roleName) {
  if (roleName !== "stony-brook") return 0;
  const evidence = acs.filter((a) => a.id !== "AC-026");
  if (evidence.length < 3) return 0;
  const ids = new Set(evidence.map((a) => a.id));
  let penalty = 0;

  const aiHeavy = evidence.filter((a) => aiCapability(a) >= 85).length;
  const backendHeavy = evidence.filter((a) => (a.capabilities?.backend ?? 0) >= 85).length;
  if (aiHeavy >= 3 && backendHeavy === 0) penalty += 5.0;
  else if (aiHeavy >= 2 && backendHeavy === 0) penalty += 2.5;

  const evalOverlap = ["AC-009", "AC-011", "AC-014"].filter((id) => ids.has(id));
  if (evalOverlap.length && ids.has("AC-025")) penalty += 3.0;
  if (ids.has("AC-024") && ids.has("AC-023") && !ids.has("AC-001") && !ids.has("AC-002")) penalty += 2.0;

  const themes = evidence.map((a) => a.achievement_theme || "");
  const ragEvalStack = themes.filter((t) => /llm-evaluation|retrieval-eval|agent-evaluation|mcp-orchestration/.test(t)).length;
  if (ragEvalStack >= 2) penalty += 2.5;

  return penalty;
}

function sbuPackageQualityBonus(acs, pkg) {
  if (pkg?.roleName !== "stony-brook") return 0;
  const ids = new Set(acs.map((a) => a.id));
  if (pkg?.name === "ai" && ids.has("AC-001") && ids.has("AC-023") && ids.has("AC-025")) return 2.5;
  if (pkg?.name === "ai-systems" && ids.has("AC-002") && ids.has("AC-023") && ids.has("AC-025")) return 2.0;
  return 0;
}

const SBU_STORY_SLOTS = {
  "AC-001": "systems",
  "AC-002": "systems",
  "AC-003": "systems",
  "AC-004": "systems",
  "AC-006": "systems",
  "AC-019": "systems",
  "AC-021": "systems",
  "AC-023": "ai",
  "AC-024": "ai",
  "AC-025": "evaluation",
  "AC-009": "evaluation",
  "AC-011": "evaluation",
  "AC-014": "evaluation",
  "AC-005": "quant",
  "AC-012": "interface",
  "AC-022": "interface",
  "AC-013": "data",
};

function sbuStorySlot(ac) {
  return SBU_STORY_SLOTS[ac.id]
    || (ac.capabilities?.backend >= 85 ? "systems" : null)
    || (ac.capabilities?.ai >= 85 ? "ai" : null)
    || ac.achievement_theme
    || "other";
}

function sbuStoryCoherenceBonus(acs, roleName) {
  if (roleName !== "stony-brook") return 0;
  const evidence = acs.filter((a) => a.id !== "AC-026");
  if (evidence.length < 3) return 0;
  const slots = evidence.map(sbuStorySlot);
  const unique = new Set(slots);
  let bonus = unique.size * 0.75;
  const systems = slots.filter((s) => s === "systems").length;
  const aiEval = slots.filter((s) => s === "ai" || s === "evaluation").length;
  if (systems >= 1 && aiEval >= 1) bonus += 1.25;
  if (aiEval >= 3 && systems === 0) bonus -= 3.0;
  if (unique.size < slots.length) bonus -= 1.0;
  return bonus;
}

function tripleRoleAdjustment(jd, acs, roleName = "wake-forest") {
  const profile = jdRoleProfile(jd);
  const ids = new Set(acs.map((a) => a.id));
  let adj = 0;

  const hasProductBullets = ids.has("AC-047") || ids.has("AC-048");
  const hasBackendBullets = ids.has("AC-032") || ids.has("AC-043") || ids.has("AC-049");

  if (hasProductBullets && !profile.frontendPrimary) {
    adj -= 4.5;
    if (profile.backendPrimary) adj -= 1.5;
  }

  if (hasBackendBullets && profile.backendPrimary && !profile.frontendPrimary) {
    adj += 1.25;
  }

  if (roleName === "stony-brook") {
    const sbuIds = new Set(acs.map((a) => a.id));
    const jdText = String(jd || "").toLowerCase();
    const aiRole = /\b(ai engineer|ml engineer|applied scientist|research scientist|llm engineer)\b/.test(jdText);

    if (sbuIds.has("AC-002") && (profile.backendPrimary || aiRole)) adj += 1.75;
    if (sbuIds.has("AC-003") || sbuIds.has("AC-004")) adj += 0.5;

    if (sbuIds.has("AC-001") && sbuIds.has("AC-023") && sbuIds.has("AC-025") && aiRole) adj += 1.5;
    if (sbuIds.has("AC-024") && !/\bmcp\b|tool calling|tool use|agent framework|protocol design/.test(jdText)) {
      adj -= 2.5;
    }
  }

  return adj;
}

function overlapPenalty(items, lists, penalty) {
  const seen = new Set();
  let overlap = 0;
  for (const list of lists) {
    for (const item of list || []) {
      if (seen.has(item)) overlap += 1;
      seen.add(item);
    }
  }
  return overlap * penalty;
}

function anchorConceptPenalty(acs, weight) {
  const anchor = acs.find((a) => a.id === "AC-031");
  if (!anchor) return 0;
  const anchorConcepts = new Set(anchor.concepts_claimed || []);
  let penalty = 0;
  for (const ac of acs) {
    if (ac.id === "AC-031") continue;
    for (const concept of ac.concepts_claimed || []) {
      if (anchorConcepts.has(concept)) penalty += weight;
    }
  }
  return penalty;
}

function aiCapability(ac) {
  return Math.max(ac.capabilities?.ai ?? 0, ac.capabilities?.ml ?? 0);
}

function simulateTripleBudget(acs, { conceptCount, tagCount, maxConcept, maxTag, keywordList, roleName }) {
  const simConcept = { ...conceptCount };
  const simTag = { ...tagCount };

  if (roleName === "wake-forest") {
    let aiUsed = simConcept.ai || 0;
    const aiCap = maxConcept("ai") + 2;
    for (const ac of acs) {
      if (ac.id === "AC-031") continue;
      if (aiCapability(ac) >= 80) {
        aiUsed += 1;
        if (aiUsed > aiCap) return false;
      }
    }
    return true;
  }

  for (const ac of acs) {
    for (const c of ["ai", "backend"]) {
      if ((ac.capabilities?.[c] ?? 0) >= 80 && (simConcept[c] || 0) >= maxConcept(c)) return false;
    }
    const kws = keywordList(ac);
    if (kws.includes("rag") && (simTag.rag_bullets || 0) >= maxTag("rag_bullets")) return false;
    if ((kws.includes("finbert") || kws.includes("transformers"))
      && (simTag.transformer_models || 0) >= maxTag("transformer_models")) return false;
    for (const c of ["ai", "backend"]) {
      if ((ac.capabilities?.[c] ?? 0) >= 80) simConcept[c] = (simConcept[c] || 0) + 1;
    }
    if (kws.includes("rag")) simTag.rag_bullets = (simTag.rag_bullets || 0) + 1;
    if (kws.includes("finbert") || kws.includes("transformers")) {
      simTag.transformer_models = (simTag.transformer_models || 0) + 1;
    }
  }
  return true;
}

export function scoreStoryTriple(acs, {
  jd,
  scoreAc,
  narrativeBoost = 0,
  pkg = null,
  weights = DEFAULT_WEIGHTS,
}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  let total = narrativeBoost;

  for (const ac of acs) {
    total += scoreAc(ac) * w.jd_match;
    total += (ac.wow_score ?? 0.5) * w.wow;
    total += ((ac.strength?.recruiter ?? 8) / 800) * w.recruiter;
    const capAvg = Object.values(ac.capabilities || {}).reduce((s, v) => s + v, 0)
      / Math.max(1, Object.keys(ac.capabilities || {}).length);
    total += (capAvg / 100) * w.capability * 0.15;
  }

  if (pkg?.jd_signals?.length) {
    total += jdSignalHits(jd, pkg.jd_signals) * w.story_completion;
  }

  total -= overlapPenalty(
    null,
    acs.map((a) => a.metrics_claimed),
    w.metric_overlap,
  );
  total -= overlapPenalty(
    null,
    acs.map((a) => a.concepts_claimed),
    w.concept_overlap * 0.5,
  );
  total -= anchorConceptPenalty(acs, w.concept_overlap);

  if (pkg?.name === "backend" && acs.some((a) => a.id === "AC-043")) total -= 1.5;
  if (pkg?.name === "backend" && acs.some((a) => a.id === "AC-032")) total += 0.35;

  if (pkg?.name) total += packageAffinityAdjustment(jd, pkg.name);
  total += tripleRoleAdjustment(jd, acs, pkg?.roleName);
  total += sbuPackageQualityBonus(acs, pkg);
  total += sbuStoryCoherenceBonus(acs, pkg?.roleName);
  total -= sbuAiMonoculturePenalty(acs, pkg?.roleName);

  if (pkg?.atsCounts) {
    total -= atsPenaltyForAddingTexts(bulletTextsFromAcs(acs), pkg.atsCounts) * 0.35;
  }

  return Number(total.toFixed(4));
}

function resolveAcs(ids, roleAcs) {
  return ids.map((id) => roleAcs.find((a) => a.id === id)).filter(Boolean);
}

function combinations(arr, k) {
  const out = [];
  function walk(start, combo) {
    if (combo.length === k) {
      out.push(combo);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      walk(i + 1, combo.concat(arr[i]));
    }
  }
  walk(0, []);
  return out;
}

export function selectStoryTriple({
  roleAcs,
  count = 3,
  jd,
  cfg = {},
  scoreAc,
  budgetCtx,
  tierRejection,
  selectionTrace,
  roleName = "wake-forest",
}) {
  const poolCfg = cfg.canonical_pools?.[roleName] || {};
  const packages = poolCfg.story_packages || DEFAULT_PACKAGES;
  const weights = poolCfg.story_weights || cfg.story_weights || DEFAULT_WEIGHTS;
  const packageAnchors = poolCfg.dynamic_anchors === true;
  const globalPinned = cfg.pinned_ac_ids?.[roleName] ?? poolCfg.pinned;
  const pinnedIds = Array.isArray(globalPinned)
    ? globalPinned
    : (globalPinned ? [globalPinned] : (packageAnchors ? [] : ["AC-031"]));

  const pinned = resolveAcs(pinnedIds, roleAcs);
  const pinnedSet = new Set(pinnedIds);
  const rest = roleAcs.filter((a) => !pinnedSet.has(a.id));
  const need = packageAnchors ? 0 : Math.max(0, count - pinned.length);

  if (!packageAnchors && pinned.length === 0) {
    return sortAcsByDisplayOrder(roleAcs).slice(0, count);
  }

  const candidates = [];

  for (const pkg of packages) {
    let acs;
    if (pinned.length && pkg.ids?.length === count - pinned.length) {
      acs = orderPackageBullets(pinned, pkg.ids, roleAcs);
    } else if (pinned.length) {
      acs = orderPackageBullets(pinned, pkg.ids, roleAcs);
    } else {
      acs = orderPackageBullets([], pkg.ids, roleAcs);
    }
    if (acs.length !== count) continue;
    candidates.push({
      acs,
      package: pkg.name,
      anchor: pkg.anchor || pkg.ids?.[0] || null,
      score: scoreStoryTriple(acs, {
        jd,
        scoreAc,
        pkg: { ...pkg, roleName, atsCounts: budgetCtx?.atsCounts },
        weights,
      }),
      source: "package",
    });
  }

  if (packageAnchors && count <= 2 && poolCfg.packages_only !== true) {
    for (const combo of combinations(roleAcs, count)) {
      candidates.push({
        acs: sortAcsByDisplayOrder(combo),
        package: "custom",
        anchor: combo[0]?.id || null,
        score: scoreStoryTriple(combo, { jd, scoreAc, weights }),
        source: "enumerate",
      });
    }
  } else if (need > 0 && need <= 3 && poolCfg.packages_only !== true) {
    const combos = need === 1
      ? rest.map((a) => [a])
      : combinations(rest, need);
    for (const combo of combos) {
      const acs = sortAcsByDisplayOrder([...pinned, ...combo]);
      if (acs.length !== count) continue;
      candidates.push({
        acs,
        package: "custom",
        score: scoreStoryTriple(acs, { jd, scoreAc, weights }),
        source: "enumerate",
      });
    }
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
    if (a.source === "package" && b.source !== "package") return -1;
    if (b.source === "package" && a.source !== "package") return 1;
    return b.score - a.score;
  });

  for (const cand of candidates) {
    if (!simulateTripleBudget(cand.acs, { ...budgetCtx, roleName })) {
      selectionTrace?.rejected?.push({
        ac_ids: cand.acs.map((a) => a.id),
        role: roleName,
        score: cand.score,
        reason: "triple_budget_exceeded",
        package: cand.package,
      });
      continue;
    }
    if (tierRejection) {
      const picked = [];
      let tierBlock = null;
      for (const ac of cand.acs) {
        tierBlock = tierRejection(ac, picked);
        if (tierBlock) break;
        picked.push(ac);
      }
      if (tierBlock) {
        selectionTrace?.rejected?.push({
          ac_ids: cand.acs.map((a) => a.id),
          role: roleName,
          score: cand.score,
          reason: tierBlock,
          package: cand.package,
        });
        continue;
      }
    }

    for (const ac of cand.acs) {
      if (!packageAnchors && pinnedSet.has(ac.id)) continue;
      selectionTrace?.selected?.push({
        ac_id: ac.id,
        role: roleName,
        score: cand.score,
        story_package: cand.package,
        story_source: cand.source,
        anchor: cand.anchor || null,
      });
    }
    if (cand.source === "package") {
      if (!selectionTrace.package_winners) selectionTrace.package_winners = {};
      selectionTrace.package_winners[roleName] = {
        package: cand.package,
        ac_ids: cand.acs.map((a) => a.id),
        source: cand.source,
      };
    }
    for (const ac of roleAcs) {
      if (cand.acs.some((x) => x.id === ac.id)) continue;
      selectionTrace?.rejected?.push({
        ac_id: ac.id,
        role: roleName,
        reason: "lower_story_triple",
        winning_package: cand.package,
      });
    }

    return cand.source === "package"
      ? cand.acs
      : sortAcsByDisplayOrder(cand.acs);
  }

  return sortAcsByDisplayOrder([...pinned, ...rest.slice(0, need)]);
}
