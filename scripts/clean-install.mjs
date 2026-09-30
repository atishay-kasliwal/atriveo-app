#!/usr/bin/env node
/**
 * Wipes stale install state and performs a clean dependency install.
 *
 *   npm run clean:install
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const LOCAL_CACHE = path.join(ROOT, ".npm-cache");

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Atriveo — clean install\n");
console.log("→ Removing stale install state");
remove(NODE_MODULES);
remove(LOCAL_CACHE);

console.log("→ Running npm ci");
run("npm", ["ci"]);

console.log("\n✓ Clean install complete");
