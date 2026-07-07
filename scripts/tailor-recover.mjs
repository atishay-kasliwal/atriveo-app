#!/usr/bin/env node
/**
 * Auto-repair the local tailor stack (Ollama + sidecar + tunnel).
 * Run manually:  npm run tailor:recover
 * Triggered by:  POST /recover on tailor-server, or queue auto-heal from the web app.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_PATH = path.join(os.homedir(), "Library/Logs/atriveo-tailor-recover.log");
const LABEL = "com.atriveo.tailor";
const DRIVE_ROOT = "/Volumes/Kasliwal v2";
const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(DRIVE_ROOT, "tailored-resumes");
const USES_EXTERNAL_DRIVE = OUT_ROOT.startsWith("/Volumes/");
const SIDEcar = "http://127.0.0.1:8787/health";
const OLLAMA_TAGS = "http://127.0.0.1:11434/api/tags";
const DEFAULT_MODEL = "gemma4:12b";

function log(line) {
  const row = `[${new Date().toISOString()}] ${line}`;
  console.log(row);
  try {
    fs.appendFileSync(LOG_PATH, `${row}\n`);
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function loadEnvToken() {
  const envPath = path.join(ROOT, ".env.tailor");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (line.startsWith("TAILOR_TOKEN=")) return line.slice("TAILOR_TOKEN=".length).trim();
  }
  return "";
}

async function fetchJson(url, ms = 8000) {
  const res = await fetch(url, {
    headers: loadEnvToken() ? { "X-Tailor-Token": loadEnvToken() } : {},
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function restartLaunchAgent() {
  const uid = process.getuid();
  log("Restarting LaunchAgent (sidecar + tunnel)…");
  const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${LABEL}`], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr?.trim() || `launchctl exit ${r.status}`);
  }
}

function ollamaStop(model) {
  log(`Unloading Ollama model · ${model}`);
  const r = spawnSync("ollama", ["stop", model], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0 && r.status != null) {
    log(`ollama stop returned ${r.status} — ${(r.stderr || r.stdout || "").trim()}`);
  }
}

// Unload every currently-loaded model (from /api/ps), not just the configured
// default — a stuck model from a prior run (e.g. after a model switch) may differ
// from DEFAULT_MODEL and would otherwise stay pinned in VRAM/RAM.
async function ollamaUnloadAll() {
  let loaded = [];
  try {
    const ps = await fetchJson("http://127.0.0.1:11434/api/ps", 5000);
    loaded = (ps.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    /* ps unavailable — fall back to default */
  }
  if (!loaded.length) loaded = [DEFAULT_MODEL];
  for (const m of loaded) ollamaStop(m);
}

export async function runTailorRecovery(reason = "manual") {
  const steps = [];
  log(`── Recovery start · reason: ${reason} ──`);

  const outputMissing = USES_EXTERNAL_DRIVE ? !fs.existsSync(DRIVE_ROOT) : !fs.existsSync(OUT_ROOT);
  if (outputMissing) {
    const msg = USES_EXTERNAL_DRIVE
      ? `External drive not mounted (${DRIVE_ROOT}) — plug in drive and retry`
      : `Output root missing (${OUT_ROOT}) — create it and retry`;
    log(`✗ ${msg}`);
    return { ok: false, steps, error: msg };
  }
  steps.push("drive");

  let ollamaOk = false;
  try {
    await fetchJson(OLLAMA_TAGS, 5000);
    ollamaOk = true;
    log("✓ Ollama responding");
    steps.push("ollama-ok");
  } catch {
    log("✗ Ollama not responding on :11434");
  }

  const ollamaReason = /fetch failed|disconnected|ollama|ai-failed|timeout/i.test(reason);
  if (!ollamaOk || ollamaReason) {
    await ollamaUnloadAll();
    await sleep(2000);
    try {
      await fetchJson(OLLAMA_TAGS, 8000);
      ollamaOk = true;
      log("✓ Ollama responding after model unload");
      steps.push("ollama-unstick");
    } catch {
      log("✗ Ollama still down — open the Ollama app or run: ollama serve");
    }
  }

  let sidecarOk = false;
  try {
    const data = await fetchJson(SIDEcar, 5000);
    sidecarOk = Boolean(data.ok && data.driveMounted);
    if (sidecarOk) {
      log("✓ Local sidecar healthy");
      steps.push("sidecar-ok");
    }
  } catch {
    log("✗ Local sidecar not healthy");
  }

  const needsRestart = !sidecarOk || /relay|502|503|unreachable|offline/i.test(reason);
  if (needsRestart) {
    try {
      restartLaunchAgent();
      steps.push("launchagent-restart");
      await sleep(4000);
      const data = await fetchJson(SIDEcar, 12_000);
      sidecarOk = Boolean(data.ok && data.driveMounted);
      if (sidecarOk) log("✓ Sidecar healthy after restart");
      else log("✗ Sidecar still unhealthy after restart");
    } catch (e) {
      log(`✗ LaunchAgent restart failed — ${e.message}`);
    }
  }

  let relayOk = false;
  try {
    const r = spawnSync("npm", ["run", "tailor:check"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 45_000,
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (process.env.PATH || "") },
    });
    relayOk = r.status === 0;
    if (relayOk) {
      log("✓ End-to-end relay check passed");
      steps.push("relay-ok");
    } else {
      log("✗ Relay check failed — see output above");
      if (r.stdout) log(r.stdout.trim().split("\n").slice(-4).join("\n"));
    }
  } catch (e) {
    log(`✗ Relay check error — ${e.message}`);
  }

  const ok = ollamaOk && sidecarOk;
  log(`── Recovery ${ok ? "done" : "partial"} · steps: ${steps.join(", ") || "none"} ──`);
  return { ok, steps, ollamaOk, sidecarOk, relayOk };
}

if (process.argv[1]?.includes("tailor-recover.mjs")) {
  const reason = argValue("reason") || process.argv.slice(2).join(" ") || "manual";
  runTailorRecovery(reason)
    .then((result) => process.exit(result.ok ? 0 : 1))
    .catch((e) => {
      log(`Fatal: ${e.message}`);
      process.exit(1);
    });
}
