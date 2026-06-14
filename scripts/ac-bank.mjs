// ─── Accomplishment Bank loader + selector ───────────────────────────────────
// Reads the canonical accomplishment YAMLs from the engine and turns a JD into a
// truthful, coherent resume composition by SELECTION (never generation):
//   JD -> capability vector -> per-slot AC pick (similarity) -> face pick
//        -> coherence guardrails -> derived skills.
//
// The engine bank is the single source of truth. This module only reads it.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const BANK_DIR = "/Users/atishaykasliwal/Desktop/June/Resume claude/Memory/ACCOMPLISHMENTS";

// ── Load ─────────────────────────────────────────────────────────────────────
export function loadBank(dir = BANK_DIR) {
  const acs = fs.readdirSync(dir)
    .filter((f) => /^AC-\d+\.yaml$/.test(f))
    .map((f) => yaml.load(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter(Boolean);
  const concepts = readYaml(path.join(dir, "CONCEPTS.yaml"));
  const themes = readYaml(path.join(dir, "THEMES.yaml"));
  const constraints = readYaml(path.join(dir, "CONSTRAINTS.yaml")) || {};
  const market = readYaml(path.join(dir, "MARKET_WEIGHTS.yaml")) || {};
  return { acs, concepts, themes, constraints, market };
}

function readYaml(p) {
  try { return yaml.load(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// ── JD -> capability vector ──────────────────────────────────────────────────
// Flatten the concept ontology into keyword -> concept-family, then score each
// concept by how many of its keywords the JD mentions.
function flattenConcepts(concepts) {
  const map = []; // [{ concept, keyword }]
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
  const matched = {}; // concept -> Set(keywords) for provenance
  for (const { concept, keyword } of flat) {
    if (hay.includes(` ${keyword} `) || hay.includes(` ${keyword},`) || hay.includes(` ${keyword}.`)) {
      counts[concept] = (counts[concept] || 0) + 1;
      (matched[concept] ||= new Set()).add(keyword);
    }
  }
  // Normalize each concept to 0-100 by its share of total hits (capped).
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const vec = {};
  for (const [c, n] of Object.entries(counts)) vec[c] = Math.min(100, Math.round((n / total) * 250));
  return { vec, matched: Object.fromEntries(Object.entries(matched).map(([k, v]) => [k, [...v]])) };
}

// ── Similarity: AC capabilities vs JD vector (weighted dot / cosine-ish) ──────
function score(acCaps, jdVec, themeWeights = {}) {
  let dot = 0;
  for (const [concept, jdVal] of Object.entries(jdVec)) {
    const acVal = acCaps[concept] ?? 0;
    const w = themeWeights[concept] ?? 1;
    dot += (jdVal / 100) * (acVal / 100) * w;
  }
  return dot;
}

// ── Theme pick: which theme's weights best match the JD vector ────────────────
export function pickTheme(jdVec, themes) {
  let best = null, bestScore = -1;
  for (const [name, t] of Object.entries(themes || {})) {
    let s = 0;
    for (const [c, w] of Object.entries(t.weights || {})) s += (jdVec[c] ?? 0) / 100 * w;
    if (s > bestScore) { bestScore = s; best = { name, ...t }; }
  }
  return best;
}

// ── Face pick: which authored variant best fits the JD + theme ───────────────
function pickFace(ac, jdVec, theme) {
  const prefer = new Set((theme?.prefer_faces || []));
  let best = ac.variants[0], bestScore = -1;
  for (const v of ac.variants) {
    // overlap of variant ats_keywords with JD (rough), + theme face preference + strength
    let s = (v.strength || 9) / 10;
    if (prefer.has(v.emphasis)) s += 0.5;
    bestScore < s && (bestScore = s, best = v);
  }
  return best;
}

// Required rulebook structure.
const SLOTS = {
  experience: [
    { role: "stony-brook", count: 4 },
    { role: "accolite", count: 4 },
    { role: ["wake-forest", "shriffle"], count: 2, pickOne: true },
  ],
  projects: { count: 2, bulletsEach: 2 },
};

// ── Compose: select ACs + faces for every slot under coherence guardrails ────
export function compose(jd, bank) {
  const { acs, concepts, themes, constraints } = bank;
  const { vec: jdVec, matched } = jdToVector(jd, concepts);
  const theme = pickTheme(jdVec, themes);
  const tw = theme?.weights || {};

  const byRole = (r) => acs.filter((a) => a.slot_kind === "experience" && a.role === r && (a.visibility?.default !== false));
  const scoreAc = (a) => score(a.capabilities || {}, jdVec, tw) + (a.strength?.recruiter || 9) / 50;

  const conceptCount = {}; // for max_ai_bullets etc.
  const tagCount = {};     // for max_per_resume (transformer_models, rag_bullets)
  const caps = constraints || {};
  const maxConcept = (concept) => caps[`max_${concept}_bullets`] ?? Infinity;
  const maxTag = (tag) => caps.max_per_resume?.[tag] ?? Infinity;

  function allowed(ac) {
    // concept caps (ai/backend) — use dominant capability buckets
    for (const c of ["ai", "backend"]) {
      if ((ac.capabilities?.[c] ?? 0) >= 80 && (conceptCount[c] || 0) >= maxConcept(c)) return false;
    }
    // tag caps via relations note (rag/transformer): infer from ats_keywords
    const kws = (ac.ats_keywords || []).map((k) => String(k).toLowerCase());
    if (kws.includes("rag") && (tagCount.rag_bullets || 0) >= maxTag("rag_bullets")) return false;
    if ((kws.includes("finbert") || kws.includes("transformers")) && (tagCount.transformer_models || 0) >= maxTag("transformer_models")) return false;
    return true;
  }
  function record(ac) {
    for (const c of ["ai", "backend"]) if ((ac.capabilities?.[c] ?? 0) >= 80) conceptCount[c] = (conceptCount[c] || 0) + 1;
    const kws = (ac.ats_keywords || []).map((k) => String(k).toLowerCase());
    if (kws.includes("rag")) tagCount.rag_bullets = (tagCount.rag_bullets || 0) + 1;
    if (kws.includes("finbert") || kws.includes("transformers")) tagCount.transformer_models = (tagCount.transformer_models || 0) + 1;
  }

  // Pick top-N ACs for a role honoring guardrails + experience shape.
  function fillRole(roleAcs, count) {
    const ranked = [...roleAcs].sort((a, b) => scoreAc(b) - scoreAc(a));
    const picked = [];
    for (const ac of ranked) {
      if (picked.length >= count) break;
      if (!allowed(ac)) continue;
      picked.push(ac); record(ac);
    }
    // backfill if guardrails blocked too many
    for (const ac of ranked) { if (picked.length >= count) break; if (!picked.includes(ac)) { picked.push(ac); record(ac); } }
    return picked.slice(0, count);
  }

  const experience = [];
  for (const slot of SLOTS.experience) {
    let pool;
    if (slot.pickOne) {
      // choose the role (wake vs shriffle) with the stronger aggregate fit
      const candidates = slot.role.map((r) => ({ r, acs: byRole(r) }));
      const best = candidates.sort((a, b) =>
        (b.acs.reduce((s, x) => s + scoreAc(x), 0)) - (a.acs.reduce((s, x) => s + scoreAc(x), 0)))[0];
      pool = best.acs;
      experience.push({ role: best.r, bullets: fillRole(pool, slot.count).map((ac) => ({ ac, face: pickFace(ac, jdVec, theme) })) });
    } else {
      pool = byRole(slot.role);
      experience.push({ role: slot.role, bullets: fillRole(pool, slot.count).map((ac) => ({ ac, face: pickFace(ac, jdVec, theme) })) });
    }
  }

  // Projects: pick the 2 strongest project GROUPS (by role), 2 bullets each.
  const projAcs = acs.filter((a) => a.slot_kind === "project");
  const groups = {};
  for (const a of projAcs) (groups[a.role] ||= []).push(a);
  const rankedGroups = Object.entries(groups)
    .map(([role, list]) => ({ role, list, s: list.reduce((s, x) => s + scoreAc(x), 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, SLOTS.projects.count);
  const projects = rankedGroups.map(({ role, list }) => ({
    role,
    bullets: [...list].sort((a, b) => scoreAc(b) - scoreAc(a)).slice(0, SLOTS.projects.bulletsEach)
      .map((ac) => ({ ac, face: pickFace(ac, jdVec, theme) })),
  }));

  return { theme: theme?.name, jdVec, matched, experience, projects };
}
