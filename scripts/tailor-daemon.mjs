#!/usr/bin/env node
/**
 * Permanent tailor stack: local sidecar + named Cloudflare tunnel.
 * Requires .env.tailor from npm run tailor:setup (stable TAILOR_ORIGIN hostname).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const envPath = path.join(ROOT, ".env.tailor");
const mongoEnvPath = path.join(ROOT, ".env");

dotenv.config({ path: mongoEnvPath });
dotenv.config({ path: envPath });

if (!fs.existsSync(envPath)) {
  console.error("Missing .env.tailor — run: npm run tailor:setup");
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const tunnelToken = env.CLOUDFLARED_TUNNEL_TOKEN;
if (!tunnelToken) {
  console.error("CLOUDFLARED_TUNNEL_TOKEN missing — run: npm run tailor:setup");
  process.exit(1);
}

let shuttingDown = false;
const children = new Map();

function runSupervised(label, cmd, args) {
  let restartMs = 2000;

  const start = () => {
    if (shuttingDown) return;
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...env, MONGO_URI: process.env.MONGO_URI || env.MONGO_URI },
      stdio: "inherit",
    });
    children.set(label, child);

    child.on("exit", (code, signal) => {
      children.delete(label);
      if (shuttingDown) return;
      console.error(`[${label}] exited ${code ?? 0}${signal ? ` (${signal})` : ""} — restarting in ${restartMs}ms`);
      setTimeout(start, restartMs);
      restartMs = Math.min(restartMs * 2, 60_000);
    });
  };

  start();
}

runSupervised("tailor", process.execPath, [
  "--env-file=.env.tailor",
  "--env-file=.env",
  "scripts/tailor-server.mjs",
]);
runSupervised("tunnel", "cloudflared", ["tunnel", "--no-autoupdate", "run", "--token", tunnelToken]);

function shutdown() {
  shuttingDown = true;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (env.TAILOR_ORIGIN) {
  console.log(`Atriveo tailor daemon — relay ${env.TAILOR_ORIGIN}`);
} else {
  console.log("Atriveo tailor daemon running");
}
