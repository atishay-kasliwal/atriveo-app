// Market frequency + drift from scraped LinkedIn JD corpus.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestMarketObservation } from "./ac-learning.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LEARNING_DIR = path.join(ROOT, "data", "ac-learning");
const WEEK_JOBS = path.join(ROOT, "public", "week_jobs.json");
const JD_DIR = path.join(ROOT, "public", "job_descriptions");
const MARKET_FREQ_PATH = path.join(LEARNING_DIR, "market_frequency.json");
const MARKET_DRIFT_PATH = path.join(LEARNING_DIR, "market_drift.json");

const TRACKED_TERMS = [
  "fastapi", "docker", "kubernetes", "terraform", "helm", "aws", "gcp", "azure",
  "machine learning", "deep learning", "llm", "rag", "langchain", "langgraph",
  "mcp", "agentic", "agents", "evaluation", "feature engineering", "predictive analytics",
  "microservices", "kafka", "redis", "postgresql", "ci/cd", "pytorch", "tensorflow",
  "react", "typescript", "spring boot", "graphql", "vector database", "etl",
];

function normalizeHaystack(text) {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
}

function termHits(haystack, term) {
  const t = term.toLowerCase().trim();
  return haystack.includes(` ${t} `) ? 1 : 0;
}

function bucketForUrl(jobUrl) {
  let hash = 0;
  for (let i = 0; i < jobUrl.length; i += 1) hash = ((hash * 31) + jobUrl.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fullJdForUrl(jobUrl, bucketCache) {
  const bucket = bucketForUrl(jobUrl);
  if (!bucketCache.has(bucket)) {
    const file = path.join(JD_DIR, `${bucket}.json`);
    bucketCache.set(bucket, fs.existsSync(file) ? readJson(file) : {});
  }
  return String(bucketCache.get(bucket)[jobUrl] || "").trim();
}

function scanJobs(jobs, { minJdChars = 200 } = {}) {
  const bucketCache = new Map();
  const counts = Object.fromEntries(TRACKED_TERMS.map((term) => [term, 0]));
  let scanned = 0;

  for (const job of jobs) {
    const jd = fullJdForUrl(job.job_url, bucketCache) || String(job.summary || "");
    if (jd.length < minJdChars) continue;
    const hay = normalizeHaystack(jd);
    scanned += 1;
    for (const term of TRACKED_TERMS) counts[term] += termHits(hay, term);
  }

  const frequency = TRACKED_TERMS.map((term) => ({
    term,
    count: counts[term],
    pct: scanned ? Number(((counts[term] / scanned) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.count - a.count);

  return { scanned, frequency };
}

function parseBatchTime(value) {
  const ts = Date.parse(value || "");
  return Number.isFinite(ts) ? ts : null;
}

export function scanMarket({ weekJobsPath = WEEK_JOBS, driftDays = 90 } = {}) {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  const jobs = readJson(weekJobsPath).filter((job) => job?.job_url);
  const overall = scanJobs(jobs);

  const now = Date.now();
  const cutoff = now - driftDays * 24 * 60 * 60 * 1000;
  const midpoint = now - (driftDays / 2) * 24 * 60 * 60 * 1000;

  const older = [];
  const recent = [];
  for (const job of jobs) {
    const ts = parseBatchTime(job.batch_time || job.scraped_date);
    if (!ts) continue;
    if (ts < midpoint) older.push(job);
    else recent.push(job);
  }

  const olderScan = scanJobs(older);
  const recentScan = scanJobs(recent);
  const olderMap = Object.fromEntries(olderScan.frequency.map((row) => [row.term, row.pct]));
  const recentMap = Object.fromEntries(recentScan.frequency.map((row) => [row.term, row.pct]));

  const drift = TRACKED_TERMS.map((term) => {
    const before = olderMap[term] || 0;
    const today = recentMap[term] || 0;
    return {
      term,
      pct_before: before,
      pct_today: today,
      delta: Number((today - before).toFixed(1)),
      trend: today > before + 2 ? "rising" : today < before - 2 ? "falling" : "stable",
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const marketFrequency = {
    generated_at: new Date().toISOString(),
    source: path.relative(ROOT, weekJobsPath),
    jobs_total: jobs.length,
    jobs_scanned: overall.scanned,
    frequency: overall.frequency,
  };

  const marketDrift = {
    generated_at: new Date().toISOString(),
    window_days: driftDays,
    older_jobs: older.length,
    recent_jobs: recent.length,
    drift,
    rising: drift.filter((row) => row.trend === "rising").slice(0, 15),
    falling: drift.filter((row) => row.trend === "falling").slice(0, 15),
  };

  fs.writeFileSync(MARKET_FREQ_PATH, `${JSON.stringify(marketFrequency, null, 2)}\n`);
  fs.writeFileSync(MARKET_DRIFT_PATH, `${JSON.stringify(marketDrift, null, 2)}\n`);

  return { marketFrequency, marketDrift };
}

export function loadMarketFrequency() {
  if (!fs.existsSync(MARKET_FREQ_PATH)) return null;
  return JSON.parse(fs.readFileSync(MARKET_FREQ_PATH, "utf8"));
}

export function loadMarketDrift() {
  if (!fs.existsSync(MARKET_DRIFT_PATH)) return null;
  return JSON.parse(fs.readFileSync(MARKET_DRIFT_PATH, "utf8"));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const learn = process.argv.includes("--learn");
  const { marketFrequency, marketDrift } = scanMarket();
  if (learn) ingestMarketObservation(marketFrequency, marketDrift);
  console.log(`Scanned ${marketFrequency.jobs_scanned} jobs`);
  console.log("Top terms:");
  for (const row of marketFrequency.frequency.slice(0, 12)) {
    console.log(`  ${row.term.padEnd(22)} ${row.pct}%`);
  }
  console.log("Rising:");
  for (const row of marketDrift.rising.slice(0, 8)) {
    console.log(`  ${row.term.padEnd(22)} ${row.pct_before}% -> ${row.pct_today}%`);
  }
}
