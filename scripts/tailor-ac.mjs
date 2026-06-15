// AC pipeline path for tailor-server — evidence bank + beam search, no bullet rewrites.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  generateResume,
  compactPipelineResult,
  PIPELINE_VERSION,
  PIPELINE_STEPS,
} from "./ac-pipeline.mjs";
import { buildResumeSnapshot, persistSnapshot } from "./ac-snapshot.mjs";
import { ingestComposeRun } from "./ac-learning.mjs";
import { assessJdGate, writeJdGateFile, MIN_JD_IDEAL } from "./ac-jd-gate.mjs";
import { buildComposeExplain, formatExplainLogLines } from "./ac-compose-explain.mjs";
import { loadBank } from "./ac-bank.mjs";
import {
  createArtifactRun,
  advanceArtifactStage,
  finalizeArtifactRun,
  resolveCachedCompile,
  recordCacheReuse,
  materializeCachedRun,
} from "./ac-artifact-store.mjs";
// Gemma critique disabled for hourly runs (~8 min/job). Re-enable with TAILOR_CRITIQUE=1.
// import { runAnalystPipeline } from "./ac-analyst.mjs";
// import { ollamaHealth, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "./ac-ollama.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_FULL_JD_CHARS = MIN_JD_IDEAL;
// const REVIEW_TASKS = ["readability", "weakest", "verify"];

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function slug(s, max = 40) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "untitled";
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

function compileTex(dir, onLog) {
  const t0 = Date.now();
  onLog?.("step", `Running: tectonic resume.tex (cwd: ${dir})`);
  const r = spawnSync("tectonic", ["resume.tex"], { cwd: dir, encoding: "utf8" });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    const tail = err.slice(-500);
    onLog?.("error", `Tectonic failed after ${elapsed}s (exit ${r.status})`);
    for (const line of tail.split("\n").slice(-6).filter(Boolean)) onLog?.("error", `  ${line.slice(0, 200)}`);
    return { ok: false, err: tail.slice(-400) };
  }
  onLog?.("result", `Tectonic succeeded in ${elapsed}s`);
  const pdf = path.join(dir, "resume.pdf");
  const named = path.join(dir, "Atishay Kasliwal.pdf");
  if (fs.existsSync(pdf)) {
    fs.renameSync(pdf, named);
    onLog?.("result", "Renamed resume.pdf → Atishay Kasliwal.pdf");
  } else {
    onLog?.("warn", "resume.pdf not found after compile — check tectonic output");
  }
  const pages = pdfPageCount(named);
  if (pages != null) {
    if (pages > 1) onLog?.("warn", `PDF is ${pages} pages — RULEBOOK requires ONE page`);
    else onLog?.("result", "Page check passed · 1 page");
  }
  return { ok: true, pdf: named, pages };
}

export function readAtsFromDir(dir) {
  const reportPath = path.join(dir, "report.json");
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const before = report.oracle?.oracle_score ?? report.oracle_score;
      const after = report.resume_confidence_score;
      if (before != null && after != null) return `${Math.round(before)}→${Math.round(after)}`;
      if (after != null) return `RCS ${Math.round(after)}`;
    } catch { /* fall through */ }
  }
  const optPath = path.join(dir, "optimizer.json");
  if (fs.existsSync(optPath)) {
    try {
      const opt = JSON.parse(fs.readFileSync(optPath, "utf8"));
      if (opt.ats_before != null && opt.ats_after != null) return `${opt.ats_before}→${opt.ats_after}`;
    } catch { /* ignore */ }
  }
  return null;
}

function formatAts(oracleScore, rcs) {
  const before = oracleScore != null ? Math.round(oracleScore) : null;
  const after = rcs != null ? Math.round(rcs) : null;
  if (before != null && after != null) return `${before}→${after}`;
  if (after != null) return `RCS ${after}`;
  return null;
}

// function logGemmaReview(onLog, critique) {
//   const read = critique?.tasks?.readability?.parsed;
//   if (read) {
//     onLog?.("result", `Gemma readability · ${read.score_1_to_10}/10`);
//     if (read.summary) onLog?.("think", read.summary);
//     for (const flag of (read.flags || []).slice(0, 3)) {
//       onLog?.("think", `  flag · ${flag.type}: ${flag.detail}`);
//     }
//   }
//   const weak = critique?.tasks?.weakest?.parsed;
//   if (weak) {
//     onLog?.("think", `Weakest bullet · ${weak.weakest_bullet_id}: ${weak.why}`);
//     if (weak.replacement_ac_id) {
//       onLog?.("think", `  swap candidate · ${weak.replacement_ac_id} (${weak.replacement_reason})`);
//     }
//   }
//   if (critique?.errors && Object.keys(critique.errors).length) {
//     onLog?.("warn", `Gemma partial errors · ${Object.keys(critique.errors).join(", ")}`);
//   }
// }

export async function tailorOneAc(job, seq, dateDir, ctx, {
  planner = "v2",
  learn = false,
  forceRecompile = false,
  // critique = process.env.TAILOR_CRITIQUE === "1",
  // reviewModel = process.env.TAILOR_REVIEW_MODEL?.trim() || OLLAMA_DEFAULT_MODEL,
} = {}) {
  const { sendPhase, log: onLog } = ctx;
  const company = job.company || "unknown";
  const role = job.title || "role";
  const folder = `${String(seq).padStart(2, "0")}-${slug(company, 24)}-${slug(role, 30)}`;
  const dir = path.join(dateDir, folder);

  const result = { folder, company, role, dir, status: "ok" };

  onLog?.("step", `━━━ Job ${seq} · ${company} · ${role} ━━━`);
  onLog?.("step", "Creating output directory…");
  fs.mkdirSync(dir, { recursive: true });
  onLog?.("result", `Directory ready · ${dir}`);

  const jd = (job.jd || "").trim();
  const jdLen = jd.length;
  onLog?.("step", `JD loaded · ${jdLen.toLocaleString()} chars`);

  const jdGate = assessJdGate(jd, {
    title: role,
    forceBorderline: job.force_borderline === true,
    strict: job.strict_jd_gate === true,
  });
  writeJdGateFile(dir, jdGate);
  result.jd_gate = jdGate;

  if (jdGate.outcome === "blocked") {
    onLog?.("warn", `No-Go · ${jdGate.message}`);
    fs.writeFileSync(path.join(dir, "jd.txt"), jd);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
      company, role, url: job.job_url, tailored_at: new Date().toISOString(),
      pipeline: "ac", jd_gate: jdGate,
    }, null, 2));
    fs.writeFileSync(path.join(dir, "eligibility.json"), JSON.stringify(jdGate.eligibility, null, 2));
    result.status = "no-go";
    result.error = jdGate.message;
    sendPhase("done", result);
    return result;
  }

  if (!jdGate.can_compose) {
    onLog?.("warn", `Unsupported JD · ${jdGate.message}`);
    fs.writeFileSync(path.join(dir, "jd.txt"), jd);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
      company, role, url: job.job_url, tailored_at: new Date().toISOString(),
      pipeline: "ac", jd_gate: jdGate,
    }, null, 2));
    result.status = "unsupported-jd";
    result.error = jdGate.user_message || jdGate.message;
    sendPhase("done", result);
    return result;
  }

  for (const w of jdGate.warnings || []) onLog?.("warn", w);
  if (jdGate.outcome === "borderline") {
    onLog?.("warn", `Borderline JD · ${jdGate.message} — composing with warning`);
    result.borderline = true;
  }

  const eligibility = jdGate.eligibility;

  if (job.job_url) onLog?.("think", `Source URL · ${job.job_url}`);
  if (job.score_pct != null) onLog?.("think", `Feed match score · ${job.score_pct}%`);

  onLog?.("step", "Writing jd.txt…");
  fs.writeFileSync(path.join(dir, "jd.txt"), jd);
  onLog?.("result", "jd.txt saved");

  const meta = {
    company,
    role,
    url: job.job_url,
    score_pct: job.score_pct,
    tailored_at: new Date().toISOString(),
    pipeline: "ac",
    pipeline_version: PIPELINE_VERSION,
    planner,
    eligibility,
  };
  onLog?.("step", "Writing meta.json…");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  onLog?.("result", "meta.json saved");

  const forceCompile = forceRecompile || job.force_recompile === true;
  let artifactCtx = null;
  try {
    const bankPreview = loadBank();
    const cached = resolveCachedCompile({
      jd,
      planner,
      bankVersion: bankPreview.bank_version,
      force: forceCompile,
    });
    if (cached.hit) {
      result.fingerprint = cached.fingerprint;
      result.cached = true;
      const materialized = materializeCachedRun(cached, dir, {
        company,
        role,
        jobUrl: job.job_url,
        score_pct: job.score_pct,
      });
      result.pdfPath = materialized.pdfPath;
      result.dir = materialized.dir;
      result.pdf = true;
      result.status = "ok";
      recordCacheReuse(cached.fingerprint, {
        job_url: job.job_url,
        company,
        title: role,
        materialized_dir: dir,
      });
      onLog?.("result", `Cache hit · skipped compose · fp ${cached.fingerprint.slice(0, 16)}…`);
      onLog?.("think", `Reused PDF · ${cached.pdfPath}`);
      sendPhase("done", result);
      return result;
    }

    artifactCtx = createArtifactRun({
      jd,
      planner,
      bankVersion: bankPreview.bank_version,
      job: { company, title: role, job_url: job.job_url, score_pct: job.score_pct },
      runDir: dir,
      force: forceCompile,
    });
    result.fingerprint = artifactCtx.fingerprint;
    onLog?.("think", `Fingerprint · ${artifactCtx.fingerprint.slice(0, 16)}…`);
  } catch (e) {
    onLog?.("warn", `Artifact manifest skipped · ${String(e.message || e)}`);
  }

  try {
    onLog?.("step", "Phase 1/3 · Compose — AC pipeline (beam + RCS, rulebook slots)");
    sendPhase("analyzing");
    onLog?.("think", `Planner · ${planner} · full slots · no delete-test prune`);

    const pipeline = generateResume({
      jd,
      planner,
      meta: { company, title: role },
      forceBorderline: job.force_borderline === true,
      strictJdGate: job.strict_jd_gate === true,
      jdGate,
    });

    if (pipeline.unsupported_jd || !pipeline.result) {
      const msg = pipeline.jd_gate?.user_message
        || pipeline.jd_gate?.message
        || pipeline.jd_relevance?.message
        || "Unsupported job description — not an engineering role.";
      onLog?.("warn", msg);
      result.status = "unsupported-jd";
      result.error = msg;
      if (artifactCtx) finalizeArtifactRun(artifactCtx, { success: false, runDir: dir, error: msg });
      sendPhase("done", result);
      return result;
    }

    const {
      composition, compact, skills, headerTitle, tex, oracle, gate, contribution,
      contribution_pruned, resume_confidence_score, variant_id, rulebook,
    } = pipeline.result;

    onLog?.("result", `Pipeline v${pipeline.pipeline_version} · bank v${pipeline.bank.bank_version}`);
    onLog?.("result", `RCS ${resume_confidence_score}${variant_id ? ` · winner ${variant_id}` : ""}`);
    onLog?.("result", `Bullets · ${rulebook?.total ?? "?"} total (rulebook target ${rulebook?.expected_total ?? 14})`);
    if (rulebook?.gaps?.length) {
      onLog?.("warn", `Rulebook gaps · ${rulebook.gaps.join("; ")}`);
    } else {
      onLog?.("result", "Rulebook structure · complete");
    }

    if (pipeline.beam?.candidates?.length) {
      for (const c of pipeline.beam.candidates) {
        onLog?.("think", `  candidate ${c.variant_id}: RCS ${c.resume_confidence_score}`);
      }
    }
    if (composition.narrative?.thesis) onLog?.("think", `Thesis · ${composition.narrative.thesis}`);
    if (contribution_pruned?.length) onLog?.("think", `Contribution pruned · ${contribution_pruned.join(", ")}`);

    const hm = composition.quality?.hiring_manager_test;
    if (hm) {
      onLog?.("result", `Hiring manager · ${hm.would_interview ? "YES" : "NO"}`);
      if (hm.because?.length) onLog?.("think", `  because · ${hm.because.join("; ")}`);
      if (hm.concerns?.length) onLog?.("think", `  concerns · ${hm.concerns.join("; ")}`);
    }

    if (!gate.invariant?.passes) {
      onLog?.("warn", `INVARIANT check failed · ${(gate.invariant?.violations || []).join("; ") || "see report.json"}`);
    } else {
      onLog?.("result", "INVARIANT passed — evidence-only bullets");
    }

    result.ats = formatAts(oracle?.oracle_score, resume_confidence_score);
    result.headerTitle = headerTitle || "";

    if (artifactCtx) {
      advanceArtifactStage(artifactCtx, "COMPOSED", {
        rcs: resume_confidence_score,
        variant_id,
        bank_version: pipeline.bank.bank_version,
      });
      advanceArtifactStage(artifactCtx, "OPTIMIZED", {
        invariant_pass: gate.invariant?.passes ?? null,
      });
    }

    onLog?.("step", "Phase 2/3 · Assemble — writing resume.tex");
    sendPhase("assembling");
    const withJd = tex.replace(
      /\\end\{document\}/,
      `\\end{document}\n\n% ==== JD: ${company} — ${role} ====\n% ${jd.replace(/\n/g, "\n% ").slice(0, 4000)}`,
    );
    fs.writeFileSync(path.join(dir, "resume.tex"), withJd);
    onLog?.("result", `resume.tex saved · ${withJd.length.toLocaleString()} chars`);
    if (artifactCtx) advanceArtifactStage(artifactCtx, "TEX", { tex_chars: withJd.length });

    const snapshot = buildResumeSnapshot({
      company,
      planner,
      composition: compact,
      bank: pipeline.bank,
      oracle,
      gate,
      jd,
      tex: withJd,
      outputDir: dir,
    });
    snapshot.resume_confidence_score = resume_confidence_score;
    snapshot.beam_winner = variant_id;
    snapshot.pipeline_version = pipeline.pipeline_version;

    const explain = buildComposeExplain(pipeline, pipeline.jd_gate || jdGate);
    result.explain = explain;
    result.borderline = explain.borderline || result.borderline;

    for (const line of formatExplainLogLines(explain)) {
      const [kind, ...rest] = line.split(":");
      const text = rest.join(":");
      onLog?.(kind === "warn" ? "warn" : kind === "think" ? "think" : "result", text);
    }

    const report = {
      ...compactPipelineResult(pipeline),
      snapshot,
      dir,
      pipeline_steps: PIPELINE_STEPS,
      contribution_pruned,
      ac_contribution: contribution,
      rulebook,
      eligibility,
      jd_gate: pipeline.jd_gate || jdGate,
      borderline_jd: pipeline.borderline_jd || jdGate.outcome === "borderline",
      explain,
    };

    fs.writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "explain.json"), `${JSON.stringify(explain, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify({
      pipeline: "ac",
      ats_before: oracle?.oracle_score != null ? Math.round(oracle.oracle_score) : null,
      ats_after: resume_confidence_score != null ? Math.round(resume_confidence_score) : null,
      resume_confidence_score,
      thesis: composition.narrative?.thesis,
      hiring_manager_test: hm,
      variant_id,
      rulebook,
      explain,
    }, null, 2));

    persistSnapshot(snapshot, ROOT);
    if (learn) {
      ingestComposeRun({
        composition: compact,
        job: { company, title: headerTitle },
        source: "tailor_ac",
        plannerVersion: planner,
      });
    }

    onLog?.("step", "Phase 3/3 · Compile — Tectonic PDF");
    sendPhase("compiling");
    const c = compileTex(dir, onLog);
    result.pdf = c.ok;
    result.pdfPath = c.ok ? c.pdf : "";
    result.pages = c.pages ?? null;
    if (artifactCtx && c.ok) advanceArtifactStage(artifactCtx, "PDF", { pages: c.pages ?? null });
    if (!c.ok) {
      result.status = "tex-failed";
      result.error = c.err;
      if (artifactCtx) finalizeArtifactRun(artifactCtx, { success: false, runDir: dir, error: c.err });
      sendPhase("done", result);
      return result;
    }

    report.pdf = c.pdf;
    report.pages = c.pages;
    fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    result.overflow = c.pages != null && c.pages > 1;

    // Gemma critique — disabled (~8 min/job). Opt in: TAILOR_CRITIQUE=1 + uncomment block below.
    // if (critique && await ollamaHealth()) {
    //   onLog?.("step", `Phase 4/4 · Gemma review (${reviewModel}) — critique only, no rewrites`);
    //   sendPhase("reviewing");
    //   const critiqueOut = await runAnalystPipeline({
    //     jd,
    //     composition,
    //     plan: composition.plan,
    //     bank: pipeline.bank,
    //     tasks: REVIEW_TASKS,
    //     model: reviewModel,
    //     onProgress: (task, phase) => {
    //       if (phase === "start") onLog?.("think", `Gemma · ${task}…`);
    //     },
    //   });
    //   report.gemma_review = critiqueOut;
    //   fs.writeFileSync(path.join(dir, "critique.json"), `${JSON.stringify(critiqueOut, null, 2)}\n`);
    //   fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    //   logGemmaReview(onLog, critiqueOut);
    //   onLog?.("result", "Gemma review saved · critique.json");
    // } else if (critique) {
    //   onLog?.("warn", "Gemma review skipped — Ollama not reachable (run: ollama serve)");
    // }

    onLog?.("result", `✓ Complete · ${result.ats || "RCS"}${result.overflow ? ` · ⚠ ${c.pages} pages` : " · 1 page"} · ${c.pdf}`);
    if (artifactCtx) {
      finalizeArtifactRun(artifactCtx, { success: true, pdfPath: c.pdf, runDir: dir });
    }
  } catch (e) {
    result.status = "ai-failed";
    result.error = String(e.message || e);
    onLog?.("error", result.error);
    if (artifactCtx) finalizeArtifactRun(artifactCtx, { success: false, runDir: dir, error: result.error });
  }

  sendPhase("done", result);
  return result;
}
