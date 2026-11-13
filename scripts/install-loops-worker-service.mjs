#!/usr/bin/env node
/**
 * Install the Loops Mac worker as a macOS LaunchAgent (it keeps running and restarts itself), like the resume AI worker:
 * the worker and the few files it imports are copied to ~/.playatriveo/loops-worker/, so it does not depend on a git checkout.
 *
 *   npm run loops:worker:install              install (or update) and start it
 *   npm run loops:worker:install -- --uninstall
 *
 * Settings come from ~/.playatriveo/loops-worker.json, else the resume AI worker's resume-ai-worker.json ({ base, token }).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importClosure } from "./import-closure.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "com.atriveo.loops-worker";
const HOME = os.homedir();
export const paths = (home = HOME) => ({
  dir: path.join(home, ".playatriveo", "loops-worker"),
  plist: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
  log: path.join(home, ".playatriveo", `${LABEL}.log`),
});

export function plistFor({ node, entry, log, pathEnv }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${entry}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${pathEnv}</string></dict>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = paths();
  const uid = process.getuid?.() ?? 501;
  const launchctl = (...args) => spawnSync("launchctl", args, { stdio: "inherit" });
  if (process.argv.includes("--uninstall")) {
    launchctl("bootout", `gui/${uid}/${LABEL}`);
    fs.rmSync(p.plist, { force: true });
    console.log("Loops worker removed. Captures keep waiting; nothing is lost.");
    process.exit(0);
  }
  const settings = ["loops-worker.json", "resume-ai-worker.json"].map((f) => path.join(HOME, ".playatriveo", f)).find((f) => fs.existsSync(f));
  if (!settings) { console.error("\n✗ Neither ~/.playatriveo/loops-worker.json nor resume-ai-worker.json exists ({ base, token } for the Atriveo relay).\n"); process.exit(1); }
  for (const bin of ["codex"]) {
    const found = spawnSync("sh", ["-lc", `command -v ${bin}`], { encoding: "utf8" });
    if (found.status !== 0) console.warn(`! ${bin} was not found on your PATH. The worker needs the Codex CLI, signed in, to read captures.`);
  }
  for (const rel of importClosure("scripts/loops-mac-worker.mjs", ROOT)) {
    const to = path.join(p.dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), to);
  }
  fs.writeFileSync(path.join(p.dir, "package.json"), '{ "type": "module" }\n');
  fs.mkdirSync(path.dirname(p.plist), { recursive: true });
  fs.writeFileSync(p.plist, plistFor({ node: process.execPath, entry: path.join(p.dir, "scripts", "loops-mac-worker.mjs"), log: p.log, pathEnv: `${path.dirname(process.execPath)}:${path.join(HOME, ".local", "bin")}:/usr/bin:/bin` }));
  launchctl("bootout", `gui/${uid}/${LABEL}`);
  const r = launchctl("bootstrap", `gui/${uid}`, p.plist);
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`\nLoops worker installed and started. Settings: ${settings}\nLog: ${p.log}\nRemove it with: npm run loops:worker:install -- --uninstall`);
}
