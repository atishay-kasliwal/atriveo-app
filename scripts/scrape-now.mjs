#!/usr/bin/env node
/**
 * Terminal equivalent of the app's "Scrape now" button.
 *
 *   npm run scrape:now             scrape → jd export → feed deploy → resume queue
 *   npm run scrape:now -- --status just print current run state and exit
 *   npm run scrape:now -- --cancel stop the run in flight
 *
 * Goes through the same scrape-control module the sidecar uses, so the lock,
 * the run state file, and the log are shared — starting here and watching in
 * the browser (or the reverse) works.
 */
import {
  startScrape, cancelScrape, readScrapeState, isScrapeRunning, SCRAPE_PHASES,
} from "./scrape-control.mjs";

const C = { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
const args = new Set(process.argv.slice(2));

function phaseMark(status) {
  if (status === "ok") return `${C.green}✓${C.reset}`;
  if (status === "failed") return `${C.red}✗${C.reset}`;
  if (status === "cancelled") return `${C.yellow}⊘${C.reset}`;
  return `${C.dim}·${C.reset}`;
}

function printState(state) {
  const done = new Map((state.phases || []).map((p) => [p.name, p]));
  const line = SCRAPE_PHASES.map((name) => {
    const p = done.get(name);
    const mark = p ? phaseMark(p.status) : `${C.dim}○${C.reset}`;
    const active = state.status === "running" && state.phase === name;
    return `${mark} ${active ? C.bold + name + C.reset : name}`;
  }).join("  ");
  console.log(`  ${line}`);
}

if (args.has("--status")) {
  const state = readScrapeState();
  console.log(`${C.bold}Scrape${C.reset} · ${state.status}${state.runId ? ` · ${state.runId}` : ""}`);
  printState(state);
  process.exit(0);
}

if (args.has("--cancel")) {
  const r = cancelScrape();
  console.log(r.ok ? `${C.yellow}Cancelled${C.reset} pid ${r.pid}` : `${C.dim}${r.error}${C.reset}`);
  process.exit(r.ok ? 0 : 1);
}

const started = startScrape({
  skipResume: args.has("--skip-resume"),
  skipDeploy: args.has("--skip-deploy"),
});
if (!started.ok) {
  console.error(`${C.red}✗${C.reset} ${started.error}`);
  process.exit(1);
}
console.log(`${C.bold}Scrape started${C.reset} · ${started.runId}`);
console.log(`${C.dim}Ctrl-C detaches — the run keeps going. Stop it with: npm run scrape:now -- --cancel${C.reset}\n`);

let lastPhase = null;
const timer = setInterval(() => {
  const state = readScrapeState();
  if (state.phase !== lastPhase) {
    lastPhase = state.phase;
    printState(state);
  }
  if (state.status !== "running" && !isScrapeRunning()) {
    clearInterval(timer);
    const delta = state.jobsAfter != null && state.jobsBefore != null
      ? ` · jobs ${state.jobsBefore} → ${state.jobsAfter}`
      : "";
    const mark = state.status === "done" ? `${C.green}✓ done${C.reset}` : `${C.red}✗ ${state.status}${C.reset}`;
    console.log(`\n${mark}${delta}`);
    process.exit(state.status === "done" ? 0 : 1);
  }
}, 2000);
