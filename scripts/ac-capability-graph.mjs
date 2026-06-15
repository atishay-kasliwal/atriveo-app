#!/usr/bin/env node
/**
 * Capability DAG — hierarchical evidence with ancestor satisfaction and information gain.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { diminishingReturnValue, loadEvidenceTaxonomy } from "./ac-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let _graph = null;
let _index = null;

export function loadCapabilityGraph(dir = path.join(ROOT, "data/ac-bank")) {
  if (_graph && dir === path.join(ROOT, "data/ac-bank")) return _graph;
  const g = yaml.load(fs.readFileSync(path.join(dir, "CAPABILITY-GRAPH.yaml"), "utf8"));
  if (dir === path.join(ROOT, "data/ac-bank")) _graph = g;
  return g;
}

function buildGraphIndex(graph) {
  if (_index && graph === _graph) return _index;

  const nodes = graph.graph || {};
  const parents = {};
  const children = {};
  const labels = {};

  for (const [id, spec] of Object.entries(nodes)) {
    labels[id] = spec.label || id;
    children[id] = [...(spec.children || [])];
    for (const p of spec.parents || []) {
      (parents[id] ||= []).push(p);
      (children[p] ||= []).push(id);
    }
    for (const c of spec.children || []) {
      (children[id] ||= []).push(c);
      (parents[c] ||= []).push(id);
    }
  }

  for (const id of Object.keys(nodes)) {
    parents[id] = [...new Set(parents[id] || [])];
    children[id] = [...new Set(children[id] || [])];
  }

  _index = { nodes, parents, children, labels };
  return _index;
}

export function resolveCapabilityNode(cap, graph = loadCapabilityGraph()) {
  const aliases = graph.capability_aliases || {};
  const key = String(cap || "").toLowerCase().replace(/-/g, "_");
  return aliases[key] || key;
}

/** Walk up DAG — direct node gets strength 1.0, ancestors decay. */
export function expandCapabilities(leafCaps, graph = loadCapabilityGraph()) {
  const idx = buildGraphIndex(graph);
  const decay = graph.ancestor_decay ?? 0.45;
  const coverage = {};

  function add(node, strength) {
    if (!node || strength < 0.05) return;
    const prev = coverage[node] || 0;
    if (strength <= prev) return;
    coverage[node] = Math.min(1, strength);
    for (const parent of idx.parents[node] || []) {
      add(parent, strength * decay);
    }
  }

  for (const cap of leafCaps || []) {
    add(resolveCapabilityNode(cap, graph), 1.0);
  }

  return coverage;
}

export function mergeCoverage(maps) {
  const out = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m || {})) {
      out[k] = Math.min(1, Math.max(out[k] || 0, v));
    }
  }
  return out;
}

/**
 * Information gain of adding one bullet given prior coverage state.
 * @returns {{ gain: number, adds: string[], implied: string[], redundant: string[] }}
 */
export function informationGain(evidence, priorCoverage, graph = loadCapabilityGraph()) {
  const leafCaps = evidence.capabilities || [];
  const expanded = expandCapabilities(leafCaps, graph);
  const adds = [];
  const implied = [];
  const redundant = [];

  let gain = 0;
  const tax = loadEvidenceTaxonomy();

  for (const [node, strength] of Object.entries(expanded)) {
    const prior = priorCoverage[node] || 0;
    const delta = strength * (1 - prior);
    if (delta < 0.02) {
      if (prior >= 0.5) redundant.push(node);
      continue;
    }
    const occ = Object.values(priorCoverage).filter((v) => v >= 0.5).length;
    const weight = diminishingReturnValue(occ + 1, tax) * 10;
    gain += delta * weight;
    if (strength >= 0.95) adds.push(node);
    else implied.push(node);
    priorCoverage[node] = Math.min(1, prior + delta);
  }

  for (const tech of evidence.technologies || []) {
    const key = String(tech).toLowerCase();
    const tw = graph.technology_weights?.[key] ?? 3;
    gain += tw * 0.08;
  }

  for (const m of evidence.metrics || []) {
    gain += 1.2;
  }

  if (evidence.differentiator) gain += 4;

  return {
    gain: Number(gain.toFixed(2)),
    adds,
    implied,
    redundant,
    coverage_after: { ...priorCoverage },
  };
}

export function buildCoverageState(bullets, graph = loadCapabilityGraph()) {
  const coverage = {};
  const perBullet = [];

  for (const row of bullets || []) {
    const prior = { ...coverage };
    const ig = informationGain(row.evidence, prior, graph);
    Object.assign(coverage, ig.coverage_after);
    perBullet.push({ ac_id: row.ac_id, position: row.position, ...ig });
  }

  return { coverage, per_bullet: perBullet, total_gain: perBullet.reduce((s, b) => s + b.gain, 0) };
}

export function graphCapabilityScore(coverage, graph = loadCapabilityGraph()) {
  const idx = buildGraphIndex(graph);
  const roots = Object.keys(graph.identity_roots || {});
  let score = 0;
  for (const [node, strength] of Object.entries(coverage)) {
    const rootBoost = roots.includes(node) ? 1.15 : 1.0;
    score += strength * 12 * rootBoost;
  }
  const leafCount = Object.keys(coverage).filter((n) => !(idx.children[n]?.length)).length;
  return Number(Math.min(100, score / Math.max(4, leafCount) * 6).toFixed(2));
}

function primaryBreadthBucket(evidence) {
  const areas = evidence?.capability_areas || {};
  const ranked = Object.entries(areas).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] < 0.85) return null;
  const second = ranked[1]?.[1] ?? 0;
  if (top[1] - second < 0.08) return null;
  if (top[0] === "ml") return "ml_systems";
  return top[0];
}

export function negativeBreadthPenalty(bullets, graph = loadCapabilityGraph()) {
  const limits = graph.breadth_limits || {};
  const penaltyEach = graph.breadth_penalty_per_excess ?? 5;
  const counts = {};

  for (const row of bullets || []) {
    const bucket = primaryBreadthBucket(row.evidence);
    if (bucket) counts[bucket] = (counts[bucket] || 0) + 1;

    const theme = row.evidence?.achievement_theme || "";
    if (/evaluation|retrieval-eval|agent-evaluation|llm-evaluation/.test(theme)) {
      counts.evaluation = (counts.evaluation || 0) + 1;
    }

    for (const tech of row.evidence?.technologies || []) {
      const key = String(tech).toLowerCase();
      if (key === "langchain") counts.langchain = (counts.langchain || 0) + 1;
    }
  }

  let penalty = 0;
  const issues = [];
  for (const [area, limit] of Object.entries(limits)) {
    const actual = counts[area] || 0;
    if (actual > limit) {
      const excess = actual - limit;
      penalty += excess * penaltyEach;
      issues.push({ area, actual, limit, excess });
    }
  }

  return { penalty: Number(penalty.toFixed(2)), issues };
}

export function technologyWeightedScore(profile, graph = loadCapabilityGraph()) {
  const weights = graph.technology_weights || {};
  let score = 0;
  const seen = new Set();

  for (const row of profile.bullets || []) {
    for (const tech of row.evidence?.technologies || []) {
      const key = String(tech).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const w = weights[key] ?? 3;
      const count = profile.technology_counts?.[key] || 1;
      score += w * diminishingReturnValue(count, loadEvidenceTaxonomy());
    }
  }

  return Number(Math.min(100, score * 1.8).toFixed(2));
}

export function storyTransitionScore(bullets, graph = loadCapabilityGraph()) {
  const flow = graph.story_flow || {};
  if ((bullets || []).length < 2) return 50;

  let good = 0;
  let total = 0;

  for (let i = 1; i < bullets.length; i += 1) {
    const prev = primaryStoryNode(bullets[i - 1].evidence);
    const curr = primaryStoryNode(bullets[i].evidence);
    total += 1;
    const allowed = flow[prev] || [];
    if (allowed.includes(curr) || prev === curr) good += 1;
    else if (allowed.length === 0) good += 0.4;
  }

  return Number(Math.min(100, (good / total) * 100).toFixed(2));
}

function primaryStoryNode(evidence) {
  const caps = evidence?.capabilities || [];
  return resolveCapabilityNode(caps[0] || evidence?.engineering_type || "backend");
}

export function evidenceDensityScore(bullets, graph = loadCapabilityGraph()) {
  if (!bullets?.length) return 0;
  let total = 0;

  for (const row of bullets) {
    const expanded = expandCapabilities(row.evidence?.capabilities || [], graph);
    const nodes = Object.keys(expanded).length;
    const techs = (row.evidence?.technologies || []).length;
    const metrics = (row.evidence?.metrics || []).length;
    const density = nodes * 1.5 + techs * 0.8 + metrics * 1.2;
    total += Math.min(18, density);
  }

  return Number(Math.min(100, (total / bullets.length) * 5.5).toFixed(2));
}

export function engineeringIdentityConfidence(coverage, graph = loadCapabilityGraph()) {
  const roots = graph.identity_roots || {};
  const idx = buildGraphIndex(graph);

  const rootWeights = {};
  for (const root of Object.keys(roots)) {
    rootWeights[root] = coverage[root] || 0;
    for (const [node, strength] of Object.entries(coverage)) {
      if (node === root) continue;
      if (ancestorOf(root, node, idx.parents)) {
        rootWeights[root] += strength * 0.35;
      }
    }
  }

  const ranked = Object.entries(rootWeights).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] || ["backend", 0];
  const second = ranked[1] || [null, 0];
  const total = ranked.reduce((s, [, w]) => s + w, 0) || 1;
  const confidence = top[1] / (top[1] + second[1] + 0.01);

  return {
    primary: roots[top[0]] || top[0],
    primary_node: top[0],
    secondary: second[0] ? (roots[second[0]] || second[0]) : null,
    confidence: Number(Math.min(1, confidence).toFixed(3)),
    coherence: Number((top[1] / total).toFixed(3)),
    ranked: ranked.slice(0, 4).map(([node, w]) => ({
      node,
      label: roots[node] || idx.labels[node] || node,
      weight: Number(w.toFixed(3)),
    })),
  };
}

function ancestorOf(ancestor, node, parents, seen = new Set()) {
  if (node === ancestor) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  for (const p of parents[node] || []) {
    if (ancestorOf(ancestor, p, parents, seen)) return true;
  }
  return false;
}

export function explainRejection({
  candidateEvidence,
  selectedEvidence,
  priorCoverage,
  graph = loadCapabilityGraph(),
}) {
  const reasons = [];
  const ig = informationGain(candidateEvidence, { ...priorCoverage }, graph);
  const selectedIg = informationGain(selectedEvidence, { ...priorCoverage }, graph);

  if (ig.gain < selectedIg.gain - 0.5) {
    reasons.push(`Lower information gain (${ig.gain} vs selected ${selectedIg.gain.toFixed(1)})`);
  }
  if (ig.redundant.length) {
    reasons.push(`Already proven: ${ig.redundant.slice(0, 4).join(", ")}`);
  }
  if (ig.adds.length <= 1 && ig.implied.length <= 2) {
    reasons.push(`Adds only ${ig.adds.length} new capability node(s)`);
  }
  if (ig.gain < 2) {
    reasons.push(`Information gain too low (${ig.gain})`);
  }

  return {
    ac_id: candidateEvidence.ac_id,
    information_gain: ig.gain,
    selected_gain: selectedIg.gain,
    adds: ig.adds,
    implied: ig.implied,
    redundant: ig.redundant,
    reasons: reasons.length ? reasons : ["Lower composite global score"],
  };
}