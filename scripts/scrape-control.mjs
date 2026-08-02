/**
 * On-demand scrape control for the tailor sidecar.
 *
 * The scrape used to run hourly from a LaunchAgent. It now runs only when the
 * app asks, so something has to own "start it / is it still going / stop it"
 * from inside the sidecar the browser can already reach through the Cloudflare
 * relay. That is this module.
 *
 * The child is job-pipeline/run-pipeline-and-export.sh. It owns the run state
 * file; we only spawn it, read that file back, and reconcile it against whether
 * the pid is actually alive — a laptop that sleeps mid-run leaves a state file
 * saying "running" behind a process that no longer exists.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HOME = os.homedir();

export const JOB_PIPELINE_DIR =
  process.env.JOB_PIPELINE_DIR?.trim() || path.join(HOME, "job-pipeline");
export const SCRAPE_SCRIPT = path.join(JOB_PIPELINE_DIR, "run-pipeline-and-export.sh");

const STATE_FILE = process.env.ATRIVEO_SCRAPE_STATE?.trim() || "/tmp/atriveo_scrape_state.json";
const LOG_FILE = process.env.ATRIVEO_SCRAPE_LOG?.trim() || "/tmp/atriveo_pipeline.log";
const LOCK_FILE = process.env.ATRIVEO_SCRAPE_LOCK?.trim() || "/tmp/atriveo_scrape.lock";

/** Ordered so the UI can render a fixed set of steps before any of them start. */
export const SCRAPE_PHASES = ["scrape", "jd_export", "feed_deploy", "resume_queue"];

function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else — still alive.
    return e.code === "EPERM";
  }
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function lockPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Pid of a run we spawned, tracked in memory.
 *
 * The lock file is written by the bash script itself, so there is a window of a
 * few hundred ms after spawn where the lock does not exist yet. Without this,
 * an impatient double-click starts two scrapes that then fight over the venv
 * and the Mongo session. Cleared implicitly: a dead pid fails the liveness test.
 */
let spawnedPid = null;

/** True while a run actually holds the lock, or one we just spawned is alive. */
export function isScrapeRunning() {
  const locked = lockPid();
  if (locked != null && pidAlive(locked)) return true;
  return spawnedPid != null && pidAlive(spawnedPid);
}

/**
 * Current run state, reconciled with reality.
 *
 * A state file claiming "running" with a dead pid means the run died without
 * getting to write a terminal state (sleep, force quit, OOM). Report that as
 * `interrupted` rather than leaving a spinner up forever in the UI.
 */
export function readScrapeState() {
  const state = readJson(STATE_FILE);
  if (!state) {
    return { status: "idle", phase: null, phases: [], runId: null, log: LOG_FILE };
  }
  if (state.status === "running" && !pidAlive(state.pid)) {
    return {
      ...state,
      status: "interrupted",
      error: "Run stopped unexpectedly — the Mac may have slept or the process was killed.",
    };
  }
  return state;
}

const HISTORY_FILE =
  process.env.ATRIVEO_SCRAPE_HISTORY?.trim() || path.join(JOB_PIPELINE_DIR, "output", "scrape_history.json");

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * How long a full run usually takes, from the last 20 successful runs.
 *
 * Median rather than mean: one run that stalled on a slow LinkedIn response for
 * 40 minutes should not drag every future estimate with it. Returns null with
 * no history, and the UI then says nothing rather than inventing a number.
 */
export function readScrapeEstimate() {
  const history = readJson(HISTORY_FILE);
  if (!Array.isArray(history) || !history.length) {
    return { totalSec: null, samples: 0, byPhase: {} };
  }
  const totals = history.map((h) => h?.durationSec).filter((n) => Number.isFinite(n) && n > 0);

  const byPhase = {};
  for (const name of SCRAPE_PHASES) {
    const durations = history
      .flatMap((h) => (Array.isArray(h?.phases) ? h.phases : []))
      .filter((p) => p?.name === name && Number.isFinite(p.durationSec))
      .map((p) => p.durationSec);
    const m = median(durations);
    if (m != null) byPhase[name] = m;
  }

  return { totalSec: median(totals), samples: totals.length, byPhase };
}

/** Last `lines` lines of the pipeline log, for the UI's log drawer. */
export function tailScrapeLog(lines = 40) {
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf8");
    const all = raw.split("\n").filter(Boolean);
    return all.slice(-Math.max(1, Math.min(lines, 500)));
  } catch {
    return [];
  }
}

/**
 * Spawn a run. Returns { ok, runId } or { ok: false, code, error }.
 *
 * `detached` puts the child in its own process group, which does double duty:
 * the run survives a sidecar restart, and cancel can signal the whole group so
 * the python scrape dies with the shell wrapper instead of orphaning.
 */
export function startScrape({ skipResume = false, skipDeploy = false } = {}) {
  if (!fs.existsSync(SCRAPE_SCRIPT)) {
    return {
      ok: false,
      code: 500,
      error: `Scrape script not found at ${SCRAPE_SCRIPT}. Set JOB_PIPELINE_DIR in atriveo-app/.env.`,
    };
  }
  if (isScrapeRunning()) {
    const current = readScrapeState();
    return {
      ok: false,
      code: 409,
      error: "A scrape is already running.",
      runId: current.runId ?? null,
      state: current,
    };
  }

  const runId = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  const args = [SCRAPE_SCRIPT, "--run-id", runId];
  if (skipResume) args.push("--skip-resume");
  if (skipDeploy) args.push("--skip-deploy");

  const child = spawn("/bin/bash", args, {
    cwd: JOB_PIPELINE_DIR,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      JOB_PIPELINE_DIR,
      ATRIVEO_APP_DIR: process.env.ATRIVEO_APP_DIR || path.join(HOME, "atriveo-app"),
    },
  });
  child.unref();
  spawnedPid = child.pid ?? null;

  // The script writes the real state file within a second, but the UI polls
  // immediately after this returns. Seed a state so the first poll is not a
  // stale "done" from the previous run.
  const seeded = {
    runId,
    status: "running",
    phase: "starting",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    phases: [],
    log: LOG_FILE,
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(seeded));
  } catch {
    /* the script will write it a beat later */
  }

  return { ok: true, runId, state: seeded };
}

/** SIGTERM the run's process group so the shell wrapper can mark it cancelled. */
export function cancelScrape() {
  // Same lock-file window as isScrapeRunning: cancelling immediately after a
  // start must still find the process.
  let pid = lockPid();
  if (pid == null || !pidAlive(pid)) pid = spawnedPid;
  if (pid == null || !pidAlive(pid)) {
    return { ok: false, code: 409, error: "No scrape is running." };
  }
  try {
    // Negative pid = the whole group, so the python child dies too.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch (e) {
      return { ok: false, code: 500, error: String(e.message || e) };
    }
  }
  return { ok: true, pid };
}
