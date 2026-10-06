import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resumeDownloadPath } from "../../scripts/resume-download.mjs";

test("resume downloads use ET date, company, posting/version identity and an exact filename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-download-"));
  try {
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ company: "Acme / Inc", role: "Software Engineer", url: "https://jobs.example/1" }));
    const pdf = path.join(dir, "old-name.pdf");
    const now = new Date("2026-10-07T02:00:00Z");
    const name = resumeDownloadPath(pdf, Buffer.from("%PDF-1.4"), now);
    assert.match(name, /^2026-10-06_Acme-Inc_Software-Engineer-[a-f0-9]{12}-[a-f0-9]{12}\/Atishay Kasliwal\.pdf$/);
    assert.equal(resumeDownloadPath(pdf, Buffer.from("%PDF-1.4"), now), name);
    assert.notEqual(resumeDownloadPath(pdf, Buffer.from("new version"), now), name);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ company: "Acme / Inc", role: "Software Engineer", url: "https://jobs.example/2" }));
    assert.notEqual(resumeDownloadPath(pdf, Buffer.from("%PDF-1.4"), now), name);
    fs.rmSync(path.join(dir, "meta.json"));
    const general = path.join(dir, "general", "AI Engineer", "Atishay Kasliwal.pdf");
    assert.match(resumeDownloadPath(general, Buffer.from("pdf"), now), /^2026-10-06_general_AI-Engineer-.+\/Atishay Kasliwal\.pdf$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
