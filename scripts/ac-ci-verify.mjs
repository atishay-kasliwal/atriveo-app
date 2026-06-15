#!/usr/bin/env node
/**
 * CI compiler verification — routing golden, JD soak, one PDF compile.
 *
 * Usage:
 *   npm run ac:ci
 *   node scripts/ac-ci-verify.mjs --skip-pdf
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assessJdGate } from "./ac-jd-gate.mjs";
import { generateResume } from "./ac-pipeline.mjs";
import { assertPdfMagic, pdfPageCount } from "./ac-pdf-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAD = " Additional engineering context: Python microservices, APIs, CI/CD, production systems, code review.";

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function runStep(label, scriptPath, args = []) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

function verifyPdfCompile() {
  console.log("\n── PDF compile (Tectonic) ──");

  const tectonic = spawnSync("tectonic", ["--version"], { encoding: "utf8" });
  if (tectonic.status !== 0) {
    throw new Error("tectonic not found — install Tectonic or pass --skip-pdf");
  }
  console.log(`Tectonic · ${(tectonic.stdout || tectonic.stderr || "").trim().split("\n")[0]}`);

  const jd = `OpenAI — AI Engineer. Build production LLM systems with Python, FastAPI, LangChain, RAG, multi-agent workflows, AWS, Kafka.${PAD.repeat(8)}`;
  const gate = assessJdGate(jd, { title: "AI Engineer" });
  if (!gate.can_compose) {
    throw new Error(`CI fixture JD blocked: ${gate.message || gate.outcome}`);
  }

  const pipeline = generateResume({
    jd,
    meta: { company: "ci-openai", title: "AI Engineer" },
    jdGate: gate,
  });

  if (!pipeline.result?.tex) {
    throw new Error("Pipeline did not produce LaTeX");
  }

  const outDir = path.join(ROOT, "output", "ci-verify", new Date().toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const texPath = path.join(outDir, "resume.tex");
  fs.writeFileSync(texPath, pipeline.result.tex);

  const compile = spawnSync("tectonic", ["resume.tex"], { cwd: outDir, encoding: "utf8" });
  if (compile.status !== 0) {
    const tail = (compile.stderr || compile.stdout || "").trim().slice(-800);
    throw new Error(`Tectonic failed:\n${tail}`);
  }

  const pdfPath = path.join(outDir, "resume.pdf");
  if (!fs.existsSync(pdfPath)) {
    throw new Error("resume.pdf missing after Tectonic");
  }

  assertPdfMagic(pdfPath);

  const pages = pdfPageCount(pdfPath);
  const sizeKb = Math.round(fs.statSync(pdfPath).size / 1024);
  if (pages !== 1) {
    throw new Error(`Expected 1-page PDF, got ${pages ?? "unknown"} pages`);
  }

  console.log(`✓ PDF · ${pages} page · ${sizeKb} KB · ${pdfPath}`);
  console.log(`  RCS ${pipeline.result.resume_confidence_score} · bank v${pipeline.bank.bank_version}`);
}

function main() {
  const skipPdf = hasFlag("skip-pdf");

  try {
    runStep("Routing golden", path.join(ROOT, "scripts/ac-routing-golden.mjs"));
    runStep("JD soak", path.join(ROOT, "scripts/ac-jd-soak.mjs"));
    if (!skipPdf) verifyPdfCompile();
    else console.log("\n── PDF compile skipped (--skip-pdf) ──");

    console.log("\n✓ Compiler CI verification passed.");
  } catch (e) {
    console.error(`\n✗ Compiler CI failed: ${e.message || e}`);
    process.exit(1);
  }
}

main();
