#!/usr/bin/env node
/**
 * Seed Accolite canonical bank — AC-163 through AC-197 (35 achievements).
 * Reads bullet definitions from data/ac-bank/ACCOLITE-SEED.json.
 * Run: node scripts/ac-accolite-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANK = path.join(ROOT, "data/ac-bank");
const SEED_PATH = path.join(BANK, "ACCOLITE-SEED.json");

function buildAc(entry) {
  const tech = entry.signature_technologies;
  return {
    id: entry.id,
    role: "accolite",
    slot_kind: "experience",
    engineering_identity: entry.engineering_identity,
    client_context: entry.client_context,
    achievement_theme: entry.achievement_theme,
    display_order: entry.display_order,
    wow_score: entry.wow_score,
    metrics_claimed: entry.metrics_claimed,
    concepts_claimed: [entry.engineering_identity],
    signature_technologies: tech,
    fact: entry.fact,
    capabilities: {
      backend: entry.engineering_identity === "backend" ? 90 : 78,
      frontend: entry.engineering_identity === "fullstack" ? 88 : 70,
      cloud: entry.engineering_identity === "cloud" ? 90 : 72,
      data: entry.engineering_identity === "enterprise" ? 82 : 70,
      leadership: entry.engineering_identity === "leadership" ? 92 : 65,
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

if (!Array.isArray(bullets) || bullets.length !== 35) {
  throw new Error(`Expected 35 bullets in ACCOLITE-SEED.json, got ${bullets.length}`);
}

for (const entry of bullets) {
  const file = path.join(BANK, `${entry.id}.yaml`);
  fs.writeFileSync(file, yaml.dump(buildAc(entry), { lineWidth: 120, noRefs: true }));
  console.log("wrote", entry.id);
}

console.log(`\nSeeded ${bullets.length} Accolite AC files from ACCOLITE-SEED.json.`);
