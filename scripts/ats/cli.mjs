#!/usr/bin/env node
/**
 * ATS Readiness from the command line.
 *
 *   npm run ats:readiness -- <resume.pdf | run-dir>        report for one resume
 *   npm run ats:readiness -- <…> --json                    the full result as JSON
 *   npm run ats:readiness -- <…> --views                   also print the three extracted texts
 *   npm run ats:readiness -- --baseline [--root <dir>] [--since YYYY-MM-DD] [--limit N]
 *                                                           every tailored resume on disk, summarized
 *
 * A run dir is a tailoring output folder (resume.tex + the PDF); its resume.tex says how many
 * positions, schools and projects the resume was built with, which the parse is checked against.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAtsConfig } from "./config.mjs";
import { extractPdf } from "./extract.mjs";
import { assessReadiness } from "./readiness.mjs";

/** Entries a generated resume.tex was built with, per section. */
export function expectedFromTex(tex) {
  const body = String(tex || "").split("% ==== JD:")[0];
  const section = (name) => body.split(`\\section{${name}}`)[1]?.split("\\section{")[0] ?? "";
  const count = (s, re) => (s.match(re) || []).length;
  return {
    experience: count(section("Experience"), /\\resumeSubheading\{/g),
    education: count(section("Education"), /\\resume(?:Subheading|Education)\{/g),
    projects: count(section("Projects"), /\\resumeProjectHeading\{/g),
  };
}

export function resolveInput(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { pdf: target, expected: null };
  const pdfs = fs.readdirSync(target).filter((f) => /\.pdf$/i.test(f));
  const preferred = ["Atishay Kasliwal.pdf", "resume.pdf"].find((name) => pdfs.includes(name));
  const resumes = pdfs.filter((name) => !/cover[ -]?letter/i.test(name));
  const pdf = preferred || (resumes.length === 1 ? resumes[0] : null);
  if (!pdf) {
    throw new Error(resumes.length > 1
      ? `Multiple resume PDFs in ${target}; pass the intended PDF path explicitly`
      : `No resume PDF in ${target}`);
  }
  const texPath = path.join(target, "resume.tex");
  return { pdf: path.join(target, pdf), expected: fs.existsSync(texPath) ? expectedFromTex(fs.readFileSync(texPath, "utf8")) : null };
}

export function readinessFor(target, config = loadAtsConfig()) {
  const { pdf, expected } = resolveInput(target);
  const extraction = extractPdf(pdf);
  return { extraction, result: assessReadiness(extraction, config, { expected }) };
}

const ICON = { critical: "✗", warning: "⚠", info: "ℹ" };

export function formatReadiness(r) {
  const out = [];
  out.push(`${r.input.file}`);
  out.push(`ATS READINESS: ${r.status}    Parseability ${r.parseability}/${r.max}`);
  out.push("Our deterministic parse check — not the score any employer's ATS produces.");
  if (r.critical.length) {
    out.push("", "CRITICAL");
    for (const m of r.critical) out.push(`  ✗ ${m}`);
  }
  out.push("");
  for (const p of r.passed) out.push(`  ✓ ${p.label}`);
  for (const f of r.findings) {
    out.push(`  ${ICON[f.severity]} ${f.penalty ? `−${f.penalty}`.padEnd(4) : "    "} ${f.message}${f.note ? ` (${f.note})` : ""}`);
    for (const e of f.evidence) out.push(`          · ${e}`);
  }
  const a = r.accounting;
  out.push("", `Accounting: ${a.start}${a.penalties.map((p) => ` − ${p.points} ${p.check}`).join("")} = ${a.parseability}${a.floor_applied ? " (floor)" : ""}`);
  out.push(`config ${r.config_hash} · readiness v${r.version}`);

  const p = r.parsed;
  const exp = r.expected;
  const dates = (d) => (d ? d.text : "no dates");
  out.push("", "PARSED STRUCTURE");
  const c = p.contact;
  out.push(`  Contact   name=${c.name ?? "—"} · email=${c.email ?? "—"} · phone=${c.phone ?? "—"} · location=${c.location ?? "—"}`);
  if (c.urls.length) out.push(`            urls=${c.urls.join(", ")}`);
  if (c.other.length) out.push(`            other=${c.other.join(", ")}`);
  out.push(`  Sections  ${p.sections.map((s) => `${s.heading} [${s.key}]`).join(" · ")}`);
  out.push(`  Experience (${p.experience.length}${exp ? ` of ${exp.experience} built` : ""})`);
  for (const e of p.experience) out.push(`    ${e.company ?? "—"} · ${e.title ?? "—"} · ${dates(e.dates)} · ${e.location ?? "—"} · ${e.bullets.length} bullets`);
  out.push(`  Education (${p.education.length}${exp ? ` of ${exp.education} built` : ""})`);
  for (const e of p.education) out.push(`    ${e.institution ?? "—"} · ${e.degree ?? "—"} · ${dates(e.dates)} · ${e.location ?? "—"}`);
  out.push(`  Projects (${p.projects.length}${exp ? ` of ${exp.projects} built` : ""})`);
  for (const e of p.projects) out.push(`    ${e.name ?? "—"}${e.stack ? ` [${e.stack}]` : ""} · ${dates(e.dates)} · ${e.bullets.length} bullets`);
  out.push(`  Skills    ${p.skills.groups.map((g) => `${g.label ?? "(unlabeled)"} (${g.items.length})`).join(" · ")}`);
  return out.join("\n");
}

function runDirs(root, since) {
  const out = [];
  for (const day of fs.readdirSync(root).sort()) {
    if (since && day < since) continue;
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const run of fs.readdirSync(dayDir).sort()) {
      const dir = path.join(dayDir, run);
      if (fs.existsSync(path.join(dir, "resume.tex")) && fs.readdirSync(dir).some((f) => f.endsWith(".pdf"))) out.push(dir);
    }
  }
  return out;
}

function baseline({ root, since, limit }) {
  const config = loadAtsConfig();
  const dirs = runDirs(root, since).slice(-(limit || Infinity));
  const status = {};
  const scores = [];
  const checks = new Map();
  const errors = [];
  for (const dir of dirs) {
    let r;
    try { ({ result: r } = readinessFor(dir, config)); } catch (e) { errors.push(`${dir}: ${e.message}`); continue; }
    status[r.status] = (status[r.status] ?? 0) + 1;
    scores.push(r.parseability);
    for (const check of new Set(r.findings.map((f) => f.check))) checks.set(check, (checks.get(check) ?? 0) + 1);
  }
  scores.sort((a, b) => a - b);
  const q = (p) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
  console.log(`${scores.length} resumes under ${root}${since ? ` since ${since}` : ""} · config ${config.hash}`);
  console.log(`status    ${Object.entries(status).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (scores.length) console.log(`parseability  min ${scores[0]} · p25 ${q(0.25)} · median ${q(0.5)} · p75 ${q(0.75)} · max ${scores[scores.length - 1]}`);
  console.log("resumes with each finding:");
  for (const [check, n] of [...checks].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${check}`);
  for (const e of errors.slice(0, 10)) console.log(`error: ${e}`);
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (args.includes("--baseline")) {
    baseline({
      root: flag("--root") || path.join(os.homedir(), "Documents", "tailored-resumes"),
      since: flag("--since"),
      limit: Number(flag("--limit")) || 0,
    });
    return;
  }
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: npm run ats:readiness -- <resume.pdf | run-dir> [--json] [--views] | --baseline [--root <dir>] [--since YYYY-MM-DD] [--limit N]");
    process.exit(1);
  }
  const { extraction, result } = readinessFor(path.resolve(target));
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatReadiness(result));
  if (args.includes("--views")) {
    for (const [name, text] of Object.entries(extraction.views)) console.log(`\n===== ${name} view\n${text.trimEnd()}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
