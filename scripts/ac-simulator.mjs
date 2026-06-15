#!/usr/bin/env node
/**
 * Offline planner simulator — evaluate planner versions on historical JDs in minutes.
 *
 * Usage:
 *   npm run ac:simulate -- --planner v1 --count 200
 *   npm run ac:simulate -- --planner v2 --jobs data/ac-simulation/adversarial-jds.json
 *   npm run ac:simulate -- --compare v1,v2,experimental --count 100
 *   npm run ac:simulate -- --planner experimental --adversarial
 */
import fs from "node:fs";
import path from "node:path";
import { loadBank } from "./ac-bank.mjs";
import { listPlanners, runPlanner, loadPlannerConfig } from "./ac-planner.mjs";
import { scoreOracle } from "./ac-oracle.mjs";
import { analyzeRegret, regretEvents } from "./ac-regret.mjs";
import { appendEvents } from "./ac-learning.mjs";
import { createEvent } from "./ac-events.mjs";
import { replayAll } from "./ac-replay.mjs";
import { saveCaseMemory } from "./ac-case-memory.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEEK_JOBS = path.join(ROOT, "public", "week_jobs.json");
const JD_DIR = path.join(ROOT, "public", "job_descriptions");
const ADVERSARIAL = path.join(ROOT, "data", "ac-simulation", "adversarial-jds.json");
const OUT_DIR = path.join(ROOT, "data", "ac-simulation", "runs");

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

function bucketForUrl(url) {
  let h = 0;
  for (let i = 0; i < url.length; i += 1) h = ((h * 31) + url.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 2);
}

function loadHistoricalJobs(count, minChars = 400) {
  const jobs = JSON.parse(fs.readFileSync(WEEK_JOBS, "utf8"));
  const cache = new Map();
  const out = [];
  for (const job of jobs) {
    if (!job?.job_url) continue;
    const bucket = bucketForUrl(job.job_url);
    if (!cache.has(bucket)) {
      const f = path.join(JD_DIR, `${bucket}.json`);
      cache.set(bucket, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {});
    }
    const jd = String(cache.get(bucket)[job.job_url] || job.summary || "").trim();
    if (jd.length < minChars) continue;
    out.push({ id: job.job_url, company: job.company, title: job.title, jd });
    if (out.length >= count) break;
  }
  return out;
}

function loadJobFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  if (Array.isArray(raw)) {
    return raw.map((row, i) => ({
      id: row.id || `job_${i}`,
      company: row.company || null,
      title: row.title || null,
      jd: row.jd,
      expect: row.expect || null,
    }));
  }
  return [];
}

function compactComposition(result) {
  return {
    theme: result.theme,
    coverage: result.coverage,
    selection_trace: result.selection_trace,
    planner_config: result.planner_config,
    experience: result.experience.map((role) => ({
      role: role.role,
      bullets: role.bullets.map(({ ac, face }) => ({
        ac_id: ac.id, facet: face.facet, text: face.text,
      })),
    })),
    projects: result.projects.map((project) => ({
      role: project.role,
      bullets: project.bullets.map(({ ac, face }) => ({
        ac_id: ac.id, facet: face.facet, text: face.text,
      })),
    })),
  };
}

function evaluateAdversarial(composition, expect) {
  if (!expect) return { pass: null, notes: [] };
  const notes = [];
  const text = JSON.stringify(composition).toLowerCase();
  const unclaimable = composition.coverage?.unclaimable || [];
  let pass = true;

  for (const term of expect.should_be_unclaimable || []) {
    const inUnclaimable = unclaimable.some((k) => String(k).toLowerCase().includes(term.toLowerCase()));
    if (!inUnclaimable) { pass = false; notes.push(`expected unclaimable: ${term}`); }
  }

  for (const term of expect.should_not_force || []) {
    if (text.includes(term.toLowerCase())) {
      notes.push(`should not force: ${term}`);
      if (expect.fit === "low") pass = false;
    }
  }

  if (expect.max_ai_bullets != null) {
    const oracle = scoreOracle(composition);
    if (oracle.metrics.avg_ai_bullets > expect.max_ai_bullets) {
      pass = false;
      notes.push(`ai bullets ${oracle.metrics.avg_ai_bullets} > ${expect.max_ai_bullets}`);
    }
  }

  return { pass, notes };
}

function simulatePlanner(version, jobs, { emitEvents = false } = {}) {
  const bank = loadBank();
  const cfg = loadPlannerConfig(version);
  const agg = {
    planner: version,
    config: cfg.name,
    jobs: 0,
    oracle_sum: 0,
    ats_sum: 0,
    coverage_sum: 0,
    duplicate_stories: 0,
    ai_bullets_sum: 0,
    adversarial_pass: 0,
    adversarial_total: 0,
    regrets: [],
  };

  const events = [];

  for (const job of jobs) {
    const result = runPlanner(version, job.jd, bank, { company: job.company });
    const compact = compactComposition(result);
    const oracle = scoreOracle(compact);
    const regret = analyzeRegret(compact, bank, job.jd, version);

    agg.jobs += 1;
    agg.oracle_sum += oracle.oracle_score;
    agg.ats_sum += oracle.components.ats;
    agg.coverage_sum += oracle.components.ats;
    agg.duplicate_stories += oracle.metrics.duplicate_stories;
    agg.ai_bullets_sum += oracle.metrics.avg_ai_bullets;

    if (job.expect) {
      agg.adversarial_total += 1;
      const adv = evaluateAdversarial(compact, job.expect);
      if (adv.pass) agg.adversarial_pass += 1;
    }

    if (regret.regrets[0]) agg.regrets.push(regret.regrets[0]);

    if (emitEvents) {
      events.push(createEvent("simulation_run", {
        planner_version: version,
        job_id: job.id,
        company: job.company,
        title: job.title,
        oracle,
        selected_acs: regret.selected_acs,
      }, { source: "simulator", planner_version: version }));

      events.push(...regretEvents(regret, { planner_version: version }));
    }
  }

  if (emitEvents && events.length) {
    appendEvents(events);
    replayAll();
    saveCaseMemory();
  }

  const n = agg.jobs || 1;
  return {
    ...agg,
    avg_oracle: Number((agg.oracle_sum / n).toFixed(2)),
    avg_ats: Number((agg.ats_sum / n).toFixed(2)),
    avg_coverage: Number((agg.coverage_sum / n).toFixed(2)),
    avg_ai_bullets: Number((agg.ai_bullets_sum / n).toFixed(2)),
    duplicate_story_rate: Number((agg.duplicate_stories / n).toFixed(3)),
    top_regret: agg.regrets.sort((a, b) => b.estimated_oracle_gain - a.estimated_oracle_gain)[0] || null,
  };
}

function printComparison(rows) {
  console.log("\nPlanner Sandbox Comparison");
  console.log("─".repeat(72));
  const headers = ["Metric", ...rows.map((r) => r.planner)];
  console.log(headers.map((h) => String(h).padEnd(16)).join(""));
  const metrics = [
    ["Oracle", (r) => r.avg_oracle],
    ["ATS", (r) => r.avg_ats],
    ["Coverage", (r) => r.avg_coverage],
    ["Duplicate stories", (r) => r.duplicate_story_rate],
    ["Avg AI bullets", (r) => r.avg_ai_bullets],
    ["Adversarial pass", (r) => r.adversarial_total ? `${r.adversarial_pass}/${r.adversarial_total}` : "n/a"],
  ];
  for (const [label, fn] of metrics) {
    console.log([label, ...rows.map((r) => fn(r))].map((v) => String(v).padEnd(16)).join(""));
  }
}

function main() {
  const compare = arg("compare");
  const planner = arg("planner", "v1");
  const count = Number(arg("count", 100));
  const jobsFile = arg("jobs");
  const emit = hasFlag("emit");

  let jobs;
  if (hasFlag("adversarial")) {
    jobs = loadJobFile(ADVERSARIAL);
  } else if (jobsFile) {
    jobs = loadJobFile(jobsFile);
  } else {
    jobs = loadHistoricalJobs(count);
  }

  if (!jobs.length) {
    console.error("No jobs to simulate");
    process.exit(1);
  }

  const versions = compare ? compare.split(",").map((s) => s.trim()) : [planner];
  const available = listPlanners();
  for (const v of versions) {
    if (!available.includes(v)) {
      console.error(`Unknown planner ${v}. Available: ${available.join(", ")}`);
      process.exit(1);
    }
  }

  const results = versions.map((v) => simulatePlanner(v, jobs, { emitEvents: emit }));
  printComparison(results);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(OUT_DIR, `simulate-${stamp}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    job_count: jobs.length,
    adversarial: hasFlag("adversarial"),
    results,
  }, null, 2)}\n`);

  console.log(`\nWrote ${path.relative(ROOT, outFile)}`);
  if (results.length === 1 && results[0].top_regret) {
    console.log(`Top regret: ${results[0].top_regret.from_ac} -> ${results[0].top_regret.to_ac} (+${results[0].top_regret.estimated_oracle_gain} oracle)`);
  }
}

main();
