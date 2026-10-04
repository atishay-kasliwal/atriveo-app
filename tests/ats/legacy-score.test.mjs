import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAtsFromDir } from "../../scripts/tailor-ac.mjs";

test("legacy score labels survive the small-file path and report fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-legacy-"));
  try {
    fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ oracle: { oracle_score: 46.8 }, resume_confidence_score: 78.1 }));
    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify({ pipeline: "ac", ats_before: 47, ats_after: 78, resume_confidence_score: 78.1 }));
    assert.equal(readAtsFromDir(dir), "47→78");
    fs.unlinkSync(path.join(dir, "optimizer.json"));
    assert.equal(readAtsFromDir(dir), "47→78");
    fs.unlinkSync(path.join(dir, "report.json"));
    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify({ ats_before: 51.5, ats_after: 69.2 }));
    assert.equal(readAtsFromDir(dir), "51.5→69.2");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
