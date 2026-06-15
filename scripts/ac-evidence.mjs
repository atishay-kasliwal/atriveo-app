#!/usr/bin/env node
/**
 * Structured evidence extraction — bullets expose capabilities, not just text.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAXONOMY_PATH = path.join(ROOT, "data/ac-bank/EVIDENCE-TAXONOMY.yaml");

let _taxonomy = null;

export function loadEvidenceTaxonomy(dir = path.join(ROOT, "data/ac-bank")) {
  if (_taxonomy && dir === path.join(ROOT, "data/ac-bank")) return _taxonomy;
  const p = path.join(dir, "EVIDENCE-TAXONOMY.yaml");
  const tax = yaml.load(fs.readFileSync(p, "utf8"));
  if (dir === path.join(ROOT, "data/ac-bank")) _taxonomy = tax;
  return tax;
}

function capStrength(ac, area) {
  const raw = ac.capabilities?.[area];
  if (raw == null) return 0;
  return raw >= 70 ? 1 : raw >= 50 ? 0.6 : 0.3;
}

function proofLevel(ac, tax) {
  const theme = ac.achievement_theme || "";
  for (const [level, spec] of Object.entries(tax.proof_levels || {})) {
    if ((spec.themes || []).includes(theme)) {
      return { level, weight: spec.weight ?? 0.75 };
    }
  }
  return { level: "shipped", weight: 0.8 };
}

function interviewRisk(ac) {
  const recruiter = (ac.strength?.recruiter ?? 7) / 10;
  const wow = ac.wow_score ?? 0.75;
  const { weight } = proofLevel(ac, loadEvidenceTaxonomy());
  const risk = (1 - wow) * (1 - recruiter) * (1 - weight);
  return Number(Math.max(0.02, Math.min(0.35, risk)).toFixed(3));
}

function normalizeTech(t) {
  return String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function themeCapabilities(ac, tax) {
  const theme = ac.achievement_theme || "";
  const fromTheme = tax.theme_capabilities?.[theme] || [];
  const fromConcepts = (ac.concepts_claimed || []).map((c) => String(c).replace(/-/g, "_"));
  const fromIdentity = ac.engineering_identity ? [ac.engineering_identity] : [];
  const areas = Object.entries(ac.capabilities || {})
    .filter(([, v]) => v >= 75)
    .map(([k]) => k);
  return [...new Set([...fromTheme, ...fromConcepts, ...fromIdentity, ...areas])];
}

function noveltyCluster(ac, tax) {
  const theme = ac.achievement_theme || "";
  for (const [cluster, themes] of Object.entries(tax.novelty_clusters || {})) {
    if (themes.includes(theme)) return cluster;
  }
  return theme || ac.id;
}

/**
 * @param {object} ac — bank AC record
 * @param {object} [tax]
 */
export function extractEvidence(ac, tax = loadEvidenceTaxonomy()) {
  const proof = proofLevel(ac, tax);
  return {
    ac_id: ac.id,
    role: ac.role,
    achievement_theme: ac.achievement_theme || null,
    capabilities: themeCapabilities(ac, tax),
    capability_areas: Object.fromEntries(
      (tax.capability_areas || []).map((area) => [area, capStrength(ac, area)]),
    ),
    technologies: (ac.signature_technologies || ac.ats_keywords || [])
      .map((t) => (typeof t === "string" ? t : t?.display || ""))
      .filter(Boolean),
    metrics: ac.metrics_claimed || [],
    domains: inferDomains(ac),
    engineering_type: ac.engineering_identity || inferEngineeringType(ac),
    wow_score: ac.wow_score ?? 0.7,
    recruiter_strength: ac.strength?.recruiter ?? 7,
    differentiator: (tax.differentiator_themes || []).includes(ac.achievement_theme),
    novelty_cluster: noveltyCluster(ac, tax),
    proof_level: proof.level,
    proof_weight: proof.weight,
    interview_risk: interviewRisk(ac),
    evidence_override: ac.evidence || null,
  };
}

function inferDomains(ac) {
  const text = `${ac.fact || ""} ${ac.achievement_theme || ""}`.toLowerCase();
  const domains = [];
  if (/fomc|finance|trading|sp500|macro/.test(text)) domains.push("finance");
  if (/clinical|mri|brain|medical|radiology/.test(text)) domains.push("healthcare");
  if (/insurance|fidelity|erp/.test(text)) domains.push("enterprise");
  if (/resume|compiler|jd/.test(text)) domains.push("devtools");
  return domains;
}

function inferEngineeringType(ac) {
  const caps = ac.capabilities || {};
  const ranked = Object.entries(caps).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || "backend";
}

export function evidenceById(bank, tax = loadEvidenceTaxonomy()) {
  const map = new Map();
  for (const ac of bank.acs || []) map.set(ac.id, extractEvidence(ac, tax));
  return map;
}

/** Flat document-order bullets with global position 1..N */
export function flattenResumeBullets(composition) {
  const out = [];
  for (const role of composition.experience || []) {
    for (const bullet of role.bullets || []) {
      out.push({ ...bullet, slot_role: role.role, slot_kind: "experience" });
    }
  }
  for (const project of composition.projects || []) {
    for (const bullet of project.bullets || []) {
      out.push({ ...bullet, slot_role: project.role, slot_kind: "project" });
    }
  }
  return out.map((b, i) => ({ ...b, position: i + 1 }));
}

export function buildResumeEvidenceProfile(composition, bank, tax = loadEvidenceTaxonomy()) {
  const byId = evidenceById(bank, tax);
  const bullets = flattenResumeBullets(composition).map((b) => {
    const acId = b.ac?.id || b.ac_id;
    return {
      position: b.position,
      slot_role: b.slot_role,
      slot_kind: b.slot_kind,
      ac_id: acId,
      evidence: byId.get(acId) || extractEvidence(b.ac || { id: acId }, tax),
    };
  });

  const capabilityCounts = {};
  const technologyCounts = {};
  const metricSet = new Set();
  const noveltyClusters = {};
  const areaWeights = {};

  for (const row of bullets) {
    const ev = row.evidence;
    const posWeight = positionWeight(row.position, tax);

    for (const cap of ev.capabilities) {
      capabilityCounts[cap] = (capabilityCounts[cap] || 0) + 1;
      areaWeights[cap] = (areaWeights[cap] || 0) + posWeight;
    }
    for (const tech of ev.technologies) {
      const key = normalizeTech(tech);
      technologyCounts[key] = (technologyCounts[key] || 0) + 1;
    }
    for (const m of ev.metrics) metricSet.add(m);
    noveltyClusters[ev.novelty_cluster] = (noveltyClusters[ev.novelty_cluster] || 0) + 1;
  }

  return {
    bullets,
    capability_counts: capabilityCounts,
    technology_counts: technologyCounts,
    unique_metrics: [...metricSet],
    novelty_clusters: noveltyClusters,
    area_weights: areaWeights,
    engineering_identity: inferEngineeringIdentity(areaWeights, tax),
  };
}

function positionWeight(position, tax) {
  const weights = tax.position_weights || [];
  return weights[position - 1] ?? 1.0;
}

function inferEngineeringIdentity(areaWeights) {
  const ranked = Object.entries(areaWeights).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  const topShare = ranked[0] ? ranked[0][1] / total : 0;
  return {
    primary: ranked[0]?.[0] || "backend",
    secondary: ranked[1]?.[0] || null,
    coherence: Number(topShare.toFixed(3)),
    ranked: ranked.slice(0, 5).map(([k, v]) => ({ area: k, weight: Number(v.toFixed(2)) })),
  };
}

export function diminishingReturnValue(occurrence, tax = loadEvidenceTaxonomy()) {
  const curve = tax.diminishing_returns || [1.0, 0.4, 0.1];
  const idx = Math.min(Math.max(0, occurrence - 1), curve.length - 1);
  return curve[idx];
}

export function shannonEntropy(counts) {
  const values = Object.values(counts).filter((n) => n > 0);
  const total = values.reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let h = 0;
  for (const n of values) {
    const p = n / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function weightedCapabilityScore(profile, tax = loadEvidenceTaxonomy()) {
  let score = 0;
  for (const [cap, count] of Object.entries(profile.capability_counts)) {
    let remaining = count;
    while (remaining > 0) {
      const occ = count - remaining + 1;
      score += diminishingReturnValue(occ, tax) * 10;
      remaining -= 1;
    }
  }
  const maxCaps = Object.keys(profile.capability_counts).length;
  return Number(Math.min(100, score / Math.max(1, maxCaps) * 8).toFixed(2));
}

export function noveltyScore(profile, tax = loadEvidenceTaxonomy()) {
  let penalty = 0;
  for (const [, count] of Object.entries(profile.novelty_clusters)) {
    if (count > 1) penalty += (count - 1) * 12;
  }
  const unique = Object.keys(profile.novelty_clusters).length;
  const bullets = profile.bullets.length || 1;
  const raw = (unique / bullets) * 100 - penalty;
  return Number(Math.max(0, Math.min(100, raw)).toFixed(2));
}

export function differentiatorScore(profile, tax = loadEvidenceTaxonomy()) {
  const weights = tax.position_weights || [];
  let score = 0;
  for (const row of profile.bullets) {
    if (!row.evidence.differentiator) continue;
    const w = weights[row.position - 1] ?? 1;
    score += w * (row.evidence.wow_score || 0.8) * 25;
  }
  return Number(Math.min(100, score).toFixed(2));
}

export function interviewSurvivabilityScore(profile) {
  const risks = profile.bullets.map((b) => b.evidence.interview_risk);
  if (!risks.length) return 50;
  const avg = risks.reduce((s, r) => s + r, 0) / risks.length;
  const maxRisk = Math.max(...risks);
  const highRiskCount = risks.filter((r) => r > 0.15).length;
  let score = 100 - avg * 120 - maxRisk * 40 - highRiskCount * 8;
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

export function technologyDiversityScore(profile, tax = loadEvidenceTaxonomy()) {
  let score = 0;
  for (const [, count] of Object.entries(profile.technology_counts)) {
    let remaining = count;
    while (remaining > 0) {
      const occ = count - remaining + 1;
      score += diminishingReturnValue(occ, tax) * 8;
      remaining -= 1;
    }
  }
  const entropy = shannonEntropy(profile.technology_counts);
  return Number(Math.min(100, score * 0.4 + entropy * 18).toFixed(2));
}

export function metricDiversityScore(profile) {
  const n = profile.unique_metrics.length;
  const bullets = profile.bullets.length || 1;
  const dupPenalty = Math.max(0, bullets - n) * 4;
  return Number(Math.max(0, Math.min(100, (n / bullets) * 90 - dupPenalty)).toFixed(2));
}

export function capabilityEntropyScore(profile) {
  const h = shannonEntropy(profile.capability_counts);
  const maxH = Math.log2(Math.max(2, Object.keys(profile.capability_counts).length || 2));
  return Number(Math.min(100, (h / maxH) * 100).toFixed(2));
}

export function positionWeightedStrength(profile, tax = loadEvidenceTaxonomy()) {
  const weights = tax.position_weights || [];
  let sum = 0;
  let wSum = 0;
  for (const row of profile.bullets) {
    const w = weights[row.position - 1] ?? 1;
    const strength = (row.evidence.recruiter_strength / 10) * (row.evidence.wow_score || 0.75);
    sum += w * strength;
    wSum += w;
  }
  return Number((wSum ? (sum / wSum) * 100 : 50).toFixed(2));
}

async function evidenceCli() {
  const { loadBank } = await import("./ac-bank.mjs");
  const bank = loadBank();
  const sample = bank.acs.find((a) => a.id === "AC-023");
  console.log(JSON.stringify(extractEvidence(sample), null, 2));
}

if (process.argv[1]?.endsWith("ac-evidence.mjs")) {
  evidenceCli().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}