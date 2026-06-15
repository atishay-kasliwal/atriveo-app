#!/usr/bin/env node
/**
 * Counterfactual replay: compare planner versions on the same JD corpus.
 *
 * Usage:
 *   AC_PLANNER_VERSION=v2 node scripts/ac-counterfactual.mjs --count 20
 */
import fs from "node:fs";
import path from "node:path";
import { compose, loadBank } from "./ac-bank.mjs";
import { ingestComposeRun, PLANNER_VERSION } from "./ac-learning.mjs";
import { loadProjection } from "./ac-replay.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEEK_JOBS = path.join(ROOT, "public", "week_jobs.json");
const JD_DIR = path.join(ROOT, "public", "job_descriptions");

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((v) => v.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function bucketForUrl(jobUrl) {
  let hash = 0;
  for (let i = 0; i < jobUrl.length; i += 1) hash = ((hash * 31) + jobUrl.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

function fullJd(jobUrl, cache) {
  const bucket = bucketForUrl(jobUrl);
  if (!cache.has(bucket)) {
    const file = path.join(JD_DIR, `${bucket}.json`);
    cache.set(bucket, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  }
  return String(cache.get(bucket)[jobUrl] || "").trim();
}

const count = Number(arg("count", 20));
const plannerVersion = process.env.AC_PLANNER_VERSION || PLANNER_VERSION;
const bank = loadBank();
const jobs = JSON.parse(fs.readFileSync(WEEK_JOBS, "utf8")).filter((j) => j.job_url).slice(0, count);
const cache = new Map();

let totalAts = 0;
let n = 0;

for (const job of jobs) {
  const jd = fullJd(job.job_url, cache);
  if (jd.length < 400) continue;
  const result = compose(jd, bank);
  const compact = {
    theme: result.theme,
    coverage: result.coverage,
    plan: result.plan,
    selection_trace: result.selection_trace,
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
  const ingested = ingestComposeRun({
    composition: compact,
    analyst: null,
    job: { company: job.company, title: job.title, job_url: job.job_url },
    source: "counterfactual",
    plannerVersion,
  });
  totalAts += ingested.scores.final_score;
  n += 1;
}

const projection = loadProjection("planner_counterfactual");
console.log(`Counterfactual run: planner ${plannerVersion} on ${n} jobs`);
console.log(`Average ATS this run: ${n ? Math.round(totalAts / n) : 0}`);
console.log("Planner version history:");
for (const row of projection.versions || []) {
  console.log(`  ${row.planner_version}: avg_ats=${row.avg_ats} avg_reward=${row.avg_reward} runs=${row.runs}`);
}
