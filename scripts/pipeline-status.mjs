#!/usr/bin/env node
/**
 * End-to-end pipeline status — scrape → jd:export → feed → tailor.
 *   npm run pipeline:status
 *
 * Lighter than tailor:doctor: focuses on automation (LaunchAgents, scrape log)
 * plus JD freshness and sidecar reachability.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });
const JD_DIR = path.join(ROOT, "public", "job_descriptions");
const PIPELINE_LOG = "/tmp/atriveo_pipeline.log";
const FEED_SYNC_LOG = "/tmp/atriveo_feed_sync.log";
const RESUME_SYNC_LOG = "/tmp/atriveo_resume_sync.log";
const TAILOR_LOG = path.join(os.homedir(), "Library/Logs/atriveo-tailor.log");
const WORKER_LOG = path.join(os.homedir(), "Library/Logs/atriveo-tailor-worker.log");
const SIDECAR = "http://127.0.0.1:8787";

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
let failures = 0;
let warnings = 0;

function ok(label, detail) {
  console.log(`${C.green}✓${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`);
}
function warn(label, detail, fix) {
  warnings++;
  console.log(`${C.yellow}⚠${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`);
  if (fix) console.log(`   ${C.dim}fix: ${fix}${C.reset}`);
}
function bad(label, detail, fix) {
  failures++;
  console.log(`${C.red}✗${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`);
  if (fix) console.log(`   ${C.dim}fix: ${fix}${C.reset}`);
}
function section(title) {
  console.log(`\n${C.bold}${title}${C.reset}`);
}

function launchAgentLoaded(label) {
  const r = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const line = r.stdout.split("\n").find((l) => l.includes(label));
  if (!line) return { loaded: false, pid: null, lastExit: null };
  const parts = line.trim().split(/\s+/);
  const pid = parts[0] === "-" ? null : Number(parts[0]);
  const lastExit = parts[1] != null ? Number(parts[1]) : null;
  return { loaded: true, pid, lastExit };
}

function tailLines(file, n = 6) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").slice(-n);
}

function hoursSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

function fmtAge(hours) {
  if (hours === Infinity) return "unknown";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

function loadEnvToken() {
  const p = path.join(ROOT, ".env.tailor");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (line.startsWith("TAILOR_TOKEN=")) return line.slice("TAILOR_TOKEN=".length).trim();
  }
  return "";
}

function checkLaunchAgents() {
  section("Automation (Mac LaunchAgents)");
  const agents = [
    { label: "com.atriveo.job-pipeline", fix: "npm run pipeline:install", detail: "hourly scrape + jd:export" },
    { label: "com.atriveo.feed-sync", fix: "npm run pipeline:install", detail: "job feed → Cloudflare" },
    { label: "com.atriveo.resume-sync", fix: "npm run pipeline:install", detail: "enqueue top resumes" },
    { label: "com.atriveo.tailor", fix: "npm run tailor:install", detail: null },
    { label: "com.atriveo.tailor-worker", fix: "npm run tailor:worker:install", detail: null },
  ];
  for (const { label, fix, detail } of agents) {
    const st = launchAgentLoaded(label);
    if (!st?.loaded) {
      bad(`${label} not loaded`, "automation won't run unattended", fix);
      continue;
    }
    if (label === "com.atriveo.tailor" || label === "com.atriveo.tailor-worker") {
      if (st.pid) ok(`${label} running`, `pid ${st.pid}`);
      else warn(`${label} loaded but not running`, `last exit ${st.lastExit ?? "?"}`,
        label === "com.atriveo.tailor-worker"
          ? "npm run tailor:worker:restart"
          : "launchctl kickstart -k gui/$(id -u)/com.atriveo.tailor");
    } else {
      ok(label, detail || "loaded");
    }
  }
}

function checkPipelineLog() {
  section("Last scrape + JD export");
  const lines = tailLines(PIPELINE_LOG, 8);
  if (!lines.length) {
    warn("No pipeline log yet", PIPELINE_LOG, "wait for hourly run or: cd ~/job-pipeline && bash run-pipeline-and-export.sh");
    return;
  }
  for (const line of lines) console.log(`  ${C.dim}${line}${C.reset}`);
  const lastExport = [...lines].reverse().find((l) => l.includes("jd:export exit="));
  const lastScrape = [...lines].reverse().find((l) => l.includes("scraper exit="));
  if (lastScrape) {
    const exit = lastScrape.match(/scraper exit=(\d+)/)?.[1];
    if (exit === "0") ok("Last scraper run", "exit 0");
    else warn("Last scraper run had errors", `exit ${exit}`, "check ~/job-pipeline logs");
  }
  if (lastExport) {
    const exit = lastExport.match(/jd:export exit=(\d+)/)?.[1];
    if (exit === "0") ok("Last jd:export", "exit 0");
    else bad("Last jd:export failed", `exit ${exit}`, "npm run pipeline:sync");
  } else {
    warn("No jd:export line in recent log", "buckets may be stale", "npm run pipeline:sync");
  }
}

function checkFeedSyncLog() {
  section("Job feed sync (dashboard sessions)");
  const lines = tailLines(FEED_SYNC_LOG, 6);
  if (!lines.length) {
    warn("No feed-sync log yet", FEED_SYNC_LOG, "npm run feed:sync");
    return;
  }
  for (const line of lines) console.log(`  ${C.dim}${line}${C.reset}`);
  const lastDone = [...lines].reverse().find((l) => l.includes("feed-sync done"));
  const lastDeploy = [...lines].reverse().find((l) => l.includes("pages deploy exit="));
  if (lastDone) ok("Last feed-sync", "completed");
  else if (lastDeploy) {
    const exit = lastDeploy.match(/pages deploy exit=(\d+)/)?.[1];
    if (exit === "0") ok("Last Pages deploy", "exit 0");
    else warn("Last Pages deploy failed", `exit ${exit}`, "npm run feed:sync");
  } else {
    warn("Feed-sync may still be running", FEED_SYNC_LOG, "npm run feed:sync");
  }
}

function checkResumeSyncLog() {
  section("Resume queue sync (compile worker)");
  const lines = tailLines(RESUME_SYNC_LOG, 6);
  if (!lines.length) {
    warn("No resume-sync log yet", RESUME_SYNC_LOG, "npm run resume:sync");
    return;
  }
  for (const line of lines) console.log(`  ${C.dim}${line}${C.reset}`);
  const lastEnqueue = [...lines].reverse().find((l) => l.includes("resume:enqueue exit="));
  if (lastEnqueue) {
    const exit = lastEnqueue.match(/resume:enqueue exit=(\d+)/)?.[1];
    if (exit === "0") ok("Last resume-sync", "exit 0");
    else warn("Last resume-sync failed", `exit ${exit}`, "npm run resume:sync");
  } else {
    warn("No resume:enqueue in recent log", RESUME_SYNC_LOG, "npm run resume:sync");
  }
}

function checkJdBuckets() {
  section("JD buckets (feed → tailor)");
  const manifestPath = path.join(JD_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    bad("JD buckets missing", JD_DIR, "npm run pipeline:sync");
    return;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch { bad("manifest.json unreadable", manifestPath, "npm run pipeline:sync"); return; }
  const age = hoursSince(manifest.generated_at);
  const detail = `${manifest.descriptions_found} JDs · ${fmtAge(age)}`;
  if (age > 2) bad("JD buckets stale", detail, "npm run pipeline:sync");
  else ok("JD buckets fresh", detail);
}

async function checkSidecar() {
  section("Tailor sidecar");
  const token = loadEnvToken();
  try {
    const res = await fetch(`${SIDECAR}/health`, {
      headers: token ? { "X-Tailor-Token": token } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = await res.json();
    if (h.ok) {
      const mongo = h.mongo ? "mongo ok" : "mongo not configured";
      ok("Sidecar healthy", `${h.pipeline === "legacy" ? "legacy" : `ac/${h.planner || "v2"}`} · drive ${h.driveMounted ? "ok" : "MISSING"} · ${mongo}`);
      if (!h.driveMounted) {
        const root = h.outRoot || "/Volumes/Kasliwal v2";
        bad(root.startsWith("/Volumes/") ? "External drive not mounted" : "Output root missing", root, root.startsWith("/Volumes/") ? "plug in drive" : `mkdir -p "${root}"`);
      }
    }
  } catch (e) {
    bad("Sidecar unreachable", e.message, "npm run tailor  or  launchctl kickstart -k gui/$(id -u)/com.atriveo.tailor");
  }
}

function checkWorkerLog() {
  section("Compile worker");
  const lines = tailLines(WORKER_LOG, 5);
  if (!lines.length) {
    warn("No worker log yet", WORKER_LOG, "npm run tailor:worker:install");
    return;
  }
  for (const line of lines) console.log(`  ${C.dim}${line}${C.reset}`);
  const last = lines[lines.length - 1] || "";
  if (last.includes("[done]") || last.includes("[claim]") || last.includes("[start]")) ok("Worker recently active", "see log above");
}

async function checkWorkerFleet() {
  if (!process.env.MONGO_URI?.trim()) return;
  section("Worker fleet (Mongo)");
  try {
    const { withMongo, closeMongo } = await import("./mongo-client.mjs");
    const { listActiveWorkers } = await import("./worker-registry.mjs");
    const workers = await withMongo((db) => listActiveWorkers(db), { appName: "AtriveoPipelineStatus" });
    await closeMongo();
    if (!workers.length) {
      warn("No active workers in Mongo", "last_seen < 90s", "npm run tailor:worker:install on each Mac");
      return;
    }
    for (const w of workers) {
      const label = `${w.hostname || w.worker_id} · ${w.status}${w.drive_mounted === false ? " · drive missing" : ""}`;
      if (w.status === "busy") ok(label, w.current_job_url?.slice(0, 50) || "compiling");
      else ok(label, "idle");
    }
  } catch (e) {
    warn("Could not list worker fleet", e.message);
  }
}

function printNextSteps() {
  section("To run the pipeline now");
  console.log(`  ${C.dim}1.${C.reset} Scrape:  cd ~/job-pipeline && .venv/bin/python -m job_pipeline.main --pipeline all --deploy`);
  console.log(`  ${C.dim}2.${C.reset} Sync JD: npm run pipeline:sync`);
  console.log(`  ${C.dim}3.${C.reset} Worker:  npm run tailor:worker:install  (or via pipeline:install)`);
  console.log(`  ${C.dim}Feed:${C.reset}   npm run feed:sync     (dashboard sessions → Cloudflare)`);
  console.log(`  ${C.dim}Resume:${C.reset} npm run resume:sync   (enqueue top 25 for worker)`);
  console.log(`  ${C.dim}Both:${C.reset}   npm run sync:all      (run feed + resume in parallel)`);
  console.log(`  ${C.dim}5.${C.reset} App:     open Dashboard — optional; worker compiles without tab`);
  console.log(`  ${C.dim}6.${C.reset} Deep:    npm run tailor:doctor`);
}

(async function main() {
  console.log(`${C.bold}Atriveo pipeline status${C.reset} ${C.dim}· ${new Date().toLocaleString()}${C.reset}`);
  checkLaunchAgents();
  checkPipelineLog();
  checkFeedSyncLog();
  checkResumeSyncLog();
  checkJdBuckets();
  await checkSidecar();
  checkWorkerLog();
  await checkWorkerFleet();
  printNextSteps();

  console.log();
  if (failures) {
    console.log(`${C.red}${C.bold}${failures} blocker(s)${C.reset}${warnings ? `, ${warnings} warning(s)` : ""}.`);
    process.exit(1);
  }
  if (warnings) {
    console.log(`${C.yellow}${C.bold}${warnings} warning(s)${C.reset} — pipeline may work; review above.`);
    process.exit(0);
  }
  console.log(`${C.green}${C.bold}Pipeline ready.${C.reset} Worker compiles from Mongo; Dashboard is optional.`);
})();
