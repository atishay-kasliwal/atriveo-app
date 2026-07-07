#!/usr/bin/env node
/**
 * One-shot prep for "apply tomorrow" — sync JDs, enqueue compiles, build UI, verify health.
 *
 *   npm run pipeline:ready
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

console.log("Atriveo — prepare for apply tomorrow\n");

run("Sync JD buckets from Mongo", process.execPath, ["scripts/export-job-descriptions.mjs"]);
run("Enqueue eligible jobs for worker", process.execPath, ["--env-file=.env", "scripts/resume-enqueue.mjs"]);
run("Build dashboard", "npm", ["run", "build"]);
run("Restart sidecar (pick up routes + MONGO_URI)", "npm", ["run", "tailor:restart"]);
run("Restart compile worker", "npm", ["run", "tailor:worker:restart"]);

console.log("\n→ Final status");
spawnSync(process.execPath, ["scripts/pipeline-status.mjs"], { cwd: ROOT, stdio: "inherit" });

console.log(`
✓ Ready. Tomorrow:
  1. Open Dashboard → filter Tailored: Done
  2. PDF opens resume on your Mac · Apply opens LinkedIn (tracker syncs automatically)
  3. Keep Mac awake overnight for hourly compiles
`);
