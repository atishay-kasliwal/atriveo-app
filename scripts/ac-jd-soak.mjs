#!/usr/bin/env node
/**
 * Paste JD → outcome soak test — no crashes, three clean outcome classes.
 * Usage: npm run ac:jd-soak
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessJdGate } from "./ac-jd-gate.mjs";
import { generateResume } from "./ac-pipeline.mjs";
import { buildComposeExplain } from "./ac-compose-explain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAD = " Additional engineering context: Python microservices, APIs, CI/CD, production systems, code review.";

const FIXTURES = [
  {
    id: "valid-ai",
    expect: "compose",
    jd: `OpenAI — AI Engineer. Build production LLM systems with Python, FastAPI, LangChain, RAG, multi-agent workflows, AWS, Kafka.${PAD.repeat(8)}`,
  },
  {
    id: "valid-backend",
    expect: "compose",
    jd: `Stripe — Backend Engineer. Distributed systems, Python, Java, Kafka, PostgreSQL, microservices, on-call.${PAD.repeat(8)}`,
  },
  {
    id: "valid-fullstack",
    expect: "compose",
    jd: `Notion — Full Stack Engineer. React, TypeScript, Node.js, PostgreSQL, AWS, product engineering.${PAD.repeat(7)}`,
  },
  {
    id: "borderline-short",
    expect: ["borderline", "compose"],
    jd: `Software Engineer at a startup. Python backend APIs, some AWS deployment, general engineering work.${PAD.repeat(3)}`,
  },
  {
    id: "unsupported-rn",
    expect: "unsupported",
    jd: `Registered Nurse Residency at Cleveland Clinic. Patient care, clinical rounds, nursing documentation, hospital floor supervision.${PAD.repeat(2)}`,
  },
  {
    id: "unsupported-too-short",
    expect: "unsupported",
    jd: "Hiring software engineers.",
  },
  {
    id: "blocked-sponsorship",
    expect: "blocked",
    jd: `Senior Software Engineer — Python, AWS. We cannot sponsor work visas. US citizens only.${PAD.repeat(6)}`,
  },
  {
    id: "valid-data",
    expect: "compose",
    jd: `Databricks — Data Engineer. Spark, Kafka, ETL pipelines, Python, warehouse loads, streaming.${PAD.repeat(7)}`,
  },
  {
    id: "valid-infra",
    expect: ["compose", "borderline"],
    jd: `Cloudflare — Platform Engineer. Kubernetes, Terraform, distributed systems, Go, Python, AWS, observability, SRE, production.${PAD.repeat(8)}`,
  },
  {
    id: "borderline-vague",
    expect: ["borderline", "compose", "unsupported"],
    jd: `Technology role at a growing company. Work with teams, solve problems, learn quickly.${" ".repeat(180)}`,
  },
];

function classify(gate, pipeline) {
  if (gate.outcome === "blocked") return "blocked";
  if (!gate.can_compose || pipeline?.unsupported_jd) return "unsupported";
  if (gate.outcome === "borderline") return "borderline";
  return "compose";
}

function main() {
  const outDir = path.join(ROOT, "output", "jd-soak", new Date().toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });

  let fail = 0;
  const results = [];

  for (const fx of FIXTURES) {
    let threw = false;
    let gate;
    let pipeline;
    let actual;
    let error = null;

    try {
      gate = assessJdGate(fx.jd, { title: "Software Engineer" });
      if (gate.can_compose) {
        pipeline = generateResume({
          jd: fx.jd,
          meta: { title: "Software Engineer", company: fx.id },
          jdGate: gate,
        });
      }
      actual = classify(gate, pipeline);
    } catch (e) {
      threw = true;
      error = String(e.message || e);
      actual = "crash";
    }

    const expected = Array.isArray(fx.expect) ? fx.expect : [fx.expect];
    const ok = !threw && expected.includes(actual);
    if (!ok) fail += 1;

    const explain = pipeline ? buildComposeExplain(pipeline, gate) : { outcome: actual, jd_gate: gate };

    const row = {
      id: fx.id,
      ok,
      threw,
      expected: fx.expect,
      actual,
      error,
      explain_summary: explain.engineering_identity,
      global_score: explain.global_score,
    };
    results.push(row);
    fs.writeFileSync(path.join(outDir, `${fx.id}.json`), `${JSON.stringify({ gate, explain, pipeline: pipeline ? { unsupported_jd: pipeline.unsupported_jd } : null }, null, 2)}\n`);

    const mark = ok ? "✓" : "✗";
    console.log(`${mark} ${fx.id} · expected ${JSON.stringify(fx.expect)} · got ${actual}${threw ? ` · CRASH: ${error}` : ""}`);
  }

  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify({ at: new Date().toISOString(), fail, total: FIXTURES.length, results }, null, 2)}\n`);

  if (fail) {
    console.log(`\n${fail}/${FIXTURES.length} soak cases failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} JD soak cases passed · artifacts → ${outDir}`);
}

main();
