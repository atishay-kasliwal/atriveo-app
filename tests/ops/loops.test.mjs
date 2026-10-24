import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loops-"));
const stub = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`); fs.chmodSync(f, 0o755); return f; };
const run = (script, env) => spawnSync("sh", [script], { env: { ...process.env, LOOP_ONCE: "1", ...env }, encoding: "utf8", timeout: 20_000 });

test("scrape loop: prune, then the scrape with the configured arguments; exit code is the scrape's", () => {
  const log = path.join(dir, "py.log");
  const py = stub("py-ok", `echo "$@" >> ${log}; exit 0`);
  const r = run("deploy/scraper/loop.sh", { PY: py, SCRAPE_ARGS: "--pipeline important" });
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), ["-m job_pipeline.prune", "-m job_pipeline.main --pipeline important"]);
  assert.match(r.stdout, /scrape cycle ok/);
});

test("scrape loop: a failed scrape reports the failure, waits the retry time, and still ran prune", () => {
  const py = stub("py-fail", `case "$*" in *prune*) exit 0;; *) exit 3;; esac`);
  const r = run("deploy/scraper/loop.sh", { PY: py, RETRY_MIN: "7" });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /FAILED \(exit 3\); retry in 420s/);
});

test("scrape loop: a failing prune does not stop the scrape", () => {
  const log = path.join(dir, "py2.log");
  const py = stub("py-prune-fail", `echo "$@" >> ${log}; case "$*" in *prune*) exit 1;; *) exit 0;; esac`);
  const r = run("deploy/scraper/loop.sh", { PY: py });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /prune failed \(continuing\)/);
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2);
});

test("after-scrape loop: runs the three steps in order and one failing step does not stop the rest", () => {
  const log = path.join(dir, "node.log");
  const node = stub("node-stub", `echo "$(basename $1)" >> ${log}; case "$1" in *board-match*) exit 5;; *) exit 0;; esac`);
  const r = run("deploy/scraper/after-scrape.sh", { NODE: node });
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), ["linkedin-apply-type.mjs", "linkedin-board-match.mjs", "resume-enqueue.mjs", "repair-resume-paths.mjs"]);
  assert.match(r.stdout, /linkedin-board-match failed \(exit 5\)/);
});
