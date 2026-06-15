#!/usr/bin/env node
/**
 * Seed Stony Brook canonical bank from STONY-BROOK-SEED.json
 * Run: node scripts/ac-stony-brook-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANK = path.join(ROOT, "data/ac-bank");
const SEED_PATH = path.join(BANK, "STONY-BROOK-SEED.json");

function buildAc(entry) {
  const tech = entry.signature_technologies || [];
  const caps = entry.capabilities || {};
  return {
    id: entry.id,
    role: "stony-brook",
    slot_kind: "experience",
    engineering_identity: entry.engineering_identity,
    achievement_theme: entry.achievement_theme,
    display_order: entry.display_order,
    wow_score: entry.wow_score,
    metrics_claimed: entry.metrics_claimed || [],
    concepts_claimed: [entry.engineering_identity],
    signature_technologies: tech,
    fact: entry.fact,
    capabilities: {
      ai: caps.ai ?? 70,
      backend: caps.backend ?? 70,
      frontend: caps.frontend ?? 65,
      data: caps.data ?? 65,
      cloud: caps.cloud ?? 65,
      ml: caps.ml ?? 65,
    },
    strength: { recruiter: entry.tier === "S" ? 9 : entry.tier === "A" ? 8 : 7 },
    ats_keywords: entry.ats_keywords || tech,
    facets: {
      default: {
        phrase: entry.achievement_theme,
        keywords: tech.map((t) => t.toLowerCase()),
      },
    },
    variants: [
      {
        facet: "default",
        emphasis: "default",
        strength: entry.tier === "S" ? 9 : 8,
        text: entry.text,
      },
    ],
  };
}

const bullets = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
for (const entry of bullets) {
  const file = path.join(BANK, `${entry.id}.yaml`);
  fs.writeFileSync(file, yaml.dump(buildAc(entry), { lineWidth: 120, noRefs: true }));
  console.log("wrote", entry.id);
}
console.log(`\nSeeded ${bullets.length} Stony Brook AC files.`);
