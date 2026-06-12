#!/usr/bin/env node
/**
 * One-time DNS for tailor-relay.atriveo.com → named tunnel.
 * Needs cloudflared origin cert: run `cloudflared tunnel login` once first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cert = path.join(os.homedir(), ".cloudflared/cert.pem");

if (!fs.existsSync(cert)) {
  console.error("Missing ~/.cloudflared/cert.pem");
  console.error("Run once:  cloudflared tunnel login");
  console.error("Then:      npm run tailor:dns");
  process.exit(1);
}

const r = spawnSync(
  "cloudflared",
  ["tunnel", "route", "dns", "atriveo-tailor", "tailor-relay.atriveo.com"],
  { stdio: "inherit", cwd: path.join(__dirname, "..") },
);
process.exit(r.status ?? 1);
