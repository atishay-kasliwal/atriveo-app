#!/usr/bin/env node
/**
 * Production PDF — unified pipeline → Tectonic.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateResume, compactPipelineResult, PIPELINE_STEPS } from "./ac-pipeline.mjs";
import { buildInterviewPacket, formatInterviewPacketMarkdown } from "./ac-interview.mjs";
import { ingestComposeRun } from "./ac-learning.mjs";
import { ollamaHealth } from "./ac-ollama.mjs";
import { runAnalystPipeline } from "./ac-analyst.mjs";
import { formatGateReport } from "./ac-pdf-gate.mjs";
import { buildResumeSnapshot, persistSnapshot } from "./ac-snapshot.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_ROOT = process.env.AC_PDF_OUT || path.join(ROOT, "output", "ac-resumes");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((v) => v.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function pdfPageCount(pdfPath) {
  try {
    const latin = fs.readFileSync(pdfPath).toString("latin1");
    const pages = (latin.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    return pages > 0 ? pages : null;
  } catch {
    return null;
  }
}

function compileTex(dir) {
  const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) {
    return { ok: false, err: (r.stderr || r.stdout || "").trim().slice(-500) };
  }
  const pdf = path.join(dir, "resume.pdf");
  const named = path.join(dir, "Atishay Kasliwal.pdf");
  if (fs.existsSync(pdf)) fs.copyFileSync(pdf, named);
  return { ok: true, pdf: fs.existsSync(named) ? named : pdf, pages: pdfPageCount(pdf) };
}

function slugify(text) {
  return String(text || "role").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

async function main() {
  const jdPath = arg("jd-text");
  if (!jdPath) {
    console.error("Required: --jd-text <file>");
    process.exit(1);
  }

  const jd = fs.readFileSync(path.resolve(jdPath), "utf8").trim();
  const planner = arg("planner", "v2");
  const company = arg("company", "target");
  const title = arg("title");
  const learn = !hasFlag("no-learn");
  const critique = hasFlag("critique");
  const interview = hasFlag("interview");

  const pipeline = generateResume({
    jd,
    planner,
    meta: { company, title },
    forceBorderline: hasFlag("force-borderline"),
    strictJdGate: hasFlag("strict-jd"),
  });

  if (pipeline.unsupported_jd || !pipeline.result) {
    const msg = pipeline.jd_gate?.user_message
      || pipeline.jd_gate?.message
      || pipeline.jd_relevance?.message
      || "Unsupported job description";
    console.error(msg);
    process.exit(2);
  }

  const {
    composition, compact, skills, headerTitle, tex, oracle, gate, contribution,
    contribution_pruned, resume_confidence_score, variant_id,
  } = pipeline.result;

  const dir = path.join(OUT_ROOT, `${new Date().toISOString().slice(0, 10)}`, slugify(company));
  fs.mkdirSync(dir, { recursive: true });

  const withJd = tex.replace(/\\end\{document\}/, `\\end{document}\n\n% ==== JD ====\n% ${jd.replace(/\n/g, "\n% ").slice(0, 4000)}`);
  fs.writeFileSync(path.join(dir, "resume.tex"), withJd);

  const compiled = compileTex(dir);
  if (!compiled.ok) {
    console.error(`Tectonic failed: ${compiled.err}`);
    process.exit(1);
  }

  const hm = composition.quality?.hiring_manager_test || null;
  const snapshot = buildResumeSnapshot({
    company, planner, composition: compact, bank: pipeline.bank, oracle, gate, jd, tex: withJd, outputDir: dir,
  });
  snapshot.resume_confidence_score = resume_confidence_score;
  snapshot.beam_winner = variant_id;
  snapshot.pipeline_version = pipeline.pipeline_version;

  const report = {
    ...compactPipelineResult(pipeline),
    snapshot,
    dir,
    pdf: compiled.pdf,
    pages: compiled.pages,
    oracle_score: oracle.oracle_score,
    pdf_gate: gate,
    pipeline_steps: PIPELINE_STEPS,
    contribution_pruned,
  };

  fs.writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  persistSnapshot(snapshot, ROOT);

  if (critique && await ollamaHealth()) {
    const analyst = await runAnalystPipeline({ jd, composition: { ...compact, skills }, plan: composition.plan, bank: pipeline.bank, tasks: ["readability", "weakest"] });
    fs.writeFileSync(path.join(dir, "critique.json"), `${JSON.stringify(analyst, null, 2)}\n`);
  }
  if (interview) {
    fs.writeFileSync(path.join(dir, "interview-packet.md"), `${formatInterviewPacketMarkdown(buildInterviewPacket(composition, pipeline.bank))}\n`);
  }
  if (learn) {
    ingestComposeRun({ composition: compact, job: { company, title: headerTitle }, source: "ac_pdf", plannerVersion: planner });
  }

  console.log(`Pipeline v${pipeline.pipeline_version} | bank v${pipeline.bank.bank_version}`);
  console.log(`Resume ID: ${snapshot.resume_id}`);
  console.log(`RCS: ${resume_confidence_score} (winner: ${variant_id})`);
  if (pipeline.beam?.candidates?.length) {
    for (const c of pipeline.beam.candidates) console.log(`  candidate ${c.variant_id}: ${c.resume_confidence_score}`);
  }
  if (contribution_pruned?.length) console.log(`Contribution pruned: ${contribution_pruned.join(", ")}`);
  if (hm) {
    console.log(`Hiring manager: ${hm.would_interview ? "YES" : "NO"}`);
    if (hm.because?.length) console.log(`  because: ${hm.because.join("; ")}`);
    if (hm.concerns?.length) console.log(`  concerns: ${hm.concerns.join("; ")}`);
  }
  if (contribution?.contributions?.length) {
    console.log("AC contribution:");
    for (const row of contribution.contributions.slice(0, 10)) {
      console.log(`  ${row.ac_id}: ${row.contribution >= 0 ? "+" : ""}${row.contribution}${row.verdict === "omit_candidate" ? " (omit)" : ""}`);
    }
  }
  console.log(formatGateReport({ ...gate, candidates: pipeline.beam?.candidates }));
  console.log(`PDF: ${compiled.pdf} (${compiled.pages ?? "?"} pages)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
