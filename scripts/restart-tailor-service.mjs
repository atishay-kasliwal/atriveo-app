#!/usr/bin/env node
/**
 * Restart the tailor LaunchAgent so it reloads the current code.
 *
 * Node loads scripts once at startup — after editing scripts/tailor-*.mjs the
 * running daemon keeps the OLD code (this silently caused "model output
 * truncated" failures before the num_ctx fix was picked up). Run this after any
 * server-side change:  npm run tailor:restart
 */
import { spawnSync } from "node:child_process";

const LABEL = "com.atriveo.tailor";
const uid = process.getuid();

const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${LABEL}`], { stdio: "inherit" });
if (r.status === 0) {
  console.log(`Restarted ${LABEL} — now running current code.`);
  console.log("Verify: npm run tailor:check");
} else {
  console.error(`Could not restart ${LABEL}. Is it installed? Run: npm run tailor:install`);
  process.exit(1);
}
