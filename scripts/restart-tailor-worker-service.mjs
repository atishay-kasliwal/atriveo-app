#!/usr/bin/env node
/** Restart the compile worker LaunchAgent. */
import os from "node:os";
import { spawnSync } from "node:child_process";

const LABEL = "com.atriveo.tailor-worker";
const uid = os.userInfo().uid;
const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${LABEL}`], { stdio: "inherit" });
process.exit(r.status ?? 0);
