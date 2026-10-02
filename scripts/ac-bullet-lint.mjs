#!/usr/bin/env node
/**
 * Lint AC bank bullets against RESUME_BULLET_GUIDE.md rules.
 * Usage: node scripts/ac-bullet-lint.mjs [--role wake-forest] [--package backend]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadBank } from "./ac-bank.mjs";
import { scoreStoryTriple } from "./ac-story-select.mjs";

const WEAK_VERBS = /^(worked on|helped|assisted|participated|used|supported|involved in)\b/i;
const actionVerbs = JSON.parse(fs.readFileSync(path.join("data/ac-bank/HARVARD_ACTION_VERBS.json"), "utf8"));
const STRONG_VERBS = new Set(Object.values(actionVerbs.categories).flat().map((verb) => verb.toLowerCase()));
const GENERIC_VERBS = new Set(["built", "developed", "trained"]);

const MAX_WORDS = 35;
const MIN_WORDS = 12;
const MAX_AND = 2;
const MAX_COMMAS = 2;
const MAX_SIGNATURE_TECH = 3;

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
  if (!STRONG_VERBS.has(firstWord.toLowerCase()) || GENERIC_VERBS.has(firstWord.toLowerCase())) {
    issues.push(`verb "${firstWord}" is not an allowed Harvard action verb`);
  }
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
  if (!STRONG_VERBS.has(firstWord.toLowerCase()) || GENERIC_VERBS.has(firstWord.toLowerCase())) score -= 1.5;
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

const readYaml = (file) => (fs.existsSync(file) ? yaml.load(fs.readFileSync(file, "utf8")) : null);
const openingVerb = (text) => (String(text).trim().match(/^([A-Za-z]+)/) || [])[1]?.toLowerCase() || "";

/**
 * Roles whose bullets can share one resume: the planner's experience roles and every project a
 * resume can draw from (planner pools, PROJECTS.yaml on_resume, TRACKS.yaml track projects).
 */
function resumeRoles(bankDir) {
  const planner = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "planner", "v2.json"), "utf8"));
  const roles = new Set([
    ...Object.keys(planner.min_bullets_per_role || {}),
    ...(planner.resume_project_pool || []),
    ...(planner.fixed_project_roles || []),
  ]);
  for (const p of readYaml(path.join(bankDir, "PROJECTS.yaml"))?.projects || []) if (p.on_resume) roles.add(p.role);
  for (const t of Object.values(readYaml(path.join(bankDir, "TRACKS.yaml"))?.tracks || {})) for (const r of t.projects || []) roles.add(r);
  return roles;
}

/**
 * Opening verbs shared by bullets that can appear on the same resume. Every variant counts:
 * compose refuses a resume that repeats a verb (assertUniqueCompositionVerbs), so a shared
 * verb here would fail that resume's build.
 */
function sharedOpeningVerbs(acs, roles) {
  const byVerb = new Map();
  for (const ac of acs.filter((a) => roles.has(a.role))) {
    for (const v of ac.variants || []) {
      const verb = openingVerb(v.text);
      if (!byVerb.has(verb)) byVerb.set(verb, new Set());
      byVerb.get(verb).add(ac.id);
    }
  }
  return [...byVerb].filter(([, ids]) => ids.size > 1).map(([verb, ids]) => ({ verb, ids: [...ids] }));
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

  if (!roleFilter) {
    const roles = resumeRoles(bank.bank_dir);
    const active = bank.acs.filter((a) => a.variants?.[0]?.text && a.visibility?.default !== false);
    const shared = sharedOpeningVerbs(active, roles);
    console.log(`\nUnique opening verbs across resume roles (${[...roles].join(", ")}):`);
    if (shared.length) {
      for (const { verb, ids } of shared) console.log(`  ✗ "${verb}" opens ${ids.join(", ")}`);
      fail += shared.length;
    } else {
      console.log("  ✓ every bullet that can share a resume opens with its own verb");
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main();
