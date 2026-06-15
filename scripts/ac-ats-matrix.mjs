#!/usr/bin/env node
/**
 * ATS coverage matrix — count keyword occurrences in a composed resume;
 * penalize missing (below min) and over-repetition (above max).
 * Usage:
 *   node scripts/ac-ats-matrix.mjs path/to/composition.json
 *   node scripts/ac-ats-matrix.mjs --jd-batch output/ac-resumes/.../04-ramp/composition.json
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_PATH = path.join(ROOT, "data/ac-bank/ATS_COVERAGE_MATRIX.yaml");

function loadMatrix() {
  return yaml.load(fs.readFileSync(MATRIX_PATH, "utf8")) || {};
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTerm(text, term) {
  if (term === "C++") return (text.match(/C\+\+/g) || []).length;
  if (term === "CI/CD") return (text.match(/\bCI\/CD\b/gi) || []).length;
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, "gi");
  return (text.match(re) || []).length;
}

function collectCorpus(composition, skills = []) {
  const parts = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) {
      parts.push(String(b.text || b.face?.text || "").trim());
    }
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) {
      parts.push(String(b.text || b.face?.text || "").trim());
    }
  }
  parts.push(...(skills || []));
  return parts.filter(Boolean).join("\n");
}

function collectBullets(composition) {
  const out = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) {
      out.push({
        ac_id: b.ac_id || b.ac?.id,
        text: String(b.text || b.face?.text || "").trim(),
      });
    }
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) {
      out.push({
        ac_id: b.ac_id || b.ac?.id,
        text: String(b.text || b.face?.text || "").trim(),
      });
    }
  }
  return out;
}

function detectStuffing(bulletText, matrix) {
  const tokens = matrix.stuffing?.bare_tech_tokens || [];
  const maxRun = matrix.stuffing?.max_bare_tech_run ?? 3;
  const words = bulletText.split(/\s+/);
  let run = 0;
  let maxSeen = 0;
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z0-9/+.-]/g, "");
    const hit = tokens.some((t) => new RegExp(`^${escapeRe(t)}$`, "i").test(clean) || clean.toLowerCase() === t.toLowerCase());
    if (hit) {
      run += 1;
      maxSeen = Math.max(maxSeen, run);
    } else {
      run = 0;
    }
  }
  return maxSeen > maxRun ? maxSeen : 0;
}

export function auditAtsMatrix(composition, skills = [], matrix = loadMatrix()) {
  const corpus = collectCorpus(composition, skills);
  const keywords = matrix.keywords || {};
  const scoring = matrix.scoring || {};
  const rows = [];
  const missing = [];
  const over = [];

  for (const [keyword, cfg] of Object.entries(keywords)) {
    const terms = [keyword, ...(cfg.synonyms || [])];
    let count = 0;
    const matchedBy = {};
    for (const term of terms) {
      const n = countTerm(corpus, term);
      if (n) matchedBy[term] = n;
      count += n;
    }
    const row = {
      keyword,
      count,
      min: cfg.min ?? 0,
      max: cfg.max ?? 99,
      matched_by: matchedBy,
      status: "ok",
    };
    if (count < row.min) {
      row.status = "missing";
      missing.push(keyword);
    } else if (count > row.max) {
      row.status = "over";
      over.push(keyword);
    }
    rows.push(row);
  }

  const stuffingBullets = [];
  for (const b of collectBullets(composition)) {
    const run = detectStuffing(b.text, matrix);
    if (run) stuffingBullets.push({ ac_id: b.ac_id, run, text: b.text.slice(0, 100) });
  }

  let score = 100;
  score -= missing.length * (scoring.missing_penalty ?? 8);
  for (const row of rows.filter((r) => r.status === "over")) {
    score -= (row.count - row.max) * (scoring.over_penalty ?? 5);
  }
  score -= stuffingBullets.length * (scoring.stuffing_penalty ?? 6);
  score = Math.max(0, Math.min(100, score));

  return {
    score: Number(score.toFixed(1)),
    rows: rows.sort((a, b) => a.keyword.localeCompare(b.keyword)),
    missing,
    over,
    stuffing_bullets: stuffingBullets,
    corpus_length: corpus.length,
  };
}

export function scoreAtsMatrix(composition, skills = []) {
  return auditAtsMatrix(composition, skills).score;
}

/** Keyword counts from bullet/skill text lines (for incremental selection scoring). */
export function keywordCountsFromTexts(texts, matrix = loadMatrix()) {
  const counts = {};
  for (const keyword of Object.keys(matrix.keywords || {})) counts[keyword] = 0;
  for (const text of texts || []) {
    if (!text) continue;
    for (const [keyword, cfg] of Object.entries(matrix.keywords || {})) {
      const terms = [keyword, ...(cfg.synonyms || [])];
      for (const term of terms) counts[keyword] += countTerm(text, term);
    }
  }
  return counts;
}

/** Penalty for adding new bullet texts given running keyword counts (selection objective). */
export function atsPenaltyForAddingTexts(newTexts, currentCounts = {}, matrix = loadMatrix()) {
  const scoring = matrix.scoring || {};
  const delta = keywordCountsFromTexts(newTexts, matrix);
  let penalty = 0;
  for (const [keyword, add] of Object.entries(delta)) {
    if (!add) continue;
    const cfg = matrix.keywords?.[keyword];
    if (!cfg) continue;
    const before = currentCounts[keyword] || 0;
    const after = before + add;
    const min = cfg.min ?? 0;
    const max = cfg.max ?? 99;
    if (after > max) penalty += (after - max) * (scoring.over_penalty ?? 5);
    if (before < min && after >= min) penalty -= (scoring.missing_reward ?? 2);
  }
  for (const text of newTexts || []) {
    const run = detectStuffing(text, matrix);
    if (run) penalty += scoring.stuffing_penalty ?? 6;
  }
  return Number(penalty.toFixed(4));
}

export function bulletTextsFromAcs(acs) {
  return (acs || []).map((ac) => String(ac?.variants?.[0]?.text || ac?.fact || "").trim()).filter(Boolean);
}

export function formatAtsMatrixMarkdown(audit) {
  const lines = [
    `**ATS matrix score:** ${audit.score}/100`,
    "",
    "| Keyword | Count | Min | Max | Status |",
    "|---------|------:|----:|----:|--------|",
  ];
  for (const row of audit.rows) {
    if (row.min === 0 && row.count === 0 && row.status === "ok") continue;
    const icon = row.status === "ok" ? "✓" : row.status === "missing" ? "✗ low" : "⚠ high";
    lines.push(`| ${row.keyword} | ${row.count} | ${row.min} | ${row.max} | ${icon} |`);
  }
  if (audit.missing.length) {
    lines.push("");
    lines.push(`**Below minimum:** ${audit.missing.join(", ")}`);
  }
  if (audit.over.length) {
    lines.push("");
    lines.push(`**Above maximum:** ${audit.over.join(", ")}`);
  }
  if (audit.stuffing_bullets.length) {
    lines.push("");
    lines.push("**Keyword stuffing (bare tech runs):**");
    for (const s of audit.stuffing_bullets) {
      lines.push(`- ${s.ac_id}: ${s.run} consecutive tokens — ${s.text}…`);
    }
  }
  return lines.join("\n");
}

function main() {
  const file = process.argv.find((a) => a.endsWith(".json") && !a.startsWith("-"))
    || process.argv[process.argv.indexOf("--jd-batch") + 1];
  if (!file) {
    console.error("Usage: node scripts/ac-ats-matrix.mjs <composition.json>");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const composition = data.composition?.experience
    ? data.composition
    : data.composition || data;
  const skills = data.skills || composition.skills || [];
  const audit = auditAtsMatrix(composition, skills);
  console.log(formatAtsMatrixMarkdown(audit));
  process.exit(audit.missing.length || audit.over.length || audit.stuffing_bullets.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
