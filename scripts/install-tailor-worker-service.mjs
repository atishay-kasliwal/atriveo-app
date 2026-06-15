#!/usr/bin/env node
/**
 * Install macOS LaunchAgent for the Mongo compile worker (no browser tab required).
 *
 *   npm run tailor:worker:install
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LABEL = "com.atriveo.tailor-worker";
const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const logPath = path.join(os.homedir(), "Library/Logs/atriveo-tailor-worker.log");
const nodeBin = process.execPath;
const daemon = path.join(ROOT, "scripts/tailor-worker-daemon.mjs");
const envPath = path.join(ROOT, ".env");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function readMongoUri() {
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^MONGO_URI=(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.MONGO_URI || "";
}

if (!readMongoUri()) {
  console.error("\n✗ MONGO_URI not found in .env");
  console.error("  Add MONGO_URI=... to atriveo-app/.env and re-run tailor:worker:install\n");
  process.exit(1);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${daemon}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;

fs.mkdirSync(path.dirname(plistPath), { recursive: true });
fs.writeFileSync(plistPath, plist);

const uid = os.userInfo().uid;
spawnSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "pipe" });
run("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
run("launchctl", ["enable", `gui/${uid}/${LABEL}`]);
run("launchctl", ["kickstart", "-k", `gui/${uid}/${LABEL}`]);

console.log("\n✓ com.atriveo.tailor-worker installed");
console.log("  Drains Mongo compile queue without Dashboard tab open");
console.log("  Logs:", logPath);
console.log("  Worker ID: set WORKER_ID in .env or use ~/.atriveo/worker-id (unique per machine)");
console.log("  Enqueue after scrape: hourly pipeline runs resume:enqueue automatically");
console.log("  Uninstall: npm run tailor:worker:uninstall");
