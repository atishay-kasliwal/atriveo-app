#!/usr/bin/env node
/**
 * LaunchAgent entrypoint for the Mongo compile worker.
 * Loads .env (MONGO_URI) and runs tailor-worker.mjs with restart on crash.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const envPath = path.join(ROOT, ".env");
const tailorEnvPath = path.join(ROOT, ".env.tailor");

dotenv.config({ path: envPath, override: true });
if (fs.existsSync(tailorEnvPath)) dotenv.config({ path: tailorEnvPath, override: true });

if (!process.env.MONGO_URI?.trim()) {
  console.error("Missing MONGO_URI in .env — worker cannot start.");
  console.error("Add MONGO_URI=... to atriveo-app/.env then: npm run tailor:worker:install");
  process.exit(1);
}

const workerScript = path.join(__dirname, "tailor-worker.mjs");
let child = null;
let stopping = false;

function startWorker() {
  const envFileArgs = [`--env-file=${envPath}`];
  if (fs.existsSync(tailorEnvPath)) envFileArgs.push(`--env-file=${tailorEnvPath}`);
  child = spawn(process.execPath, [...envFileArgs, workerScript], {
    cwd: ROOT,
    env: {
      ...process.env,
      MONGO_URI: process.env.MONGO_URI,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
    },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    const why = signal ? `signal ${signal}` : `exit ${code}`;
    console.error(`[tailor-worker] stopped (${why}) — restarting in 10s`);
    setTimeout(startWorker, 10_000);
  });
}

function shutdown() {
  stopping = true;
  if (child) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Atriveo tailor worker daemon — draining Mongo compile queue");
console.log(`  MONGO_URI: set · poll ${process.env.WORKER_POLL_MS || 30_000}ms`);
startWorker();
