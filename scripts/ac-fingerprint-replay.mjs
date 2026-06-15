#!/usr/bin/env node
/**
 * Deterministic compile replay from fingerprint manifest.
 *
 *   npm run ac:replay -- <fingerprint|prefix>
 *   npm run ac:replay -- --list
 *   npm run ac:replay -- <fp> --compile
 *   npm run ac:replay -- <fp> --json
 *
 * Re-runs the AC compose pipeline with the stored JD and compares against
 * composition.json from the original run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashJd } from "./ac-fingerprint.mjs";
import { loadBank } from "./ac-bank.mjs";
import { generateResume, compactPipelineResult, PIPELINE_VERSION } from "./ac-pipeline.mjs";
import {
  artifactDir,
  loadFingerprintBundle,
  listManifests,
  resolveFingerprint,
} from "./ac-artifact-store.mjs";
import { assessJdGate } from "./ac-jd-gate.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  return {
    fingerprint: positional[0] || null,
    list: flags.has("--list"),
    compile: flags.has("--compile"),
    json: flags.has("--json"),
    force: flags.has("--force"),
  };
}

function compareField(label, stored, fresh, issues) {
  const a = stored ?? null;
  const b = fresh ?? null;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    issues.push({ field: label, stored: a, fresh: b });
  }
}

function compareCompositions(stored, freshCompact) {
  const issues = [];
  compareField("selected_acs", stored?.selected_acs, freshCompact?.selected_acs, issues);
  compareField("resume_confidence_score", stored?.resume_confidence_score, freshCompact?.resume_confidence_score, issues);
  compareField("thesis", stored?.thesis, freshCompact?.thesis, issues);
  compareField("planner", stored?.planner, freshCompact?.planner, issues);
  compareField(
    "engineering_identity",
    stored?.engineering_identity?.primary ?? stored?.explain?.engineering_identity?.primary,
    freshCompact?.engineering_identity?.primary ?? freshCompact?.explain?.engineering_identity?.primary,
    issues,
  );

  const storedAcs = stored?.selected_acs || [];
  const freshAcs = freshCompact?.selected_acs || [];
  const slotDiffs = [];
  const len = Math.max(storedAcs.length, freshAcs.length);
  for (let i = 0; i < len; i++) {
    if (storedAcs[i] !== freshAcs[i]) {
      slotDiffs.push({ slot: i + 1, stored: storedAcs[i] || null, fresh: freshAcs[i] || null });
    }
  }

  return {
    match: issues.length === 0 && slotDiffs.length === 0,
    issues,
    slotDiffs,
    stored_rcs: stored?.resume_confidence_score ?? null,
    fresh_rcs: freshCompact?.resume_confidence_score ?? null,
  };
}

function writeReplayReport(fingerprint, report) {
  const dir = path.join(artifactDir(fingerprint), "replay");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

async function replayFingerprint(fingerprintInput, { compile = false, json = false, force = false } = {}) {
  const bundle = loadFingerprintBundle(fingerprintInput);
  const { fingerprint, manifest, runDir, jd, composition: stored } = bundle;

  if (!jd || jd.trim().length < 200) {
    throw new Error(`jd.txt missing or too short in ${runDir}`);
  }

  const jdHash = hashJd(jd);
  if (manifest.jd_hash && manifest.jd_hash !== jdHash) {
    throw new Error(`JD hash mismatch — manifest ${manifest.jd_hash} vs disk ${jdHash}`);
  }

  const bank = loadBank();
  const warnings = [];
  if (manifest.bank_version != null && bank.bank_version !== manifest.bank_version) {
    warnings.push(`Bank version drift: manifest v${manifest.bank_version} vs loaded v${bank.bank_version}`);
  }
  if (manifest.pipeline_version && manifest.pipeline_version !== PIPELINE_VERSION) {
    warnings.push(`Pipeline version drift: manifest ${manifest.pipeline_version} vs current ${PIPELINE_VERSION}`);
  }

  const planner = manifest.planner || "v2";
  const company = manifest.job?.company || bundle.meta?.company || "replay";
  const title = manifest.job?.title || bundle.meta?.role || "role";

  const jdGate = assessJdGate(jd, { title });
  const pipeline = generateResume({
    jd,
    planner,
    meta: { company, title },
    jdGate,
    forceBorderline: jdGate.outcome === "borderline",
  });

  if (pipeline.unsupported_jd || !pipeline.result) {
    throw new Error(pipeline.jd_gate?.message || "Replay compose blocked — unsupported JD");
  }

  const freshCompact = compactPipelineResult(pipeline);
  const comparison = compareCompositions(stored, freshCompact);

  let compileResult = null;
  if (compile) {
    const replayDir = path.join(artifactDir(fingerprint), "replay", new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-"));
    fs.mkdirSync(replayDir, { recursive: true });
    fs.writeFileSync(path.join(replayDir, "jd.txt"), jd);
    fs.writeFileSync(path.join(replayDir, "composition.json"), `${JSON.stringify(freshCompact, null, 2)}\n`);
    if (pipeline.result.tex) {
      fs.writeFileSync(path.join(replayDir, "resume.tex"), pipeline.result.tex);
    }
    compileResult = { replayDir, note: "Tex written — run tectonic resume.tex in replayDir for PDF verification" };
  }

  const report = {
    ok: comparison.match,
    fingerprint,
    run_dir: runDir,
    manifest_status: manifest.status,
    planner,
    jd_hash: jdHash,
    jd_chars: jd.length,
    warnings,
    comparison,
    compile: compileResult,
    replayed_at: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    bank_version: bank.bank_version,
  };

  const reportPath = writeReplayReport(fingerprint, report);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nReplay · ${fingerprint.slice(0, 20)}…`);
    console.log(`  Job      · ${company} · ${title}`);
    console.log(`  Run dir  · ${runDir}`);
    console.log(`  Planner  · ${planner} · bank v${bank.bank_version} · pipeline v${PIPELINE_VERSION}`);
    if (warnings.length) {
      for (const w of warnings) console.log(`  ⚠ ${w}`);
    }
    if (comparison.match) {
      console.log(`  ✓ Compose match · RCS ${comparison.fresh_rcs} · ${(freshCompact.selected_acs || []).length} ACs`);
    } else {
      console.log(`  ✗ Compose drift detected`);
      for (const issue of comparison.issues) {
        console.log(`    · ${issue.field}: ${JSON.stringify(issue.stored)} → ${JSON.stringify(issue.fresh)}`);
      }
      for (const slot of comparison.slotDiffs.slice(0, 10)) {
        console.log(`    · slot #${slot.slot}: ${slot.stored} → ${slot.fresh}`);
      }
      if (comparison.slotDiffs.length > 10) {
        console.log(`    · … ${comparison.slotDiffs.length - 10} more slot diffs`);
      }
    }
    if (compileResult) {
      console.log(`  Tex replay · ${compileResult.replayDir}`);
    }
    console.log(`  Report   · ${reportPath}\n`);
  }

  if (!comparison.match && !force) process.exit(1);
  return report;
}

function printManifestList() {
  const manifests = listManifests({ limit: 25 });
  if (!manifests.length) {
    console.log("No manifests found under ARTIFACTS_ROOT.");
    return;
  }
  console.log("\nRecent compile manifests:\n");
  for (const m of manifests) {
    const job = m.job || {};
    console.log(`  ${m.fingerprint.slice(0, 16)}…  ${m.status || "?"}  ${job.company || "—"}  ${job.title || ""}`);
    console.log(`    updated ${m.updated_at || "—"}  RCS dir ${m.run_dir ? "✓" : "✗"}`);
  }
  console.log("");
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.list) {
    printManifestList();
    return;
  }

  if (!opts.fingerprint) {
    console.error(`
Usage:
  npm run ac:replay -- <fingerprint|prefix>
  npm run ac:replay -- --list
  npm run ac:replay -- <fp> --compile
  npm run ac:replay -- <fp> --json
  npm run ac:replay -- <fp> --force   # exit 0 even on drift

Examples:
  npm run ac:replay -- a3f9c2...
  npm run ac:replay -- --list
`);
    process.exit(1);
  }

  const resolved = resolveFingerprint(opts.fingerprint);
  if (!resolved) {
    console.error(`No manifest for fingerprint prefix: ${opts.fingerprint}`);
    console.error("Try: npm run ac:replay -- --list");
    process.exit(1);
  }

  await replayFingerprint(resolved, opts);
}

main().catch((e) => {
  if (e.matches) {
    console.error(e.message);
    for (const m of e.matches) console.error(`  ${m}`);
  } else {
    console.error(e.message || e);
  }
  process.exit(1);
});
