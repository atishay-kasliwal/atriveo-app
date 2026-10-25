import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assembleAcResume } from "../../scripts/ac-tex.mjs";
import { scoreAndSaveRun, readSavedAts } from "../../scripts/ats/persist.mjs";
import { savedRuns } from "../../scripts/ats/backfill-cli.mjs";
import { resumeMatchOf } from "../../scripts/applications-analytics.mjs";
import { config } from "./helpers.mjs";

test("a saved ATS assessment is reusable and invalidates when the JD changes", { skip: spawnSync("tectonic", ["--version"], { encoding: "utf8" }).status !== 0 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ats-save-"));
  const dir = path.join(root, "2026-10-01", "Example", "run-1");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/composition.json", import.meta.url), "utf8"));
    const tex = assembleAcResume(fixture.composition, { headerTitle: fixture.headerTitle, skillsLines: fixture.skills, location: null, profile: fixture.profile });
    fs.writeFileSync(path.join(dir, "resume.tex"), tex);
    fs.writeFileSync(path.join(dir, "jd.txt"), "Backend Engineer\nRequirements:\n- Python experience required.\n");
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ role: "Backend Engineer" }));
    const built = spawnSync("tectonic", ["-c", "minimal", "resume.tex"], { cwd: dir, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    assert.deepEqual([...savedRuns(root)], [dir]);
    const first = scoreAndSaveRun(dir, { asOf: "2026-10-01", config, bank: [] });
    assert.equal(first.changed, true);
    assert.ok(first.saved.job_match);
    assert.equal(readSavedAts(dir).config_hash, config.hash);
    assert.equal(scoreAndSaveRun(dir, { asOf: "2026-10-01", config, bank: [] }).changed, false);
    fs.writeFileSync(path.join(dir, "jd.txt"), "Backend Engineer\nRequirements:\n- Python and Rust experience required.\n");
    const changed = scoreAndSaveRun(dir, { asOf: "2026-10-01", config, bank: [] });
    assert.equal(changed.changed, true);
    fs.writeFileSync(path.join(dir,"ats-score.json"),JSON.stringify({...changed.saved,algorithm_hash:"outdated"}));
    assert.equal(resumeMatchOf(path.join(dir, "resume.pdf")).score, null, "old-algorithm scores are stale");
    const refreshed=resumeMatchOf(path.join(dir, "resume.pdf"),{refresh:true});
    assert.equal(typeof refreshed.score,"number");
    assert.equal(refreshed.status,undefined);
    assert.notEqual(changed.saved.inputs.jd_sha256, first.saved.inputs.jd_sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
