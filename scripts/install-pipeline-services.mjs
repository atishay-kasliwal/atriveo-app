#!/usr/bin/env node
/**
 * Install the macOS services the pipeline still needs:
 *   com.atriveo.tailor        — tailor sidecar + cloudflared (also serves /scrape/*)
 *   com.atriveo.tailor-worker — Mongo compile worker (no browser tab)
 *
 *   npm run pipeline:install
 *
 * WHAT CHANGED: scraping is no longer scheduled. The hourly agents
 * (job-pipeline :00, feed-sync :20, resume-sync :35) are gone — the app's
 * "Scrape now" button drives a run through the sidecar instead, and that run
 * chains JD export → feed deploy → resume queue itself. This installer now
 * *removes* those agents so a machine migrating off the old setup does not keep
 * scraping on a timer behind your back.
 *
 * The sidecar stays a LaunchAgent because the button is useless if the Mac is
 * not listening when you click it.
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
const TAILOR_LABEL = "com.atriveo.tailor";
const WORKER_LABEL = "com.atriveo.tailor-worker";

/** Agents from the scheduled era. Retired — removed on install. */
const RETIRED_AGENTS = [
  "com.atriveo.job-pipeline",
  "com.atriveo.feed-sync",
  "com.atriveo.resume-sync",
];

function agentLoaded(label) {
  const r = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  return r.stdout?.includes(label) ?? false;
}

function removeRetiredAgents() {
  console.log("→ Removing scheduled scrape agents (on-demand now) …");
  const uid = os.userInfo().uid;
  for (const label of RETIRED_AGENTS) {
    const plist = path.join(HOME, "Library/LaunchAgents", `${label}.plist`);
    const wasLoaded = agentLoaded(label);
    const hadPlist = fs.existsSync(plist);
    if (wasLoaded) spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "pipe" });
    if (hadPlist) fs.rmSync(plist, { force: true });
    console.log(`  ${wasLoaded || hadPlist ? "unloaded + removed" : "not present"} · ${label}`);
  }
}

function checkScrapeScript() {
  console.log("\n→ Checking on-demand scrape entry point …");
  if (!fs.existsSync(JOB_PIPELINE_DIR)) {
    console.error(`\n✗ job-pipeline not found at ${JOB_PIPELINE_DIR}`);
    console.error("  Clone it, or set JOB_PIPELINE_DIR=/path/to/job-pipeline\n");
    process.exit(1);
  }
  const script = path.join(JOB_PIPELINE_DIR, "run-pipeline-and-export.sh");
  if (!fs.existsSync(script)) {
    console.error(`\n✗ Missing ${script}\n`);
    process.exit(1);
  }
  // The sidecar invokes it via /bin/bash, so the exec bit is a convenience —
  // still set it so `./run-pipeline-and-export.sh` works from a terminal.
  try {
    fs.chmodSync(script, 0o755);
  } catch {
    /* non-fatal */
  }
  const envPath = path.join(ROOT, ".env");
  const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (!/^JOB_PIPELINE_DIR=/m.test(envRaw) && JOB_PIPELINE_DIR !== path.join(HOME, "job-pipeline")) {
    console.log(`  note: add JOB_PIPELINE_DIR=${JOB_PIPELINE_DIR} to atriveo-app/.env`);
  }
  console.log(`  ✓ ${script}`);
}

function installTailorAgent() {
  if (agentLoaded(TAILOR_LABEL)) {
    console.log("\n✓ com.atriveo.tailor already loaded — skipping reinstall");
    console.log("  Restart if needed: npm run tailor:restart");
    return;
  }
  console.log("\n→ Installing com.atriveo.tailor …");
  const r = spawnSync(process.execPath, [path.join(__dirname, "install-tailor-service.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) console.warn("\n⚠ Tailor install failed — run: npm run tailor:install\n");
}

function installTailorWorkerAgent() {
  if (agentLoaded(WORKER_LABEL)) {
    console.log("\n✓ com.atriveo.tailor-worker already loaded — skipping reinstall");
    console.log("  Restart if needed: npm run tailor:worker:restart");
    return;
  }
  console.log("\n→ Installing com.atriveo.tailor-worker …");
  const r = spawnSync(process.execPath, [path.join(__dirname, "install-tailor-worker-service.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) console.warn("\n⚠ Worker install failed — run: npm run tailor:worker:install\n");
}

function main() {
  console.log("Atriveo — pipeline install (on-demand scraping)\n");
  removeRetiredAgents();
  checkScrapeScript();
  installTailorAgent();
  installTailorWorkerAgent();

  console.log("\n→ Verifying …\n");
  const status = spawnSync(process.execPath, [path.join(__dirname, "pipeline-status.mjs")], {
    stdio: "inherit",
    cwd: ROOT,
  });

  console.log("\nInstalled. Scraping is now manual:");
  console.log("  • In the app: header → Scrape now");
  console.log("  • From a terminal: npm run scrape:now");
  console.log("  • The sidecar restarts automatically (KeepAlive), so the button works after reboot");
  process.exit(status.status ?? 0);
}

main();
