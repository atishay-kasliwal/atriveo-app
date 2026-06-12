#!/usr/bin/env node
/**
 * Start tailor sidecar + cloudflared quick tunnel.
 * Parses the trycloudflare.com URL and updates TAILOR_ORIGIN on Cloudflare Pages.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const envPath = path.join(ROOT, ".env.tailor");

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

function run(label, cmd, args, onLine) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    onLine?.(text);
  };
  child.stdout.on("data", handle);
  child.stderr.on("data", handle);
  child.on("exit", (code) => {
    if (code) console.error(`${label} exited ${code}`);
  });
  return child;
}

function updateTailorOrigin(origin) {
  console.log("→ Updating TAILOR_ORIGIN on Cloudflare Pages:", origin);
  const wr = spawnSync(
    "npx",
    ["wrangler", "pages", "secret", "put", "TAILOR_ORIGIN", "--project-name", "atriveo-app"],
    { cwd: ROOT, input: origin, encoding: "utf8" },
  );
  if (wr.status !== 0) {
    console.error(wr.stderr || wr.stdout);
    return false;
  }
  return true;
}

let originPublished = false;
const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const tailor = run("tailor", "node", ["--env-file=.env.tailor", "scripts/tailor-server.mjs"]);
const tunnel = run("tunnel", "cloudflared", ["tunnel", "--url", "http://127.0.0.1:8787", "--no-autoupdate"], (line) => {
  const m = line.match(urlRe);
  if (m && !originPublished) {
    originPublished = true;
    const origin = m[0].replace(/\/$/, "");
    if (updateTailorOrigin(origin)) {
      console.log("\n✓ Production relay live at", origin);
      console.log("  Use Tailor selected on https://application.atriveo.com\n");
    }
  }
});

function shutdown() {
  tailor.kill("SIGTERM");
  tunnel.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting tailor sidecar + quick tunnel…");
console.log("Keep this running while tailoring from application.atriveo.com");
