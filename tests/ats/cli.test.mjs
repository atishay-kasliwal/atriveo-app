import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveInput } from "../../scripts/ats/cli.mjs";

test("run folders select the resume PDF even when a cover letter sorts first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-input-"));
  try {
    fs.writeFileSync(path.join(dir, "Atishay Kasliwal - Cover Letter.pdf"), "cover letter");
    fs.writeFileSync(path.join(dir, "Atishay Kasliwal.pdf"), "resume");
    fs.writeFileSync(path.join(dir, "resume.tex"), "\\section{Experience}\\resumeSubheading{A}{B}{C}{D}");
    assert.equal(resolveInput(dir).pdf, path.join(dir, "Atishay Kasliwal.pdf"));
    assert.equal(resolveInput(dir).expected.experience, 1);
    fs.unlinkSync(path.join(dir, "Atishay Kasliwal.pdf"));
    assert.throws(() => resolveInput(dir), /No resume PDF/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ambiguous run folders require an explicit PDF path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-input-"));
  try {
    fs.writeFileSync(path.join(dir, "first.pdf"), "first");
    fs.writeFileSync(path.join(dir, "second.pdf"), "second");
    assert.throws(() => resolveInput(dir), /Multiple resume PDFs/);
    assert.equal(resolveInput(path.join(dir, "second.pdf")).pdf, path.join(dir, "second.pdf"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
