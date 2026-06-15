#!/usr/bin/env node
/**
 * Install permanent macOS LaunchAgents for the full pipeline:
 *   com.atriveo.job-pipeline  — hourly scrape + jd:export
 *   com.atriveo.feed-sync     — job feed → Cloudflare Pages
 *   com.atriveo.resume-sync   — enqueue top resumes for worker
 *   com.atriveo.tailor        — tailor sidecar + cloudflared (login + survive reboot)
 *   com.atriveo.tailor-worker — Mongo compile worker (no browser tab)
 *
 *   npm run pipeline:install
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HOME = os.homedir();
const JOB_PIPELINE_DIR = process.env.JOB_PIPELINE_DIR || path.join(HOME, "job-pipeline");
const PLIST_TEMPLATE = path.join(__dirname, "launchagents", "com.atriveo.job-pipeline.plist");
const PLIST_DEST = path.join(HOME, "Library/LaunchAgents", "com.atriveo.job-pipeline.plist");
const PIPELINE_LABEL = "com.atriveo.job-pipeline";
const FEED_SYNC_LABEL = "com.atriveo.feed-sync";
const RESUME_SYNC_LABEL = "com.atriveo.resume-sync";
const TAILOR_LABEL = "com.atriveo.tailor";
const WORKER_LABEL = "com.atriveo.tailor-worker";

function installLaunchAgent(label, templateName, replacements) {
  const templatePath = path.join(__dirname, "launchagents", templateName);
  const dest = path.join(HOME, "Library/LaunchAgents", templateName);
  if (!fs.existsSync(templatePath)) {
    console.warn(`\n⚠ Missing ${templatePath} — skip ${label}`);
    return;
  }
  let plist = fs.readFileSync(templatePath, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    plist = plist.replaceAll(key, value);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, plist);
  const uid = os.userInfo().uid;
  spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "pipe" });
  const boot = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, dest], { encoding: "utf8" });
  if (boot.status !== 0 && !String(boot.stderr || boot.stdout).includes("already")) {
    console.warn(`launchctl bootstrap note: ${(boot.stderr || boot.stdout || "").trim()}`);
  }
  spawnSync("launchctl", ["enable", `gui/${uid}/${label}`], { stdio: "pipe" });
  spawnSync("launchctl", ["kickstart", `gui/${uid}/${label}`], { stdio: "pipe" });
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function readGithubToken() {
  const envPath = path.join(JOB_PIPELINE_DIR, ".env");
  if (!fs.existsSync(envPath)) return process.env.GITHUB_TOKEN || "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^GITHUB_TOKEN=(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.GITHUB_TOKEN || "";
}

function installJobPipelineAgent() {
  if (!fs.existsSync(JOB_PIPELINE_DIR)) {
    console.error(`\n✗ job-pipeline not found at ${JOB_PIPELINE_DIR}`);
    console.error("  Clone it or set JOB_PIPELINE_DIR=/path/to/job-pipeline\n");
    process.exit(1);
  }
  const runScript = path.join(JOB_PIPELINE_DIR, "run-pipeline-and-export.sh");
  if (!fs.existsSync(runScript)) {
    console.error(`\n✗ Missing ${runScript}\n`);
    process.exit(1);
  }

  const token = readGithubToken();
  if (!token) {
    console.warn("\n⚠ GITHUB_TOKEN not found in job-pipeline/.env — deploy step may fail.");
    console.warn("  Add GITHUB_TOKEN=... to job-pipeline/.env and re-run pipeline:install\n");
  }

  let plist = fs.readFileSync(PLIST_TEMPLATE, "utf8");
  plist = plist
    .replaceAll("__JOB_PIPELINE_DIR__", JOB_PIPELINE_DIR)
    .replaceAll("__ATRIVEO_APP_DIR__", ROOT)
    .replace("__GITHUB_TOKEN__", token);

  fs.mkdirSync(path.dirname(PLIST_DEST), { recursive: true });
  fs.writeFileSync(PLIST_DEST, plist);

  const uid = os.userInfo().uid;
  spawnSync("launchctl", ["bootout", `gui/${uid}/${PIPELINE_LABEL}`], { stdio: "pipe" });
  const boot = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, PLIST_DEST], { encoding: "utf8" });
  if (boot.status !== 0 && !String(boot.stderr || boot.stdout).includes("already")) {
    console.warn(`launchctl bootstrap note: ${(boot.stderr || boot.stdout || "").trim()}`);
  }
  spawnSync("launchctl", ["enable", `gui/${uid}/${PIPELINE_LABEL}`], { stdio: "pipe" });
  spawnSync("launchctl", ["kickstart", `gui/${uid}/${PIPELINE_LABEL}`], { stdio: "pipe" });

  console.log("\n✓ com.atriveo.job-pipeline installed");
  console.log("  Hourly :00 — scrape → MongoDB → jd:export (feed at :20)");
  console.log("  Log:    /tmp/atriveo_pipeline.log");
}

function installFeedSyncAgent() {
  installLaunchAgent(FEED_SYNC_LABEL, "com.atriveo.feed-sync.plist", {
    __ATRIVEO_APP_DIR__: ROOT,
    __JOB_PIPELINE_DIR__: JOB_PIPELINE_DIR,
  });
  console.log("\n✓ com.atriveo.feed-sync installed");
  console.log("  Hourly :20 — job feed → Cloudflare Pages (also runs after scrape)");
  console.log("  Log:    /tmp/atriveo_feed_sync.log");
  console.log("  Manual: npm run feed:sync");
}

function installResumeSyncAgent() {
  installLaunchAgent(RESUME_SYNC_LABEL, "com.atriveo.resume-sync.plist", {
    __ATRIVEO_APP_DIR__: ROOT,
  });
  console.log("\n✓ com.atriveo.resume-sync installed");
  console.log("  Hourly :35 — enqueue fresh JDs from latest scrape (priority queue)");
  console.log("  Log:    /tmp/atriveo_resume_sync.log");
  console.log("  Manual: npm run resume:sync");
}

function tailorLoaded() {
  const r = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  return r.stdout?.includes(TAILOR_LABEL) ?? false;
}

function installTailorAgent() {
  if (tailorLoaded()) {
    console.log("\n✓ com.atriveo.tailor already loaded — skipping reinstall");
    console.log("  Restart if needed: npm run tailor:restart");
  } else {
    console.log("\n→ Installing com.atriveo.tailor …");
    const r = spawnSync(process.execPath, [path.join(__dirname, "install-tailor-service.mjs")], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.warn("\n⚠ Tailor install failed — run: npm run tailor:install\n");
    }
  }
}

function workerLoaded() {
  const r = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  return r.stdout?.includes(WORKER_LABEL) ?? false;
}

function installTailorWorkerAgent() {
  if (workerLoaded()) {
    console.log("\n✓ com.atriveo.tailor-worker already loaded — skipping reinstall");
    console.log("  Restart if needed: npm run tailor:worker:restart");
    return;
  }
  console.log("\n→ Installing com.atriveo.tailor-worker …");
  const r = spawnSync(process.execPath, [path.join(__dirname, "install-tailor-worker-service.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.warn("\n⚠ Worker install failed — run: npm run tailor:worker:install\n");
  }
}

function main() {
  console.log("Atriveo — permanent pipeline install\n");
  installJobPipelineAgent();
  installFeedSyncAgent();
  installResumeSyncAgent();
  installTailorAgent();
  installTailorWorkerAgent();
  console.log("\n→ Verifying …\n");
  const status = spawnSync(process.execPath, [path.join(__dirname, "pipeline-status.mjs")], {
    stdio: "inherit",
    cwd: ROOT,
  });
  console.log("\nPermanent services installed. After login or reboot:");
  console.log("  • :00 scrape + JD buckets  |  :20 feed deploy  |  :35 resume queue");
  console.log("  • Tailor sidecar restarts automatically (KeepAlive)");
  console.log("  • Compile worker drains Mongo queue — Dashboard tab optional");
  process.exit(status.status ?? 0);
}

main();
