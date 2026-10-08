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
import { countSignatureTech, lintBullet, openingVerb, resumeRoles, ROLE_ATS_TECH, sharedOpeningVerbs, techPattern, wordCount } from "./ac-bullet-rules.mjs";

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
