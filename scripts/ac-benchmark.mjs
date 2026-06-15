#!/usr/bin/env node
/**
 * Deterministic benchmark for the AC selector.
 *
 * Samples high-scoring jobs from public/week_jobs.json, joins full JDs from
 * public/job_descriptions/*.json, runs the AC-bank composer, and writes a
 * reviewable JSON report. This is intentionally model-free so the baseline is
 * fast, repeatable, and not biased by an LLM's rewrite preferences.
 *
 * Usage:
 *   node scripts/ac-benchmark.mjs --count 10 --pool 150 --seed 2026-06-14
 */
import fs from "node:fs";
import path from "node:path";
import { compose, loadBank } from "./ac-bank.mjs";
import { ingestComposeRun } from "./ac-learning.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEEK_JOBS = path.join(ROOT, "public", "week_jobs.json");
const JD_DIR = path.join(ROOT, "public", "job_descriptions");
const DEFAULT_OUT = path.join(ROOT, "benchmarks", "ac-last7-benchmark.json");

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const count = Number(arg("count", 10));
const poolSize = Number(arg("pool", 150));
const seed = String(arg("seed", new Date().toISOString().slice(0, 10)));
const minJdChars = Number(arg("min-jd-chars", 400));
const outPath = path.resolve(arg("out", DEFAULT_OUT));
const learn = process.argv.includes("--learn");

function bucketForUrl(jobUrl) {
  let hash = 0;
  for (let index = 0; index < jobUrl.length; index += 1) {
    hash = ((hash * 31) + jobUrl.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

function seededRandom(seedText) {
  let state = 2166136261;
  for (const char of seedText) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = Math.imul(state + 0x6d2b79f5, 0x85ebca6b) >>> 0;
    state ^= state >>> 13;
    state = Math.imul(state, 0xc2b2ae35) >>> 0;
    return (state >>> 0) / 4294967296;
  };
}

function shuffle(rows, seedText) {
  const random = seededRandom(seedText);
  const copy = [...rows];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const bucketCache = new Map();
function fullJdForUrl(jobUrl) {
  const bucket = bucketForUrl(jobUrl);
  if (!bucketCache.has(bucket)) {
    const file = path.join(JD_DIR, `${bucket}.json`);
    bucketCache.set(bucket, fs.existsSync(file) ? readJson(file) : {});
  }
  return String(bucketCache.get(bucket)[jobUrl] || "").trim();
}

function allSelectedBullets(result) {
  const experience = result.experience.flatMap((role) =>
    role.bullets.map(({ ac, face }) => ({ section: "experience", role: role.role, ac, face })),
  );
  const projects = result.projects.flatMap((project) =>
    project.bullets.map(({ ac, face }) => ({ section: "project", role: project.role, ac, face })),
  );
  return [...experience, ...projects];
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ").trim();
}

function hasPhrase(haystack, phrase) {
  const hay = ` ${normalize(haystack)} `;
  const needle = normalize(phrase);
  return !!needle && hay.includes(` ${needle} `);
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function evaluate(jd, bank, result) {
  const coverage = result.coverage || {};
  const audit = coverage.audit || {};
  const plannedTerms = Object.keys(result.plan?.routes || {});
  const auditEntries = Object.values(audit);

  const exactHits = auditEntries.filter((entry) => entry.match_type === "exact").length;
  const aliasHits = auditEntries.filter((entry) => entry.match_type === "alias").length;
  const semanticHits = auditEntries.filter((entry) => entry.match_type === "semantic").length;
  const skillsHits = auditEntries.filter((entry) => entry.match_type === "skills").length;

  const weightedCoverage = coverage.weighted_coverage ?? 0;
  const plannedSatisfied = auditEntries.filter((entry) => entry.status === "satisfied").length;
  const planCoverage = plannedTerms.length ? plannedSatisfied / plannedTerms.length : 1;
  const score = Math.round((weightedCoverage * 0.7 + planCoverage * 0.3) * 100);

  return {
    score,
    weighted_keyword_coverage: weightedCoverage,
    plan_coverage: Number(planCoverage.toFixed(3)),
    exact_matches: exactHits,
    alias_matches: aliasHits,
    semantic_matches: semanticHits,
    skills_matches: skillsHits,
    planned_terms: plannedTerms.length,
    satisfied_terms: plannedSatisfied,
    missing_claimable: coverage.missing_claimable || [],
    unclaimable: coverage.unclaimable || [],
    keyword_audit: audit,
  };
}

function compactPlan(plan) {
  if (!plan) return null;
  return {
    jd_terms: plan.jd_terms || [],
    routes: plan.routes || {},
    ac_priority: plan.ac_priority || {},
    facet_priority: plan.facet_priority || {},
  };
}

function compactComposition(result) {
  return {
    theme: result.theme,
    matched_concepts: result.matched,
    plan: compactPlan(result.plan),
    skills: result.skills || [],
    coverage: {
      weighted_coverage: result.coverage?.weighted_coverage ?? 0,
      audit: result.coverage?.audit || {},
      missing_claimable: result.coverage?.missing_claimable || [],
      unclaimable: result.coverage?.unclaimable || [],
    },
    experience: result.experience.map((role) => ({
      role: role.role,
      bullets: role.bullets.map(({ ac, face }) => ({
        ac_id: ac.id,
        emphasis: face.emphasis,
        facet: face.facet || null,
        text: face.text,
      })),
    })),
    projects: result.projects.map((project) => ({
      role: project.role,
      bullets: project.bullets.map(({ ac, face }) => ({
        ac_id: ac.id,
        emphasis: face.emphasis,
        facet: face.facet || null,
        text: face.text,
      })),
    })),
  };
}

const bank = loadBank();
const weekJobs = readJson(WEEK_JOBS)
  .filter((job) => job?.job_url)
  .map((job) => ({ ...job, jd: fullJdForUrl(job.job_url) }))
  .filter((job) => job.jd.length >= minJdChars)
  .sort((a, b) =>
    (b.score_pct ?? 0) - (a.score_pct ?? 0)
    || (b.score ?? 0) - (a.score ?? 0)
    || String(a.company || "").localeCompare(String(b.company || "")),
  );

const topPool = weekJobs.slice(0, Math.max(count, poolSize));
const sample = shuffle(topPool, seed).slice(0, count);

const jobs = sample.map((job, index) => {
  const result = compose(job.jd, bank);
  const compact = compactComposition(result);
  if (learn) {
    ingestComposeRun({
      composition: { ...compact, plan: result.plan, selection_trace: result.selection_trace },
      analyst: null,
      job: {
        company: job.company,
        title: job.title,
        job_url: job.job_url,
        batch_time: job.batch_time,
      },
      source: "benchmark",
    });
  }
  return {
    sample_id: index + 1,
    company: job.company,
    title: job.title,
    location: job.location,
    score_pct: job.score_pct,
    pipeline_score: job.score,
    ats_score: job.ats_score,
    fit_score: job.fit_score,
    batch_time: job.batch_time,
    job_url: job.job_url,
    jd_excerpt: job.jd.slice(0, 600).replace(/\s+/g, " ").trim(),
    evaluation: evaluate(job.jd, bank, result),
    composition: compact,
    human_review: {
      selection_fit_1_to_10: null,
      reads_human_1_to_10: null,
      missing_claimable_keywords: [],
      notes: "",
    },
  };
});

const report = {
  generated_at: new Date().toISOString(),
  source: {
    week_jobs: path.relative(ROOT, WEEK_JOBS),
    job_descriptions: path.relative(ROOT, JD_DIR),
    candidate_jobs_with_full_jd: weekJobs.length,
    top_pool_size: topPool.length,
    seed,
    count,
  },
  rubric: {
    score: "70% weighted keyword coverage (exact/alias/semantic/skills) + 30% planner route satisfaction.",
    human_review: "Fill selection_fit and reads_human after blind review. Use coverage.audit provenance to verify every emitted keyword.",
  },
  aggregate: {
    average_score: Math.round(jobs.reduce((sum, job) => sum + job.evaluation.score, 0) / (jobs.length || 1)),
    average_weighted_coverage: Number((jobs.reduce((sum, job) => sum + job.evaluation.weighted_keyword_coverage, 0) / (jobs.length || 1)).toFixed(3)),
    average_plan_coverage: Number((jobs.reduce((sum, job) => sum + job.evaluation.plan_coverage, 0) / (jobs.length || 1)).toFixed(3)),
  },
  jobs,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${jobs.length} AC benchmark samples from top ${topPool.length} week jobs`);
console.log(`Seed: ${seed}`);
console.log(`Average score: ${report.aggregate.average_score}`);
if (learn) console.log("Learning events appended to data/ac-learning/events.jsonl");
console.log(`Report: ${path.relative(ROOT, outPath)}`);
