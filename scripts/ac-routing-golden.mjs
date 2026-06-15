#!/usr/bin/env node
/**
 * Golden routing tests for SBU story packages.
 * Usage: node scripts/ac-routing-golden.mjs [--fixture openai-ai]
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { loadBank } from "./ac-bank.mjs";
import { compose } from "./ac-bank.mjs";
import { loadPlannerConfig } from "./ac-planner.mjs";
import { buildPlannerRuntimeConfig } from "./ac-planner.mjs";
import { assessJdGate } from "./ac-jd-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_PATH = path.join(ROOT, "data/ac-bank/SBU-ROUTING-GOLDEN.yaml");

function bulletIds(composition, role) {
  const block = composition.experience?.find((r) => r.role === role);
  return (block?.bullets || []).map((b) => b.ac?.id || b.ac_id).filter(Boolean);
}

function runFixture(fixture, bank, runtime) {
  const exp = fixture.expected || {};
  const gate = assessJdGate(fixture.jd, { title: fixture.expected?.title });

  if (exp.unsupported_jd) {
    if (gate.can_compose) {
      return { ok: false, id: fixture.id, error: `Expected unsupported JD, got outcome ${gate.outcome}` };
    }
    if (exp.max_confidence != null && gate.relevance?.confidence > exp.max_confidence) {
      return { ok: false, id: fixture.id, error: `Confidence ${gate.relevance.confidence} above max ${exp.max_confidence}` };
    }
    const comp = compose(fixture.jd, bank, runtime);
    if (!comp.unsupported_jd) {
      return { ok: false, id: fixture.id, error: "compose() should return unsupported_jd" };
    }
    return { ok: true, id: fixture.id, gate };
  }

  const composition = compose(fixture.jd, bank, runtime);
  const role = exp.role || "stony-brook";
  const ids = bulletIds(composition, role);
  const winner = composition.selection_trace?.package_winners?.[role];

  if (exp.package && winner?.package !== exp.package) {
    return {
      ok: false,
      id: fixture.id,
      error: `Expected package ${exp.package}, got ${winner?.package || "none"}`,
      ids,
    };
  }

  if (exp.bullets?.length && ids.join(",") !== exp.bullets.join(",")) {
    return {
      ok: false,
      id: fixture.id,
      error: `Expected bullets ${exp.bullets.join(",")}, got ${ids.join(",")}`,
      package: winner?.package,
    };
  }

  if (exp.must_include?.length) {
    const missing = exp.must_include.filter((id) => !ids.includes(id));
    if (missing.length) {
      return {
        ok: false,
        id: fixture.id,
        error: `Missing required bullets: ${missing.join(", ")}`,
        ids,
        package: winner?.package,
      };
    }
  }

  return { ok: true, id: fixture.id, package: winner?.package, ids };
}

function main() {
  const filter = process.argv.includes("--fixture")
    ? process.argv[process.argv.indexOf("--fixture") + 1]
    : null;
  const golden = yaml.load(fs.readFileSync(GOLDEN_PATH, "utf8"));
  const bank = loadBank();
  const cfg = loadPlannerConfig("v2");
  const runtime = buildPlannerRuntimeConfig("v2", { bank });
  runtime.narrative_first = cfg.narrative_first !== false;

  let fixtures = golden.fixtures || [];
  if (filter) fixtures = fixtures.filter((f) => f.id === filter);

  let fail = 0;
  for (const fixture of fixtures) {
    const result = runFixture(fixture, bank, runtime);
    if (result.ok) {
      console.log(`✓ ${fixture.id} · package=${result.package || "n/a"} · ${(result.ids || []).join("+")}`);
    } else {
      fail += 1;
      console.log(`✗ ${fixture.id}: ${result.error}`);
    }
  }

  if (fail) {
    console.log(`\n${fail} golden routing test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${fixtures.length} golden routing tests passed.`);
}

main();
