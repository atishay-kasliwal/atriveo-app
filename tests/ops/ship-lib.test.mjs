import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const sh = (script) => spawnSync("bash", ["-c", `. scripts/ship-lib.sh; ${script}`], { encoding: "utf8" });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("known_version: the file as it is now, and an older committed version, are known; an edited one is not", () => {
  const now = spawnSync("git", ["show", "HEAD:data/ats/skills.yaml"], { encoding: "utf8" }).stdout;
  assert.equal(sh(`known_version data/ats/skills.yaml ${sha(now)}`).status, 0);
  const oldest = spawnSync("bash", ["-c", "c=$(git log --format=%H -- data/ats/skills.yaml | tail -1); git show $c:data/ats/skills.yaml"], { encoding: "utf8" }).stdout;
  assert.equal(sh(`known_version data/ats/skills.yaml ${sha(oldest)}`).status, 0, "the first version ever committed is still a known version");
  assert.equal(sh(`known_version data/ats/skills.yaml ${sha(now + "# edited on the server\n")}`).status, 1);
});

test("the scoring bundle lists the scoring config and code, and none of the validation tooling", () => {
  const files = sh("bundle_files").stdout.trim().split("\n");
  for (const f of ["data/ats/scoring.yaml", "data/ats/skills.yaml", "data/ats/candidate.yaml", "scripts/ats/fit.mjs", "scripts/ats/match.mjs"]) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => f.includes("validate")));
});
