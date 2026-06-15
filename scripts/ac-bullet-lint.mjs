#!/usr/bin/env node
/**
 * Lint AC bank bullets against RESUME_BULLET_GUIDE.md rules.
 * Usage: node scripts/ac-bullet-lint.mjs [--role wake-forest] [--package backend]
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { loadBank } from "./ac-bank.mjs";
import { scoreStoryTriple } from "./ac-story-select.mjs";

const WEAK_VERBS = /^(worked on|helped|assisted|participated|used|supported|involved in)\b/i;
const STRONG_VERBS = /^(architected|built|designed|developed|engineered|implemented|integrated|deployed|automated|standardized|reduced|accelerated|eliminated|unified|enabled|scaled|extracted|synthesized|created|launched|shipped|owned|sustained|delivered|replaced|converted|documented|led|cut|expanded|processed)/i;

const MAX_WORDS = 35;
const MIN_WORDS = 12;
const MAX_AND = 2;
const MAX_COMMAS = 2;
const MAX_SIGNATURE_TECH = 2;

const BANNED_PUFFERY = /\b(modern|advanced|innovative|cutting-edge|cloud-native|cloud native)\b/i;
const BANNED_RESEARCH_STONY = /\bresearch\w*\b/i;

function loadRoleAtsTech() {
  try {
    return yaml.load(fs.readFileSync(path.join("data/ac-bank/ROLE-ATS-TECH.yaml"), "utf8")) || {};
  } catch {
    return {};
  }
}

const ROLE_ATS_TECH = loadRoleAtsTech();

function techPattern(tech) {
  if (tech === "C++") return /C\+\+/;
  if (tech === "C#") return /C#/;
  return new RegExp(`\\b${tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

function countSignatureTech(text, techList) {
  const found = [];
  for (const tech of techList) {
    if (techPattern(tech).test(text)) found.push(tech);
  }
  return found;
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function lintBullet(ac, text) {
  const issues = [];
  const words = wordCount(text);
  const andCount = (text.match(/\band\b/gi) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const firstWord = text.trim().split(/\s+/)[0] || "";

  if (words > MAX_WORDS) issues.push(`too long (${words} words, max ${MAX_WORDS})`);
  if (words < MIN_WORDS) issues.push(`too short (${words} words, min ${MIN_WORDS})`);
  if (andCount > MAX_AND) issues.push(`too many "and" clauses (${andCount})`);
  if (commaCount > MAX_COMMAS) issues.push(`too many commas (${commaCount})`);
  if (WEAK_VERBS.test(text.trim())) issues.push("weak opening verb");
  if (!STRONG_VERBS.test(firstWord)) issues.push(`verb "${firstWord}" not in strong list`);
  if (BANNED_PUFFERY.test(text)) issues.push("banned puffery (modern/advanced/innovative/cloud-native)");
  if (ac.role === "stony-brook" && BANNED_RESEARCH_STONY.test(text)) {
    issues.push('banned word "research" on Stony Brook bullets — use analysis, analytics, or analysts');
  }

  const declared = ac.signature_technologies || [];
  if (declared.length > MAX_SIGNATURE_TECH) {
    issues.push(`too many signature_technologies (${declared.length}, max ${MAX_SIGNATURE_TECH})`);
  }

  if (declared.length) {
    const inText = countSignatureTech(text, declared);
    if (inText.length !== declared.length) {
      issues.push(`signature tech mismatch: declared [${declared.join(", ")}], found [${inText.join(", ") || "none"}]`);
    }
    if (inText.length > MAX_SIGNATURE_TECH) {
      issues.push(`too many signature technologies in text (${inText.length})`);
    }
  }

  let score = 10;
  if (words > MAX_WORDS || words < MIN_WORDS) score -= 2;
  if (andCount > MAX_AND) score -= 1;
  if (commaCount > MAX_COMMAS) score -= 0.5;
  if (!STRONG_VERBS.test(firstWord)) score -= 1.5;
  if (WEAK_VERBS.test(text.trim())) score -= 2;
  if (BANNED_PUFFERY.test(text)) score -= 1;
  if ((ac.signature_technologies || []).length > MAX_SIGNATURE_TECH) score -= 1;

  const hasMetric = /\d|\b10K\+|\b90%|\b100\+|\b2K\+|\b99\.9%|\b5\.0|\b5K\+|\bhours\b|\bminutes\b|\byears\b|\bone-page\b/i.test(text);
  if (!hasMetric && !["AC-046", "AC-048", "AC-053", "AC-058", "AC-060", "AC-061"].includes(ac.id)) score -= 1;

  const hasSoWhat = /\b(clinician|physician|research|clinical|decision|trust|outcomes|segmentation|production|physicians|team|analysts|users)\b/i.test(text);
  if (!hasSoWhat) score -= 0.5;

  return { issues, score: Number(Math.max(0, score).toFixed(1)) };
}

function metricOverlap(acs) {
  const seen = new Map();
  const overlaps = [];
  for (const ac of acs) {
    for (const m of ac.metrics_claimed || []) {
      if (seen.has(m)) overlaps.push({ metric: m, acs: [seen.get(m), ac.id] });
      else seen.set(m, ac.id);
    }
  }
  return overlaps;
}

function main() {
  const roleFilter = process.argv.includes("--role")
    ? process.argv[process.argv.indexOf("--role") + 1]
    : null;
  const pkgName = process.argv.includes("--package")
    ? process.argv[process.argv.indexOf("--package") + 1]
    : null;

  const bank = loadBank();
  let acs = bank.acs.filter((a) => a.variants?.[0]?.text && a.visibility?.default !== false);
  if (roleFilter) acs = acs.filter((a) => a.role === roleFilter);

  console.log(`Bullet lint — bank v${bank.bank_version}${roleFilter ? ` · ${roleFilter}` : ""}\n`);

  let fail = 0;
  for (const ac of acs.sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99))) {
    const text = ac.variants[0].text.replace(/\s+/g, " ").trim();
    const { issues, score } = lintBullet(ac, text);
    const ok = score >= 9.5 && issues.length === 0;
    if (!ok) fail += 1;
    console.log(`${ok ? "✓" : "✗"} ${ac.id} (${score}/10, ${wordCount(text)}w) ${ac.achievement_theme || ac.role}`);
    console.log(`  ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`);
    if (issues.length) console.log(`  → ${issues.join("; ")}`);
  }

  if (roleFilter === "wake-forest" && pkgName) {
    const planner = JSON.parse(fs.readFileSync(path.join("scripts/planner/v2.json"), "utf8"));
    const pkg = planner.canonical_pools["wake-forest"].story_packages.find((p) => p.name === pkgName);
    if (pkg) {
      const triple = pkg.ids.map((id) => bank.acs.find((a) => a.id === id)).filter(Boolean);
      const overlaps = metricOverlap(triple);
      console.log(`\nPackage "${pkgName}": ${pkg.ids.join(" + ")}`);
      for (const ac of triple) {
        console.log(`  · ${ac.id}: ${ac.variants[0].text.replace(/\s+/g, " ").trim()}`);
      }
      if (overlaps.length) {
        fail += 1;
        console.log("  Metric overlap:");
        for (const o of overlaps) console.log(`    ${o.metric}: ${o.acs.join(" & ")}`);
      } else {
        console.log("  Metric overlap: none ✓");
      }
    }
  }

  if (roleFilter) {
    const roleAcs = bank.acs.filter((a) => a.role === roleFilter && a.visibility?.default !== false);
    const anchors = ROLE_ATS_TECH[roleFilter] || [];
    if (anchors.length) {
      const covered = new Set();
      for (const ac of roleAcs) {
        const text = ac.variants?.[0]?.text || "";
        for (const tech of anchors) {
          if (techPattern(tech).test(text)) {
            covered.add(tech);
          }
        }
      }
      const missing = anchors.filter((t) => !covered.has(t));
      console.log(`\nATS tech coverage (bank-wide): ${[...covered].join(", ") || "none"}`);
      if (missing.length) {
        fail += 1;
        console.log(`  ✗ missing in bullets: ${missing.join(", ")}`);
      } else {
        console.log(`  ✓ ${roleFilter} anchor stack spread across bank`);
      }
    }
  }

  if (!roleFilter) {
    console.log("\nBank-wide ATS anchor coverage:");
    for (const [role, anchors] of Object.entries(ROLE_ATS_TECH)) {
      const roleAcs = bank.acs.filter((a) => a.role === role && a.visibility?.default !== false);
      if (!roleAcs.length) continue;
      const covered = new Set();
      for (const ac of roleAcs) {
        const text = ac.variants?.[0]?.text || "";
        for (const tech of anchors) {
          if (techPattern(tech).test(text)) {
            covered.add(tech);
          }
        }
      }
      const missing = anchors.filter((t) => !covered.has(t));
      console.log(`  ${missing.length ? "✗" : "✓"} ${role}${missing.length ? ` — missing: ${missing.join(", ")}` : ""}`);
      if (missing.length) fail += 1;
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main();
