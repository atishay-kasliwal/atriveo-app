// Regression tests against real PDFs: the resume template (scripts/ac-tex.mjs) is compiled with
// tectonic and read back with poppler, the way a parser would get it. Synthetic candidate, real
// template. Skipped when tectonic or poppler is not installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assembleAcResume } from "../../scripts/ac-tex.mjs";
import { extractPdf } from "../../scripts/ats/extract.mjs";
import { assessReadiness } from "../../scripts/ats/readiness.mjs";
import { expectedFromTex } from "../../scripts/ats/cli.mjs";
import { displayUrl, normalizeText } from "../../scripts/ats/patterns.mjs";
import { config } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/composition.json"), "utf8"));
const installed = (cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0
  || spawnSync(cmd, ["-v"], { encoding: "utf8" }).status === 0;
const skip = !installed("tectonic") || !installed("pdftotext") ? "tectonic and poppler are required" : false;

function compile(tex, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ats-${name}-`));
  fs.writeFileSync(path.join(dir, "resume.tex"), tex);
  const r = spawnSync("tectonic", ["-c", "minimal", "resume.tex"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return path.join(dir, "resume.pdf");
}

const newTex = () => assembleAcResume(fixture.composition, {
  headerTitle: fixture.headerTitle, skillsLines: fixture.skills, location: null, profile: fixture.profile,
});
const texArgs = (tex, macro) => [...tex.matchAll(new RegExp(`\\\\${macro}\\{([^}]*)\\}\\{([^}]*)\\}\\{([^}]*)\\}\\{([^}]*)\\}`, "g"))]
  .map((m) => m.slice(1).map((s) => s.replace(/--/g, "–").replace(/\$\|\$/g, "|")));
const VIEWS = ["layout", "reading", "raw"];
const flat = (s) => normalizeText(String(s).replace(/\s+/g, " "));

test("template source: education macro, title-only role lines, printed profile URLs", () => {
  const tex = newTex();
  assert.equal(texArgs(tex, "resumeEducation").length, 2);
  for (const [, , title] of texArgs(tex, "resumeSubheading")) assert.doesNotMatch(title, /\|/, `title line '${title}' carries more than the title`);
  assert.match(tex, /\\href\{https:\/\/www\.linkedin\.com\/in\/jordan-rivera\}\{linkedin\.com\/in\/jordan-rivera\}/);
  assert.doesNotMatch(tex, /jordanrivera\.dev/);
  assert.match(tex, /\\fontsize\{9\}\{11\}\\selectfont/);
  assert.match(tex, /jordan\.rivera@example\.com\} \\\\\n/, "profile links start a second contact line");
  assert.match(tex, /\\end\{center\}\\vspace\{-5pt\}/);
  // No links and no city: one contact line and no spacing change.
  const bare = assembleAcResume(fixture.composition, {
    headerTitle: "Backend Engineer", skillsLines: fixture.skills, location: null,
    profile: { ...fixture.profile, linkedin: "", github: "", portfolio: "", location: "" },
  });
  assert.doesNotMatch(bare, /\\end\{center\}\\vspace/);
});

test("generated PDF: one page, ATS Readiness PASS, and each fix holds in every extraction view", { skip }, () => {
  const tex = newTex();
  const x = extractPdf(compile(tex, "new"));
  const r = assessReadiness(x, config, { expected: expectedFromTex(tex) });

  assert.equal(x.pages, 1);
  assert.equal(r.status, "PASS", JSON.stringify(r.findings, null, 2));
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.expected, { experience: 3, education: 2, projects: 2 });
  assert.equal(r.parsed.experience.length, 3);
  assert.equal(r.parsed.education.length, 2);

  // 1. Education: each school's degree, city and dates come before the next school in every view.
  const schools = texArgs(tex, "resumeEducation");
  for (const view of VIEWS) {
    const text = flat(x.views[view]);
    const start = text.indexOf("Education");
    schools.forEach(([school, city, degree, dates], i) => {
      const at = text.indexOf(school, start);
      const next = i + 1 < schools.length ? text.indexOf(schools[i + 1][0], at + 1) : text.indexOf("Experience", at);
      for (const field of [degree, city, normalizeText(dates)]) {
        const p = text.indexOf(field, at);
        assert.ok(p > at && p < next, `${view}: '${field}' is not between '${school}' and what follows it`);
      }
    });
  }

  // 2. Titles: the parsed title is exactly the role title, and in every view the title's line holds
  //    nothing else except, in content-stream order, the location printed on the same row.
  const roles = texArgs(tex, "resumeSubheading");
  const locations = new Set(roles.map(([, , , loc]) => loc));
  roles.forEach(([, , title], i) => {
    assert.equal(r.parsed.experience[i].title, title);
    assert.equal(r.parsed.experience[i].title_extra, null);
  });
  for (const view of VIEWS) {
    const lines = x.views[view].slice(x.views[view].indexOf("Experience")).split("\n").map((l) => l.trim());
    for (const title of new Set(roles.map(([, , t]) => t))) {
      const titleLines = lines.filter((l) => l === title || l.startsWith(`${title} `));
      assert.ok(titleLines.length >= roles.filter(([, , t]) => t === title).length, `${view}: '${title}' lines missing`);
      for (const line of titleLines) {
        const rest = line.slice(title.length).trim();
        assert.ok(rest === "" || locations.has(rest), `${view}: title line '${line}' carries '${rest}'`);
      }
    }
  }

  // 3. URLs: every link's address is printed, so it survives in every view.
  const webLinks = x.links.filter((l) => !l.url.startsWith("mailto:"));
  assert.equal(webLinks.length, 2);
  for (const view of VIEWS) assert.ok(!x.views[view].includes("jordanrivera.dev"));
  for (const view of VIEWS) {
    for (const { url } of webLinks) assert.ok(x.views[view].includes(displayUrl(url)), `${view}: ${displayUrl(url)} missing`);
  }
});

test("legacy template PDF: the checks catch all three problems it had", { skip }, () => {
  const tex = fs.readFileSync(path.join(HERE, "fixtures/legacy-template.tex"), "utf8");
  const x = extractPdf(compile(tex, "legacy"));
  const r = assessReadiness(x, config, { expected: expectedFromTex(tex) });
  const count = (check) => r.findings.filter((f) => f.check === check).length;

  assert.equal(count("title_extra_text"), 3);
  assert.equal(count("link_url_hidden"), 3);
  assert.equal(count("entry_order"), 2);
  assert.ok(r.findings.filter((f) => f.check === "entry_order").every((f) => /^Education entry/.test(f.message)));
  assert.equal(r.status, "WARN");
});

 test("approved education alignment, fixed Wake Forest title, adaptive SBU and complete project stack", () => {
  const tex = newTex();
  assert.match(tex, /\\textbf\{#1\} & #4/);
  const roles = texArgs(tex, "resumeSubheading");
  assert.equal(roles.find(r => r[0] === "Stony Brook University")[2], fixture.headerTitle);
  assert.equal(roles.find(r => r[0].includes("Wake Forest"))[2], "AI/ML Engineer");
  const rich = assembleAcResume({ experience: [], projects: [{role: "atriveo", bullets: [{text: "Python FastAPI Docker PostgreSQL Redis AWS React"}]}]}, {profile: fixture.profile});
  for (const skill of ["Python", "FastAPI", "Docker", "PostgreSQL", "Redis", "AWS", "React", "TypeScript", "LangChain", "Cloudflare"]) assert.ok(rich.includes(skill), skill);
});
