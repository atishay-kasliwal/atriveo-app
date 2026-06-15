// AC "embeddings" via capability vectors + keyword overlap (no external model).
// Scales retrieval when the bank grows beyond ~50 ACs.

import { jdToVector, parseAtsKeywords } from "./ac-bank.mjs";

function acFeatureVector(ac) {
  const caps = ac.capabilities || {};
  const vec = {};
  for (const [k, v] of Object.entries(caps)) vec[k] = (v || 0) / 100;

  const keywords = [...parseAtsKeywords(ac).keys()];
  for (const kw of keywords) vec[`kw:${kw}`] = 0.35;

  if (ac.facets) {
    for (const facet of Object.keys(ac.facets)) vec[`facet:${facet}`] = 0.25;
  }
  return vec;
}

function cosineSparse(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const av = a[key] || 0;
    const bv = b[key] || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jdFeatureVector(jdVec, matched = {}) {
  const vec = {};
  for (const [concept, val] of Object.entries(jdVec || {})) {
    vec[concept] = (val || 0) / 100;
  }
  for (const [concept, keywords] of Object.entries(matched || {})) {
    for (const kw of keywords || []) vec[`kw:${String(kw).toLowerCase()}`] = 0.4;
  }
  return vec;
}

export function embedAc(ac) {
  return {
    ac_id: ac.id,
    role: ac.role,
    vector: acFeatureVector(ac),
  };
}

export function embedJd(jd, bank) {
  const { vec, matched } = jdToVector(jd, bank.concepts);
  return jdFeatureVector(vec, matched);
}

export function rankAcsForJd(jd, bank) {
  const jdVec = embedJd(jd, bank);
  return (bank.acs || []).map((ac) => {
    const acVec = acFeatureVector(ac);
    const similarity = cosineSparse(jdVec, acVec);
    return { ac_id: ac.id, role: ac.role, score: Number(similarity.toFixed(4)), ac };
  }).sort((a, b) => b.score - a.score);
}

export function retrieveCandidateAcs(jd, bank, topK = 20) {
  return rankAcsForJd(jd, bank).slice(0, topK);
}
