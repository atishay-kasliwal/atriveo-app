// node --test --test-global-setup=tests/setup-tmp.mjs: every test run gets one temp folder, removed when the run
// ends. Tests (and the browsers and mongod they start) write under os.tmpdir(), which follows TMPDIR, so nothing is
// left in the system temp folder. A run that was killed leaves its folder; the next run removes those older than a day.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'atriveo-test-run-';
const DAY = 24 * 60 * 60 * 1000;
let run = null;

export function globalSetup() {
  const base = os.tmpdir();
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = path.join(base, name);
    try { if (Date.now() - fs.statSync(dir).mtimeMs > DAY) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* in use or gone */ }
  }
  run = fs.mkdtempSync(path.join(base, PREFIX));
  process.env.TMPDIR = run;
}

export function globalTeardown() {
  if (run) fs.rmSync(run, { recursive: true, force: true });
}
