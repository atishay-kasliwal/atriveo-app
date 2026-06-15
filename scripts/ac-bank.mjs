// ─── Accomplishment Bank loader + selector ───────────────────────────────────
// Evidence-driven resume composition:
//   JD -> keyword planner -> thesis -> proof chain -> AC selection -> facet/variant
//        -> delete test -> skills (evidence-only) -> hiring manager test.
//
// Non-negotiable rule: a keyword may only appear if it is explicitly mapped on an
// AC via variant text, facet keywords, aliases, or skills-only lists. No suffix
// injection, no string replacement, no invented wording.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildSkillsLines, SKILLS_LIBRARY, SKILLS_MAX_CATEGORIES } from "./skills-library.mjs";
import {
  planNarrative,
  narrativeScoreAc,
  bulletQualityScore,
  orderBulletsForProofChain,
  selectProofChain,
} from "./ac-narrative.mjs";
import {
  applyDeleteTest,
  runDeleteTest,
  runQualityEvaluation,
} from "./ac-quality.mjs";
import { buildSkillsFromComposition, buildSkillsEvidenceAudit } from "./ac-skills.mjs";
import { selectStoryTriple } from "./ac-story-select.mjs";
import { auditAtsMatrix, keywordCountsFromTexts, bulletTextsFromAcs } from "./ac-ats-matrix.mjs";
import { assessJdGate } from "./ac-jd-gate.mjs";
import { RULEBOOK_PROJECT_COUNT } from "./ac-rulebook.mjs";
import {
  loadResumeProjectPool,
  pickResumeProjectRoles,
  sortProjectsByRecency,
} from "./ac-role-meta.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveBankDir() {
  return process.env.AC_BANK_DIR || path.join(APP_ROOT, "data", "ac-bank");
}

const BANK_DIR = resolveBankDir();
const CONFIDENCE_RANK = { direct: 4, contextual: 3, skills: 2, inferred: 1, unsupported: 0 };
const MATCH_WEIGHT = { exact: 1.0, alias: 0.9, semantic: 0.8, skills: 0.7, missing: 0 };
const GENERIC_ATS_WORDS = new Set([
  "ai", "api", "cloud", "dashboard", "deployment", "devops", "financial",
  "framework", "frontend", "backend", "production", "security",
]);

// ── Load ─────────────────────────────────────────────────────────────────────
export function loadBank(dir = BANK_DIR) {
  const bankDir = dir || resolveBankDir();
  const acs = fs.readdirSync(bankDir)
    .filter((f) => /^AC-\d+\.yaml$/.test(f))
    .map((f) => yaml.load(fs.readFileSync(path.join(bankDir, f), "utf8")))
    .filter(Boolean);
  const concepts = readYaml(path.join(bankDir, "CONCEPTS.yaml"));
  const themes = readYaml(path.join(bankDir, "THEMES.yaml"));
  const constraints = readYaml(path.join(bankDir, "CONSTRAINTS.yaml")) || {};
  const market = readYaml(path.join(bankDir, "MARKET_WEIGHTS.yaml")) || {};
  const bankMeta = readYaml(path.join(bankDir, "BANK_VERSION.yaml")) || {};
  const tiersRaw = readYaml(path.join(bankDir, "TIERS.yaml")) || {};
  const tiers = buildTierMap(tiersRaw);
  return {
    acs,
    concepts,
    themes,
    constraints,
    market,
    tiers,
    tier_rules: tiersRaw.rules || { min_s_tier: 2, max_c_tier: 1 },
    bank_dir: bankDir,
    bank_version: bankMeta.version ?? acs.length,
    bank_updated_at: bankMeta.updated_at || null,
  };
}

function buildTierMap(tiersRaw) {
  const map = {};
  for (const tier of ["S", "A", "B", "C"]) {
    for (const id of tiersRaw[tier] || []) map[id] = tier;
  }
  return map;
}

export function acTier(acId, bank) {
  return bank?.tiers?.[acId] || "B";
}

function readYaml(p) {
  try { return yaml.load(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ").trim();
}

function hasPhrase(haystack, phrase) {
  const normalizedHaystack = ` ${normalizeText(haystack)} `;
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedHaystack.includes(` ${normalizedPhrase} `);
}

function uniqKeywords(keywords) {
  const seen = new Set();
  const out = [];
  for (const keyword of keywords || []) {
    const text = String(keyword || "").trim();
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// ── ATS keywords with confidence ─────────────────────────────────────────────
// Supports:
//   ats_keywords: [FastAPI, AI]
//   ats_keywords:
//     FastAPI: { confidence: direct }
export function parseAtsKeywords(ac) {
  const raw = ac?.ats_keywords;
  const out = new Map(); // normalized -> { display, confidence }
  const factText = `${ac?.fact || ""} ${(ac?.variants || []).map((v) => v.text).join(" ")}`;

  const add = (display, confidence) => {
    const key = normalizeText(display);
    if (!key) return;
    const existing = out.get(key);
    if (!existing || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence]) {
      out.set(key, { display: String(display).trim(), confidence });
    }
  };

  if (Array.isArray(raw)) {
    for (const keyword of raw) {
      const text = String(keyword || "").trim();
      const confidence = hasPhrase(factText, text) ? "direct" : "contextual";
      add(text, confidence);
    }
  } else if (raw && typeof raw === "object") {
    for (const [keyword, meta] of Object.entries(raw)) {
      add(keyword, meta?.confidence || "contextual");
    }
  }

  for (const keyword of ac?.skills_only || []) add(keyword, "skills");
  for (const keyword of ac?.unsupported || []) add(keyword, "unsupported");

  return out;
}

function facetMap(ac) {
  const facets = ac?.facets || {};
  const out = {};
  for (const [name, meta] of Object.entries(facets)) {
    out[name] = {
      name,
      phrase: String(meta?.phrase || "").trim(),
      keywords: uniqKeywords(meta?.keywords || []),
    };
  }
  return out;
}

function expandAliases(ac) {
  const out = new Map(); // normalized alias -> { display, canonical, confidence }
  for (const [entry, meta] of parseAtsKeywords(ac)) {
    out.set(entry, { display: meta.display, canonical: meta.display, confidence: meta.confidence });
  }
  const aliases = ac?.aliases || {};
  if (Array.isArray(aliases)) {
    for (const alias of aliases) addAlias(out, alias, alias, "contextual");
  } else {
    for (const [canonical, values] of Object.entries(aliases)) {
      const canonicalMeta = parseAtsKeywords(ac).get(normalizeText(canonical));
      const confidence = canonicalMeta?.confidence || "contextual";
      addAlias(out, canonical, canonical, confidence);
      for (const alias of values || []) addAlias(out, alias, canonical, confidence);
    }
  }
  for (const [facetName, facet] of Object.entries(facetMap(ac))) {
    for (const keyword of facet.keywords) {
      addAlias(out, keyword, keyword, "contextual");
      addAlias(out, keyword, keyword, "contextual", facetName);
    }
  }
  return out;
}

function addAlias(map, alias, canonical, confidence, facet = null) {
  const key = normalizeText(alias);
  if (!key) return;
  const existing = map.get(key);
  const payload = {
    display: String(alias).trim(),
    canonical: String(canonical).trim(),
    confidence,
    facet,
  };
  if (!existing || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence]) {
    map.set(key, payload);
  }
}

function allowedEmitConfidence(confidence, location) {
  if (confidence === "unsupported") return false;
  if (confidence === "inferred" && location === "bullet") return false;
  if (confidence === "skills" && location === "bullet") return false;
  return true;
}

// ── Bank-wide keyword index + semantic groups ──────────────────────────────────
function skillsLibraryKeywords() {
  const out = new Map();
  for (const cat of SKILLS_LIBRARY) {
    for (const skill of cat.skills) {
      const key = normalizeText(skill.name);
      out.set(key, {
        display: skill.name,
        aliases: skill.match.map((m) => normalizeText(m)),
        category: cat.label,
      });
    }
  }
  return out;
}

function buildSemanticGroups(bank) {
  const groups = [];
  const seen = new Set();

  const addGroup = (terms) => {
    const normalized = uniqKeywords(terms).map((t) => normalizeText(t)).filter(Boolean);
    if (normalized.length < 2) return;
    const signature = [...normalized].sort().join("|");
    if (seen.has(signature)) return;
    seen.add(signature);
    groups.push(normalized);
  };

  for (const ac of bank.acs || []) {
    for (const [canonical, values] of Object.entries(ac.aliases || {})) {
      if (Array.isArray(ac.aliases)) break;
      addGroup([canonical, ...(values || [])]);
    }
    for (const facet of Object.values(facetMap(ac))) {
      addGroup(facet.keywords);
    }
  }

  // Common cross-JD semantic pairs when aliases are not yet authored.
  addGroup(["predictive analytics", "machine learning", "machine learning models", "ml models"]);
  addGroup(["vector db", "vector database", "vector databases", "rag", "retrieval augmented"]);
  addGroup(["etl", "data pipeline", "data pipelines", "pipeline"]);
  return groups;
}

function buildKeywordIndex(bank) {
  const index = new Map(); // normalized jd term -> routes[]
  const semanticGroups = buildSemanticGroups(bank);
  const skillsIndex = skillsLibraryKeywords();

  const pushRoute = (term, route) => {
    const key = normalizeText(term);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(route);
  };

  for (const ac of bank.acs || []) {
    const facets = facetMap(ac);
    const aliases = expandAliases(ac);

    for (const [key, meta] of parseAtsKeywords(ac)) {
      pushRoute(meta.display, {
        ac_id: ac.id,
        mode: meta.confidence === "skills" ? "skills" : "bullet",
        confidence: meta.confidence,
        facet: null,
        source: `${ac.id}.ats_keywords`,
      });
    }

    for (const [aliasKey, meta] of aliases) {
      pushRoute(meta.display, {
        ac_id: ac.id,
        mode: meta.confidence === "skills" ? "skills" : "bullet",
        confidence: meta.confidence,
        facet: meta.facet,
        source: meta.facet ? `${ac.id}.${meta.facet}_facet` : `${ac.id}.aliases`,
        canonical: meta.canonical,
      });
    }

    for (const variant of ac.variants || []) {
      for (const [key, meta] of parseAtsKeywords({ ...ac, ats_keywords: variant.ats_keywords || [] })) {
        pushRoute(meta.display, {
          ac_id: ac.id,
          mode: "bullet",
          confidence: "direct",
          facet: variant.facet || variant.emphasis || null,
          source: `${ac.id}.variant.${variant.emphasis || variant.facet || "default"}`,
        });
      }
      for (const keyword of variantKeywordsFromText(variant.text)) {
        pushRoute(keyword, {
          ac_id: ac.id,
          mode: "bullet",
          confidence: "direct",
          facet: variant.facet || variant.emphasis || null,
          source: `${ac.id}.variant.${variant.emphasis || variant.facet || "default"}`,
        });
      }
    }

    for (const [facetName, facet] of Object.entries(facets)) {
      for (const keyword of facet.keywords) {
        pushRoute(keyword, {
          ac_id: ac.id,
          mode: "bullet",
          confidence: "contextual",
          facet: facetName,
          source: `${ac.id}.${facetName}_facet`,
        });
      }
      for (const keyword of variantKeywordsFromText(facet.phrase)) {
        pushRoute(keyword, {
          ac_id: ac.id,
          mode: "bullet",
          confidence: "contextual",
          facet: facetName,
          source: `${ac.id}.${facetName}_facet`,
        });
      }
    }
  }

  for (const [skillKey, skill] of skillsIndex) {
    pushRoute(skill.display, {
      ac_id: null,
      mode: "skills",
      confidence: "direct",
      facet: null,
      source: "skills_library",
    });
    for (const alias of skill.aliases) {
      pushRoute(alias, {
        ac_id: null,
        mode: "skills",
        confidence: "direct",
        facet: null,
        source: "skills_library",
        canonical: skill.display,
      });
    }
  }

  return { index, semanticGroups, skillsIndex };
}

function variantKeywordsFromText(text) {
  return uniqKeywords(String(text || "").match(/[A-Z][A-Za-z0-9+#./-]{1,}/g) || []);
}

function extractJdTerms(jd, bank) {
  const { index, semanticGroups } = buildKeywordIndex(bank);
  const hay = ` ${normalizeText(jd)} `;
  const found = new Map(); // normalized -> display

  for (const [key] of index) {
    if (hay.includes(` ${key} `)) found.set(key, key);
  }

  // Also scan multi-word index keys.
  for (const [key] of index) {
    if (key.includes(" ") && hay.includes(` ${key} `)) found.set(key, key);
  }

  // Semantic lift: if JD has one member of a group, include claimable bank terms in that group.
  for (const group of semanticGroups) {
    const jdHits = group.filter((term) => hay.includes(` ${term} `));
    if (!jdHits.length) continue;
    for (const term of group) {
      if (index.has(term)) found.set(term, term);
    }
  }

  return [...found.entries()].map(([key, display]) => ({ key, display }));
}

function chooseBestRoute(routes, facetPreference = null) {
  const ranked = [...routes].sort((a, b) => {
    const facetBoostA = facetPreference && a.facet === facetPreference ? 1 : 0;
    const facetBoostB = facetPreference && b.facet === facetPreference ? 1 : 0;
    const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (conf) return conf;
    const mode = (a.mode === "bullet" ? 1 : 0) - (b.mode === "bullet" ? 1 : 0);
    if (mode) return -mode;
    return facetBoostB - facetBoostA;
  });
  return ranked[0] || null;
}

// ── Keyword satisfaction planner (runs before composition) ───────────────────
export function planKeywordSatisfaction(jd, bank, theme = null) {
  const { index, semanticGroups } = buildKeywordIndex(bank);
  const jdTerms = extractJdTerms(jd, bank);
  const routes = {};
  const acPriority = {};
  const facetPriority = {};

  for (const { key, display } of jdTerms) {
    const candidates = (index.get(key) || []).filter((route) =>
      route.confidence !== "unsupported" && allowedEmitConfidence(route.confidence, route.mode),
    );
    const preferredFacet = theme?.prefer_faces?.find((face) =>
      candidates.some((route) => route.facet === face),
    ) || null;
    const best = chooseBestRoute(candidates, preferredFacet);

    if (!best) {
      routes[display] = {
        keyword: display,
        route: index.has(key) ? "missing_claimable" : "unclaimable",
        source: "none",
        location: "none",
        confidence: "unsupported",
        ac_id: null,
        facet: null,
      };
      continue;
    }

    routes[display] = {
      keyword: display,
      route: best.mode,
      source: best.source,
      location: best.mode,
      confidence: best.confidence,
      ac_id: best.ac_id,
      facet: best.facet,
    };

    if (best.ac_id) {
      acPriority[best.ac_id] = (acPriority[best.ac_id] || 0) + CONFIDENCE_RANK[best.confidence];
      if (best.facet) facetPriority[`${best.ac_id}:${best.facet}`] = (facetPriority[`${best.ac_id}:${best.facet}`] || 0) + 1;
    }
  }

  return {
    jd_terms: jdTerms.map((term) => term.display),
    routes,
    ac_priority: acPriority,
    facet_priority: facetPriority,
    semantic_groups: semanticGroups,
  };
}

// ── JD -> capability vector ──────────────────────────────────────────────────
function flattenConcepts(concepts) {
  const map = [];
  for (const [concept, groups] of Object.entries(concepts || {})) {
    for (const kws of Object.values(groups || {})) {
      for (const kw of kws) map.push({ concept, keyword: String(kw).toLowerCase() });
    }
  }
  return map;
}

export function jdToVector(jd, concepts) {
  const hay = ` ${String(jd || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
  const flat = flattenConcepts(concepts);
  const counts = {};
  const matched = {};
  for (const { concept, keyword } of flat) {
    if (hay.includes(` ${keyword} `) || hay.includes(` ${keyword},`) || hay.includes(` ${keyword}.`)) {
      counts[concept] = (counts[concept] || 0) + 1;
      (matched[concept] ||= new Set()).add(keyword);
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const vec = {};
  for (const [c, n] of Object.entries(counts)) vec[c] = Math.min(100, Math.round((n / total) * 250));
  return { vec, matched: Object.fromEntries(Object.entries(matched).map(([k, v]) => [k, [...v]])) };
}

function score(acCaps, jdVec, themeWeights = {}) {
  let dot = 0;
  for (const [concept, jdVal] of Object.entries(jdVec)) {
    const acVal = acCaps[concept] ?? 0;
    const w = themeWeights[concept] ?? 1;
    dot += (jdVal / 100) * Math.pow(acVal / 100, 2) * w;
  }
  return dot;
}

export function pickTheme(jdVec, themes) {
  const jdNorm = Math.sqrt(Object.values(jdVec).reduce((s, v) => s + (v / 100) ** 2, 0)) || 1;
  let best = null, bestScore = -1;
  for (const [name, t] of Object.entries(themes || {})) {
    const w = t.weights || {};
    let dot = 0, wNorm = 0;
    for (const [c, wv] of Object.entries(w)) {
      dot += (jdVec[c] ?? 0) / 100 * wv;
      wNorm += wv ** 2;
    }
    const sim = dot / (jdNorm * (Math.sqrt(wNorm) || 1));
    if (sim > bestScore) { bestScore = sim; best = { name, ...t }; }
  }
  return best;
}

function pickFacet(ac, jd, theme, plan, narrative = null) {
  const facets = facetMap(ac);
  if (!Object.keys(facets).length) return null;

  const pillarFacets = new Set();
  if (narrative?.pillars?.length) {
    for (const pillar of narrative.pillars.slice(0, 3)) {
      for (const f of pillar.facets || []) pillarFacets.add(f);
    }
  }

  const facetScores = Object.keys(facets).map((name) => {
    let s = 0;
    if (theme?.prefer_faces?.includes(name)) s += 2;
    if (pillarFacets.has(name)) s += 2.5;
    s += (plan?.facet_priority?.[`${ac.id}:${name}`] || 0) * 1.5;
    for (const keyword of facets[name].keywords) {
      if (hasPhrase(jd, keyword)) s += 1;
    }
    if (hasPhrase(jd, facets[name].phrase)) s += 1.5;
    return { name, score: s };
  });

  facetScores.sort((a, b) => b.score - a.score);
  return facetScores[0]?.score > 0 ? facetScores[0].name : Object.keys(facets)[0];
}

function variantForFacet(ac, facetName) {
  const variants = ac.variants || [];
  if (!variants.length) return null;
  if (!facetName) return variants[0];

  const exact = variants.find((variant) => variant.facet === facetName || variant.emphasis === facetName);
  if (exact) return exact;

  const facets = facetMap(ac);
  const phrase = facets[facetName]?.phrase;
  if (!phrase) return variants[0];

  // Variants may keep a stable shell and declare which facet phrase they expect.
  const phraseMatch = variants.find((variant) => hasPhrase(variant.text, phrase));
  if (phraseMatch) return phraseMatch;

  return variants[0];
}

function pickFace(ac, jd, theme, plan, narrative = null) {
  const facet = pickFacet(ac, jd, theme, plan, narrative);
  const prefer = new Set(theme?.prefer_faces || []);
  if (narrative?.pillars?.length) {
    for (const pillar of narrative.pillars.slice(0, 3)) {
      for (const f of pillar.facets || []) prefer.add(f);
    }
  }
  const variants = ac.variants || [];
  let best = variantForFacet(ac, facet) || variants[0];
  let bestScore = -1;

  for (const variant of variants) {
    const variantFacet = variant.facet || variant.emphasis || null;
    if (facet && variantFacet && variantFacet !== facet) continue;

    const text = variant.text;
    const keywordHits = [...parseAtsKeywords(ac).values()].filter((meta) => hasPhrase(jd, meta.display));
    const covered = keywordHits.filter((meta) => hasPhrase(text, meta.display)).length;

    let s = (variant.strength || 9) / 10;
    s += covered * 0.35;
    if (prefer.has(variant.emphasis) || prefer.has(variantFacet)) s += 0.5;
    if (facet && variantFacet === facet) s += 1;
    if (plan?.facet_priority?.[`${ac.id}:${facet}`]) s += 0.75;

    if (s > bestScore) {
      bestScore = s;
      best = variant;
    }
  }

  return {
    ...best,
    facet: facet || best.facet || best.emphasis || null,
    text: best.text,
  };
}

export function buildBullet(ac, ctx = {}) {
  const { jd = "", theme = null, plan = null, narrative = null } = ctx;
  return { ac, face: pickFace(ac, jd, theme, plan, narrative) };
}

export function enrichComposition(composition, bank, jd, cfg = {}) {
  const narrativeOn = cfg.narrative_first !== false;
  const narrative = composition.narrative;
  const skillsCfg = cfg.minimum_visual_targets?.skills || {};
  const evidenceOnly = cfg.skills_evidence_only !== false && narrativeOn;

  composition.skills = evidenceOnly
    ? buildSkillsFromComposition(composition, bank, jd, {
      evidenceOnly: true,
      maxCategories: skillsCfg.max_categories ?? SKILLS_MAX_CATEGORIES,
      useSelectedAcCorpus: skillsCfg.use_selected_ac_corpus !== false,
    })
    : buildSkillsLines(jd);
  composition.skills_audit = evidenceOnly
    ? buildSkillsEvidenceAudit(composition, bank, jd, {
      useSelectedAcCorpus: skillsCfg.use_selected_ac_corpus !== false,
    })
    : null;
  composition.coverage = buildCoverageAudit(jd, bank, composition, composition.plan);
  composition.ats_matrix = auditAtsMatrix(composition, composition.skills);

  if (narrativeOn) {
    composition.quality = runQualityEvaluation(composition, narrative, bank, {
      skillsAudit: composition.skills_audit,
    });
    if (composition.delete_test) {
      composition.quality.delete_test = composition.delete_test;
    }
  }

  return composition;
}

function classifyKeywordMatch(jdTerm, emittedText, bank, semanticGroups) {
  const key = normalizeText(jdTerm);
  if (hasPhrase(emittedText, jdTerm)) return { type: "exact", weight: MATCH_WEIGHT.exact };

  const { index } = buildKeywordIndex(bank);
  const routes = index.get(key) || [];
  for (const route of routes) {
    const canonical = route.canonical || jdTerm;
    if (canonical && hasPhrase(emittedText, canonical)) {
      return { type: "alias", weight: MATCH_WEIGHT.alias, matched: canonical };
    }
  }

  for (const group of semanticGroups) {
    if (!group.includes(key)) continue;
    for (const term of group) {
      if (term !== key && hasPhrase(emittedText, term)) {
        return { type: "semantic", weight: MATCH_WEIGHT.semantic, matched: term };
      }
    }
  }

  return { type: "missing", weight: MATCH_WEIGHT.missing };
}

function allSelectedBullets(result) {
  const experience = result.experience.flatMap((role) =>
    role.bullets.map(({ ac, face }) => ({ section: "experience", role: role.role, ac, face })),
  );
  const projects = result.projects.flatMap((project) =>
    project.bullets.map(({ ac, face }) => ({ section: "project", role: project.role, ac, face })),
  );
  return [...experience, ...projects];
}

export function buildCoverageAudit(jd, bank, result, plan) {
  const selected = allSelectedBullets(result);
  const bulletText = selected.map((item) => item.face.text).join("\n");
  const skillsLines = result.skills || buildSkillsLines(jd);
  const skillsText = skillsLines.join("\n");
  const semanticGroups = plan?.semantic_groups || buildSemanticGroups(bank);
  const audit = {};

  for (const [keyword, routePlan] of Object.entries(plan?.routes || {})) {
    const bulletMatch = classifyKeywordMatch(keyword, bulletText, bank, semanticGroups);
    const skillsMatch = hasPhrase(skillsText, keyword)
      ? { type: "skills", weight: MATCH_WEIGHT.skills }
      : { type: "missing", weight: MATCH_WEIGHT.missing };

    let location = "none";
    let status = routePlan.route;
    let source = routePlan.source;
    let match = bulletMatch;

    if (bulletMatch.weight > 0) {
      location = "bullet";
      status = "satisfied";
      const bullet = selected.find((item) => hasPhrase(item.face.text, keyword)
        || (bulletMatch.matched && hasPhrase(item.face.text, bulletMatch.matched)));
      source = bullet ? `${bullet.ac.id}${bullet.face.facet ? `.${bullet.face.facet}_facet` : ""}` : routePlan.source;
    } else if (skillsMatch.weight > 0) {
      location = "skills";
      status = "satisfied";
      source = "skills";
      match = skillsMatch;
    } else if (routePlan.route === "missing_claimable") {
      status = "missing_claimable";
    } else if (routePlan.route === "unclaimable") {
      status = "unclaimable";
    } else {
      status = "planned_not_emitted";
    }

    audit[keyword] = {
      source,
      location,
      confidence: routePlan.confidence,
      status,
      match_type: match.type,
      match_weight: match.weight,
      matched_text: match.matched || (match.weight > 0 ? keyword : null),
      planned_route: routePlan.route,
      ac_id: routePlan.ac_id,
      facet: routePlan.facet,
    };
  }

  const terms = Object.entries(audit);
  const weightedCoverage = terms.length
    ? terms.reduce((sum, [, entry]) => sum + entry.match_weight, 0) / terms.length
    : 1;

  return {
    audit,
    weighted_coverage: Number(weightedCoverage.toFixed(3)),
    missing_claimable: terms.filter(([, entry]) => entry.status === "missing_claimable").map(([keyword]) => keyword),
    unclaimable: terms.filter(([, entry]) => entry.status === "unclaimable").map(([keyword]) => keyword),
    skills_lines: skillsLines,
  };
}

const SLOTS = {
  experience: [
    { role: "stony-brook", count: 4 },
    { role: "wake-forest", count: 3 },
    { role: "accolite", count: 4 },
  ],
  projects: [
    { role: "atriveo", bulletsEach: 2 },
    { role: "insurance-platform", bulletsEach: 2 },
  ],
};

function experienceSlotCount(roleName, slot, cfg) {
  const vt = cfg.minimum_visual_targets?.experience?.[roleName];
  if (vt) {
    const preferred = vt.preferred ?? vt.minimum ?? slot?.count;
    const minimum = vt.minimum ?? preferred;
    return cfg.allow_sparse_slots ? minimum : preferred;
  }
  return cfg.min_bullets_per_role?.[roleName] ?? slot?.count ?? 2;
}

function projectBulletTarget(projectRole, cfg) {
  const vt = cfg.minimum_visual_targets?.projects?.[projectRole]
    || cfg.minimum_visual_targets?.projects?.default;
  const preferred = vt?.preferred ?? cfg.min_project_bullets ?? SLOTS.projects.bulletsEach;
  const minimum = vt?.minimum ?? preferred;
  return cfg.allow_sparse_slots ? minimum : preferred;
}

function leadOrderBullets(bullets, leadIds) {
  if (!leadIds?.length || !bullets?.length) return bullets;
  const copy = [...bullets];
  for (let i = leadIds.length - 1; i >= 0; i--) {
    const targetId = leadIds[i];
    const idx = copy.findIndex((b) => (b.ac?.id || b.ac_id) === targetId);
    if (idx > 0) {
      const [item] = copy.splice(idx, 1);
      copy.unshift(item);
    }
  }
  return copy;
}

export function compose(jd, bank, plannerConfig = {}) {
  const { acs: allAcs, concepts, themes, constraints } = bank;
  const cfg = plannerConfig || {};
  const jdGate = assessJdGate(jd, {
    title: cfg.title || "",
    forceBorderline: cfg.force_borderline === true,
    strict: cfg.strict_jd_gate === true,
  });
  if (cfg.require_engineering_jd !== false && !jdGate.can_compose) {
    return {
      unsupported_jd: true,
      jd_gate: jdGate,
      jd_relevance: jdGate.relevance,
      experience: [],
      projects: [],
      skills: [],
      narrative: null,
      selection_trace: { selected: [], rejected: [] },
    };
  }
  const acs = cfg.candidate_ac_ids?.length
    ? allAcs.filter((ac) => cfg.candidate_ac_ids.includes(ac.id)
      || (ac.slot_kind === "experience" && cfg.always_include_roles?.includes(ac.role)))
    : allAcs;

  const { vec: jdVec, matched } = jdToVector(jd, concepts);
  const theme = pickTheme(jdVec, themes);
  const narrativeOn = cfg.narrative_first !== false;
  const narrative = narrativeOn ? planNarrative(jd, theme, bank) : null;
  const plan = planKeywordSatisfaction(jd, bank, theme);
  const tw = theme?.weights || {};
  const priorityWeight = cfg.plan_priority_weight ?? 10;
  const strengthDivisor = cfg.strength_divisor ?? 500;
  const acBoost = cfg.ac_boost || {};
  const caseBoost = cfg.case_memory_boost || {};

  const byRole = (r) => acs.filter((a) => a.slot_kind === "experience" && a.role === r && (a.visibility?.default !== false));
  const scoreAc = (a) =>
    score(a.capabilities || {}, jdVec, tw)
    + (a.strength?.recruiter || 9) / strengthDivisor
    + (plan.ac_priority[a.id] || 0) / priorityWeight
    + (acBoost[a.id] || 0)
    + (caseBoost[a.id] || 0);

  const conceptCount = {};
  const tagCount = {};
  const caps = constraints || {};
  const maxConcept = (concept) => cfg.concept_caps?.[concept] ?? caps[`max_${concept}_bullets`] ?? Infinity;
  const maxTag = (tag) => caps.max_per_resume?.[tag] ?? Infinity;

  function keywordList(ac) {
    return [...parseAtsKeywords(ac).keys()];
  }

  function rejectionReason(ac) {
    for (const c of ["ai", "backend"]) {
      if ((ac.capabilities?.[c] ?? 0) >= 80 && (conceptCount[c] || 0) >= maxConcept(c)) {
        return `exceeded_${c}_budget`;
      }
    }
    const kws = keywordList(ac);
    if (kws.includes("rag") && (tagCount.rag_bullets || 0) >= maxTag("rag_bullets")) return "exceeded_rag_budget";
    if ((kws.includes("finbert") || kws.includes("transformers")) && (tagCount.transformer_models || 0) >= maxTag("transformer_models")) {
      return "exceeded_transformer_budget";
    }
    return null;
  }

  function allowed(ac) {
    return !rejectionReason(ac);
  }

  function record(ac) {
    for (const c of ["ai", "backend"]) if ((ac.capabilities?.[c] ?? 0) >= 80) conceptCount[c] = (conceptCount[c] || 0) + 1;
    const kws = keywordList(ac);
    if (kws.includes("rag")) tagCount.rag_bullets = (tagCount.rag_bullets || 0) + 1;
    if (kws.includes("finbert") || kws.includes("transformers")) tagCount.transformer_models = (tagCount.transformer_models || 0) + 1;
  }

  const selectionTrace = { selected: [], rejected: [], package_winners: {} };
  const atsCounts = {};

  function absorbAtsFromAcs(acs) {
    const delta = keywordCountsFromTexts(bulletTextsFromAcs(acs));
    for (const [k, v] of Object.entries(delta)) atsCounts[k] = (atsCounts[k] || 0) + v;
  }

  function tierCounts(picked) {
    const counts = { S: 0, A: 0, B: 0, C: 0 };
    for (const ac of picked) {
      const t = acTier(ac.id, bank);
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }

  function tierRejection(ac, picked) {
    if (!cfg.enforce_tiers) return null;
    const t = acTier(ac.id, bank);
    const counts = tierCounts(picked);
    const minS = cfg.min_s_tier ?? bank.tier_rules?.min_s_tier ?? 2;
    const maxC = cfg.max_c_tier ?? bank.tier_rules?.max_c_tier ?? 1;
    if (t === "C" && counts.C >= maxC) return "max_c_tier";
    if (picked.length >= 3 && counts.S < minS && t !== "S" && !["S"].includes(t)) {
      const remaining = 10 - picked.length;
      if (counts.S + remaining < minS) return null;
    }
    return null;
  }

  function achievementTheme(ac) {
    return ac.achievement_theme || ac.id;
  }

  function sortAcsByDisplayOrder(list) {
    return [...list].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
  }

  function fillRole(roleAcs, count, roleName) {
    const coveredPillars = new Set();
    const allowSparse = cfg.allow_sparse_slots === true;
    const minQuality = allowSparse ? (cfg.min_bullet_quality ?? 0.5) : 0;
    const minCount = allowSparse
      ? (cfg.min_bullets_per_role?.[roleName] ?? Math.max(2, count - 1))
      : count;

    const ranked = [...roleAcs]
      .map((ac) => {
        const base = scoreAc(ac);
        const narr = narrative
          ? narrativeScoreAc(ac, narrative, coveredPillars)
          : { boost: 0, pillar: null };
        const quality = narrative ? bulletQualityScore(ac, narrative, coveredPillars) : 0.6;
        return {
          ac,
          score: Number((base + narr.boost).toFixed(4)),
          pillar: narr.pillar,
          quality,
        };
      })
      .sort((a, b) => b.score - a.score);
    const picked = [];
    const pickedIds = new Set();
    const pickedThemes = new Set();

    for (const { ac, score, pillar, quality } of ranked) {
      if (picked.length >= count) break;
      const reason = rejectionReason(ac) || tierRejection(ac, picked);
      if (reason) {
        selectionTrace.rejected.push({ ac_id: ac.id, role: roleName, score, reason });
        continue;
      }
      if (pickedThemes.has(achievementTheme(ac))) {
        selectionTrace.rejected.push({
          ac_id: ac.id,
          role: roleName,
          score,
          reason: "duplicate_achievement_theme",
        });
        continue;
      }
      if (allowSparse && picked.length >= minCount && quality < minQuality) {
        selectionTrace.rejected.push({
          ac_id: ac.id,
          role: roleName,
          score,
          reason: "below_quality_threshold",
          quality,
        });
        continue;
      }
      picked.push(ac);
      pickedIds.add(ac.id);
      pickedThemes.add(achievementTheme(ac));
      if (pillar) coveredPillars.add(pillar);
      selectionTrace.selected.push({
        ac_id: ac.id,
        role: roleName,
        score,
        narrative_pillar: pillar,
        quality,
        proof_chain: narrative?.proof_chain?.some((p) => p.ac_id === ac.id) || false,
      });
      record(ac);
    }

    if (!allowSparse) {
      for (const { ac, score, pillar, quality } of ranked) {
        if (picked.length >= count) break;
        if (pickedIds.has(ac.id)) continue;
        if (pickedThemes.has(achievementTheme(ac))) continue;
        picked.push(ac);
        pickedIds.add(ac.id);
        pickedThemes.add(achievementTheme(ac));
        if (pillar) coveredPillars.add(pillar);
        selectionTrace.selected.push({
          ac_id: ac.id,
          role: roleName,
          score,
          narrative_pillar: pillar,
          quality,
          backfill: true,
          theme_backfill: true,
        });
        record(ac);
      }
      for (const { ac, score, pillar, quality } of ranked) {
        if (picked.length >= count) break;
        if (pickedIds.has(ac.id)) continue;
        picked.push(ac);
        pickedIds.add(ac.id);
        if (pillar) coveredPillars.add(pillar);
        selectionTrace.selected.push({
          ac_id: ac.id,
          role: roleName,
          score,
          narrative_pillar: pillar,
          quality,
          backfill: true,
        });
        record(ac);
      }
    } else if (picked.length < minCount) {
      for (const { ac, score, pillar, quality } of ranked) {
        if (picked.length >= minCount) break;
        if (pickedIds.has(ac.id)) continue;
        picked.push(ac);
        pickedIds.add(ac.id);
        if (pillar) coveredPillars.add(pillar);
        selectionTrace.selected.push({
          ac_id: ac.id,
          role: roleName,
          score,
          narrative_pillar: pillar,
          quality,
          backfill_to_min: true,
        });
        record(ac);
      }
    }

    for (const { ac, score, quality } of ranked) {
      if (pickedIds.has(ac.id)) continue;
      selectionTrace.rejected.push({
        ac_id: ac.id,
        role: roleName,
        score,
        quality,
        reason: "lower_ranked",
      });
    }

    return sortAcsByDisplayOrder(picked).slice(0, count);
  }

  function fillRoleForSlot(roleAcs, count, roleName) {
    const poolCfg = cfg.canonical_pools?.[roleName];
    if (poolCfg?.story_packages?.length) {
      const picked = selectStoryTriple({
        roleAcs,
        count,
        jd,
        cfg,
        scoreAc,
        roleName,
        selectionTrace,
        tierRejection,
        budgetCtx: {
          conceptCount,
          tagCount,
          maxConcept,
          maxTag,
          keywordList,
          atsCounts,
        },
      });
      absorbAtsFromAcs(picked);
      for (const ac of picked) record(ac);
      return picked;
    }

    const pinnedIds = cfg.pinned_ac_ids?.[roleName] || [];
    const pinned = pinnedIds
      .map((id) => roleAcs.find((a) => a.id === id))
      .filter(Boolean);
    const rest = roleAcs.filter((a) => !pinnedIds.includes(a.id));
    const restCount = Math.max(0, count - pinned.length);
    const restPicked = restCount > 0 ? fillRole(rest, restCount, roleName) : [];
    return sortAcsByDisplayOrder([...pinned, ...restPicked]).slice(0, count);
  }

  const experience = [];
  for (const slot of SLOTS.experience) {
    const count = experienceSlotCount(slot.role, slot, cfg);
    experience.push({
      role: slot.role,
      bullets: fillRoleForSlot(byRole(slot.role), count, slot.role).map((ac) => ({ ac, face: pickFace(ac, jd, theme, plan, narrative) })),
    });
  }

  const projAcs = acs.filter((a) => a.slot_kind === "project");
  const groups = {};
  for (const a of projAcs) (groups[a.role] ||= []).push(a);

  const poolRoles = cfg.resume_project_pool?.length
    ? cfg.resume_project_pool
    : cfg.fixed_project_roles?.length
      ? cfg.fixed_project_roles
      : loadResumeProjectPool(bank.bank_dir)
        || SLOTS.projects.map((slot) => slot.role);
  const eligibleRoles = poolRoles.filter((role) => (groups[role] || []).length > 0);
  const maxProjects = cfg.max_resume_projects ?? RULEBOOK_PROJECT_COUNT ?? 2;
  const pickedRoles = pickResumeProjectRoles(
    eligibleRoles,
    jd,
    cfg,
    maxProjects,
    bank.bank_dir,
  );
  const projectSlots = pickedRoles.map((role) => ({ role, list: groups[role] || [] }));

  const allowSparse = cfg.allow_sparse_slots === true;
  const minProjQuality = allowSparse ? (cfg.min_bullet_quality ?? 0.5) : 0;

  const projects = projectSlots.filter(({ list }) => list.length > 0).map(({ role, list }) => {
    const bulletsEach = projectBulletTarget(role, cfg);
    const minProjBullets = allowSparse
      ? (cfg.minimum_visual_targets?.projects?.[role]?.minimum
        ?? cfg.minimum_visual_targets?.projects?.default?.minimum
        ?? cfg.min_project_bullets ?? bulletsEach)
      : bulletsEach;

    const visible = list.filter((ac) => ac.visibility?.default !== false);
    let pickedAcs;

    if (cfg.canonical_pools?.[role]?.story_packages?.length) {
      pickedAcs = selectStoryTriple({
        roleAcs: visible,
        count: bulletsEach,
        jd,
        cfg,
        scoreAc,
        roleName: role,
        selectionTrace,
        tierRejection,
        budgetCtx: {
          conceptCount: {},
          tagCount: {},
          maxConcept,
          maxTag,
          keywordList,
          atsCounts,
        },
      });
      absorbAtsFromAcs(pickedAcs);
    } else {
      const ranked = [...visible]
        .map((ac) => ({
          ac,
          score: scoreAc(ac),
          quality: narrative ? bulletQualityScore(ac, narrative) : 0.6,
        }))
        .sort((a, b) => b.score - a.score);
      pickedAcs = [];
      for (const row of ranked) {
        if (pickedAcs.length >= bulletsEach) break;
        if (allowSparse && pickedAcs.length >= minProjBullets && row.quality < minProjQuality) continue;
        pickedAcs.push(row.ac);
      }
      if (!allowSparse && pickedAcs.length < bulletsEach) {
        for (const row of ranked) {
          if (pickedAcs.length >= bulletsEach) break;
          if (!pickedAcs.includes(row.ac)) pickedAcs.push(row.ac);
        }
      }
    }

    return {
      role,
      bullets: pickedAcs.map((ac) => ({ ac, face: pickFace(ac, jd, theme, plan, narrative) })),
    };
  });

  const orderedProjects = sortProjectsByRecency(projects, bank.bank_dir);

  let composition = {
    theme: theme?.name,
    jdVec,
    matched,
    plan,
    narrative,
    experience,
    projects: orderedProjects,
    project_pick: {
      pool: poolRoles,
      picked: pickedRoles,
      rule: "latest_first_then_jd_fit",
    },
  };

  if (narrative && cfg.apply_delete_test !== false) {
    const proofChain = selectProofChain(
      composition.experience.flatMap((r) => r.bullets).concat(composition.projects.flatMap((p) => p.bullets)),
      narrative,
      narrative.proof_template_steps,
    );
    narrative.proof_chain = proofChain;
    const deleteResult = runDeleteTest(composition, narrative, proofChain);
    composition = applyDeleteTest(composition, deleteResult);
    composition.delete_test = runDeleteTest(composition, narrative, narrative.proof_chain);
  }

  if (narrative) {
    const sb = composition.experience.find((r) => r.role === "stony-brook");
    if (sb?.bullets?.length) {
      const packageWinner = selectionTrace.package_winners?.["stony-brook"];
      const poolCfg = cfg.canonical_pools?.["stony-brook"];
      const preservePackageOrder = packageWinner?.source === "package"
        || poolCfg?.packages_only === true
        || poolCfg?.preserve_package_order === true;

      if (!preservePackageOrder) {
        sb.bullets = orderBulletsForProofChain(sb.bullets, narrative.proof_chain, narrative.proof_template_steps);
      }
      const lead = cfg.lead_ac_ids?.["stony-brook"];
      if (lead?.length) sb.bullets = leadOrderBullets(sb.bullets, lead);
      if (!preservePackageOrder) {
        narrative.proof_chain = selectProofChain(sb.bullets, narrative, narrative.proof_template_steps);
      }
    }
    const wf = composition.experience.find((r) => r.role === "wake-forest");
    if (wf?.bullets?.length) {
      wf.bullets.sort((a, b) => (a.ac.display_order ?? 999) - (b.ac.display_order ?? 999));
    }
    const ac = composition.experience.find((r) => r.role === "accolite");
    if (ac?.bullets?.length) {
      const lead = cfg.lead_ac_ids?.accolite || cfg.pinned_ac_ids?.accolite;
      if (lead?.length) ac.bullets = leadOrderBullets(ac.bullets, lead);
    }
  }

  composition.minimum_visual_targets = cfg.minimum_visual_targets || null;
  enrichComposition(composition, bank, jd, cfg);
  composition.selection_trace = selectionTrace;

  composition.planner_config = {
    version: cfg.version || "v1",
    name: cfg.name || "default",
    objective: cfg.objective || (narrativeOn ? "optimize_hiring_decision" : "keyword_coverage"),
  };
  return composition;
}
