#!/usr/bin/env node
/**
 * Install macOS LaunchAgent so tailor + tunnel start at login and stay running.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LABEL = "com.atriveo.tailor";
const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const logPath = path.join(os.homedir(), "Library/Logs/atriveo-tailor.log");
const nodeBin = process.execPath;
const daemon = path.join(ROOT, "scripts/tailor-daemon.mjs");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(ROOT, ".env.tailor"))) {
  console.log("→ Running tailor:setup first…");
  run(process.execPath, [path.join(ROOT, "scripts/setup-tailor-tunnel.mjs")]);
}

const cert = path.join(os.homedir(), ".cloudflared/cert.pem");
if (fs.existsSync(cert)) {
  console.log("→ Ensuring DNS for tailor-relay.atriveo.com…");
  spawnSync(process.execPath, [path.join(ROOT, "scripts/tailor-dns.mjs")], { stdio: "inherit" });
} else {
  console.warn("\n⚠ DNS not configured yet. After install, run once:");
  console.warn("    cloudflared tunnel login");
  console.warn("    npm run tailor:dns\n");
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

console.log("\n✓ Atriveo tailor service installed");
console.log("  Logs:", logPath);
console.log("  Relay: https://tailor-relay.atriveo.com (after DNS step)");
console.log("  Uninstall: npm run tailor:uninstall");
