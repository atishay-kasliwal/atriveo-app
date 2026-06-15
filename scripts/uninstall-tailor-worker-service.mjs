#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LABEL = "com.atriveo.tailor-worker";
const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const uid = os.userInfo().uid;

spawnSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "inherit" });
if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
console.log("✓ Atriveo tailor worker service removed");
