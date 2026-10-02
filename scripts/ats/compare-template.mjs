#!/usr/bin/env node
// Rebuild a saved tailoring run with the current template, then compare PDF extraction and
// ATS Readiness with the saved resume. This is a Phase 1 template audit, not a Job Match score.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assembleAcResume } from "../ac-tex.mjs";
import { loadAtsConfig } from "./config.mjs";
import { extractPdf } from "./extract.mjs";
import { PHONE_RE } from "./patterns.mjs";
import { assessReadiness } from "./readiness.mjs";
import { expectedFromTex, formatReadiness, readinessFor } from "./cli.mjs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outRoot = outAt >= 0 && args[outAt + 1] && !args[outAt + 1].startsWith("--")
  ? path.resolve(args[outAt + 1]) : null;
const runs = args.filter((_, i) => outAt < 0 || (i !== outAt && i !== outAt + 1));
if (!runs.length || (outAt >= 0 && !outRoot)) {
  console.error("Usage: node scripts/ats/compare-template.mjs <run-dir> [...] [--out <directory>]");
  process.exit(1);
}

const config = loadAtsConfig();
const rows = [];
function savedProfile(tex, title) {
  const header = tex.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/)?.[1] || "";
  const urls = [...header.matchAll(/\\href\{(https?:\/\/[^}]+)\}/g)].map((m) => m[1]);
  return {
    name: header.match(/\\scshape\s+([^}]+)\}/)?.[1]?.trim() || "",
    title,
    phone: header.match(PHONE_RE)?.[0] || "",
    email: header.match(/\\href\{mailto:([^}]+)\}/)?.[1] || "",
    location: header.match(/\$\|\$\s*([^\n$\\|}]+?)\s*$/)?.[1]?.trim() || "",
    linkedin: urls.find((url) => /linkedin\.com/i.test(url)) || "",
    github: urls.find((url) => /github\.com/i.test(url)) || "",
    portfolio: urls.find((url) => !/linkedin\.com|github\.com/i.test(url)) || "",
  };
}
for (const [index, input] of runs.entries()) {
  const runDir = path.resolve(input);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ats-compare-"));
  try {
    const savedTex = fs.readFileSync(path.join(runDir, "resume.tex"), "utf8");
    const report = JSON.parse(fs.readFileSync(path.join(runDir, "report.json"), "utf8"));
    const before = readinessFor(runDir, config);
    const tex = assembleAcResume(report.composition, {
      headerTitle: report.header_title,
      skillsLines: report.skills,
      location: null,
      profile: savedProfile(savedTex, report.header_title),
    });
    fs.writeFileSync(path.join(temp, "resume.tex"), tex);
    const built = spawnSync("tectonic", ["-c", "minimal", "resume.tex"], { cwd: temp, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`Tectonic failed for ${runDir}: ${(built.stderr || built.stdout || "").slice(-500)}`);
    const extraction = extractPdf(path.join(temp, "resume.pdf"));
    const after = assessReadiness(extraction, config, { expected: expectedFromTex(tex) });
    const row = {
      run: runDir,
      before: { status: before.result.status, parseability: before.result.parseability, pages: before.extraction.pages, findings: before.result.findings.map((f) => f.check) },
      after: { status: after.status, parseability: after.parseability, pages: extraction.pages, findings: after.findings.map((f) => f.check) },
      parsed: {
        experience: after.parsed.experience.map((e) => ({ company: e.company, title: e.title, dates: e.dates?.text ?? null })),
        education: after.parsed.education.map((e) => ({ institution: e.institution, degree: e.degree, dates: e.dates?.text ?? null })),
        projects: after.parsed.projects.map((e) => ({ name: e.name, dates: e.dates?.text ?? null })),
      },
    };
    rows.push(row);
    if (outRoot) {
      const name = `${String(index + 1).padStart(2, "0")}-${path.basename(runDir).replace(/[^a-zA-Z0-9-]+/g, "-")}`;
      const out = path.join(outRoot, name);
      fs.mkdirSync(out, { recursive: true });
      fs.copyFileSync(before.extraction.file, path.join(out, "before.pdf"));
      fs.copyFileSync(path.join(temp, "resume.pdf"), path.join(out, "after.pdf"));
      fs.writeFileSync(path.join(out, "before.txt"), formatReadiness(before.result));
      fs.writeFileSync(path.join(out, "after.txt"), formatReadiness(after));
      for (const view of ["layout", "reading", "raw"]) {
        fs.writeFileSync(path.join(out, `before.${view}.txt`), before.extraction.views[view]);
        fs.writeFileSync(path.join(out, `after.${view}.txt`), extraction.views[view]);
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ config_hash: config.hash, results: rows }, null, 2));
