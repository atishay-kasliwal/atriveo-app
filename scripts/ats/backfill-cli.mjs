#!/usr/bin/env node
// Re-score existing saved runs, including older flat and current nested date folders.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadAtsConfig } from "./config.mjs";
import { loadBank } from "./match-cli.mjs";
import { scoreAndSaveRun } from "./persist.mjs";

export function* savedRuns(root) {
  if (!fs.existsSync(root)) return;
  for (const day of fs.readdirSync(root).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir).sort()) {
      const one = path.join(dayDir, name);
      if (!fs.statSync(one).isDirectory()) continue;
      if (fs.existsSync(path.join(one, "jd.txt")) && fs.readdirSync(one).some((f) => /\.pdf$/i.test(f) && !/cover[ -]?letter/i.test(f))) { yield one; continue; }
      for (const child of fs.readdirSync(one).sort()) {
        const two = path.join(one, child);
        if (fs.statSync(two).isDirectory() && fs.existsSync(path.join(two, "jd.txt"))
          && fs.readdirSync(two).some((f) => /\.pdf$/i.test(f) && !/cover[ -]?letter/i.test(f))) yield two;
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const root = path.resolve(flag("--root") || path.join(os.homedir(), "Documents/tailored-resumes"));
  const asOf = flag("--as-of") || new Date().toISOString().slice(0, 10);
  const limit = Number(flag("--limit")) || Infinity;
  const dryRun = args.includes("--dry-run");
  const config = loadAtsConfig(), bank = loadBank();
  const result = { scanned: 0, written: 0, current: 0, unscorable: 0, errors: [] };
  for (const dir of savedRuns(root)) {
    if (result.scanned >= limit) break;
    result.scanned++;
    if (dryRun) continue;
    try {
      const { saved, changed } = scoreAndSaveRun(dir, { asOf, config, bank });
      if (changed) result.written++; else result.current++;
      if (!saved.job_match) result.unscorable++;
    } catch (e) { result.errors.push({ dir, message: String(e.message || e) }); }
    if (result.scanned % 100 === 0) console.error(`ATS backfill ${result.scanned} scanned · ${result.written} written · ${result.errors.length} errors`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
