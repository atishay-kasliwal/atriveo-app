#!/usr/bin/env node
/**
 * Compose + review via unified pipeline (beam + RCS for v2+).
 */
import fs from "node:fs";
import path from "node:path";
import { generateResume, compactPipelineResult } from "./ac-pipeline.mjs";
import { ollamaHealth } from "./ac-ollama.mjs";
import { runAnalystPipeline } from "./ac-analyst.mjs";
import { ingestComposeRun } from "./ac-learning.mjs";
import { buildInterviewPacket, formatInterviewPacketMarkdown } from "./ac-interview.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const jdTextPath = arg("jd-text");
const jdBucketPath = arg("jd");
const jobUrl = arg("url");
const planner = arg("planner", "v2");
const model = arg("model", "gemma4:12b");
const outPath = path.resolve(arg("out", path.join(ROOT, "benchmarks", "ac-compose-review.json")));
const tasks = hasFlag("no-analyst")
  ? []
  : String(arg("tasks", "extract,verify,readability,weakest,librarian")).split(",").map((t) => t.trim()).filter(Boolean);
const learn = !hasFlag("no-learn");
const interview = hasFlag("interview");

function readJd() {
  if (jdTextPath) return fs.readFileSync(path.resolve(jdTextPath), "utf8").trim();
  if (jdBucketPath && jobUrl) {
    const bucket = JSON.parse(fs.readFileSync(path.resolve(jdBucketPath), "utf8"));
    const jd = String(bucket[jobUrl] || "").trim();
    if (!jd) throw new Error(`No JD found for url in ${jdBucketPath}`);
    return jd;
  }
  throw new Error("Provide --jd-text <file> or --jd <bucket.json> --url <job url>");
}

async function main() {
  const jd = readJd();
  const pipeline = generateResume({
    jd,
    planner,
    meta: { company: arg("company"), title: arg("title") },
    forceBorderline: hasFlag("force-borderline"),
    strictJdGate: hasFlag("strict-jd"),
  });

  if (pipeline.unsupported_jd || !pipeline.result) {
    const gate = pipeline.jd_gate;
    const report = {
      generated_at: new Date().toISOString(),
      unsupported_jd: true,
      jd_gate: gate,
      jd_relevance: pipeline.jd_relevance,
      message: gate?.user_message || gate?.message || "Unsupported JD",
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(report.message);
    process.exit(2);
  }

  const summary = compactPipelineResult(pipeline);
  const composition = pipeline.result.composition;

  const report = {
    generated_at: new Date().toISOString(),
    pipeline_version: pipeline.pipeline_version,
    pipeline_steps: pipeline.pipeline_steps,
    planner,
    beam: pipeline.beam,
    resume_confidence_score: summary.resume_confidence_score,
    model,
    composition: summary.composition,
    ac_contribution: summary.ac_contribution,
    contribution_pruned: summary.contribution_pruned,
    hiring_manager_test: summary.hiring_manager_test,
    score_components: summary.score_components,
    analyst: null,
  };

  if (tasks.length) {
    const healthy = await ollamaHealth();
    if (!healthy) {
      report.analyst = { skipped: true, reason: "Ollama unreachable" };
    } else {
      report.analyst = await runAnalystPipeline({
        jd, composition, plan: composition.plan, bank: pipeline.bank, tasks, model,
      });
    }
  }

  if (interview) {
    report.interview_packet = buildInterviewPacket(composition, pipeline.bank);
    const mdPath = outPath.replace(/\.json$/, "-interview.md");
    fs.writeFileSync(mdPath, `${formatInterviewPacketMarkdown(report.interview_packet)}\n`);
  }

  if (learn) {
    report.learning = ingestComposeRun({
      composition: summary.composition,
      analyst: report.analyst,
      job: { company: arg("company"), title: summary.header_title, job_url: jobUrl },
      source: "compose_review",
      plannerVersion: planner,
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`RCS: ${summary.resume_confidence_score} | planner: ${planner} | beam: ${pipeline.beam?.winner || "n/a"}`);
  console.log(`Written: ${outPath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
