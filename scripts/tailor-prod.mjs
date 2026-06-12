#!/usr/bin/env node
/** Foreground run — same stack as the LaunchAgent daemon. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const daemon = path.join(path.dirname(fileURLToPath(import.meta.url)), "tailor-daemon.mjs");
spawnSync(process.execPath, [daemon], { stdio: "inherit" });
