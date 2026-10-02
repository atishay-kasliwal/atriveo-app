#!/usr/bin/env node
// Phase 2 CLI. Run folder defaults to its jd.txt and meta role; a bare PDF needs --jd and --title.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadAtsConfig } from "./config.mjs";
import { readinessFor } from "./cli.mjs";
import { scoreAts } from "./score.mjs";

export function loadBank(dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/ac-bank")) {
  return fs.readdirSync(dir).filter((f) => /^AC-\d+\.yaml$/.test(f)).sort().flatMap((f) => {
    try { return [yaml.load(fs.readFileSync(path.join(dir, f), "utf8"))]; } catch { return []; }
  });
}

export function scoreTarget(target, { jdPath = null, title: suppliedTitle = null, asOf = new Date().toISOString().slice(0, 10), config = loadAtsConfig(), bank = [] } = {}) {
  const { result: readiness } = readinessFor(target, config);
  const resolved = jdPath || (fs.statSync(target).isDirectory() ? path.join(target, "jd.txt") : null);
  if (!resolved || !fs.existsSync(resolved)) return { readiness, job_match: null, note: "No JD supplied; Readiness only" };
  const jdText = fs.readFileSync(resolved, "utf8");
  if (!jdText.trim()) return { readiness, job_match: null, note: "JD is empty; Readiness only" };
  let title = suppliedTitle;
  if (!title && fs.statSync(target).isDirectory()) {
    const meta = path.join(target, "meta.json");
    if (fs.existsSync(meta)) title = JSON.parse(fs.readFileSync(meta, "utf8")).role || null;
  }
  return scoreAts(readiness, jdText, config, { asOf, bank, title });
}

export function formatMatch(output) {
  const { readiness, jd, job_match: m } = output;
  if (!m) return `ATS READINESS ${readiness.status} ${readiness.parseability}/100\n${output.note || "Job Match is unavailable."}`;
  const out = [
    `ATS READINESS ${readiness.status} ${readiness.parseability}/100    JOB MATCH ${m.score}/100`,
    `${jd.title || "Untitled job"} · Required ${m.requirement_counts.required.matched}/${m.requirement_counts.required.total} · Preferred ${m.requirement_counts.preferred.matched}/${m.requirement_counts.preferred.total}`,
    ...(m.coverage.status === "incomplete" ? [`INCOMPLETE JD COVERAGE: ${m.coverage.unparsed_requirements} qualification lines need manual review${m.coverage.missing_job_title ? "; no job title was supplied for role alignment" : ""}${m.coverage.no_skill_requirements ? "; no explicit skill requirements were identified" : ""}.`] : []),
    m.note, "",
  ];
  for (const c of m.categories) {
    out.push(`${c.key.replaceAll("_", " ").toUpperCase()}  ${c.earned}/${c.max}${c.note ? ` · ${c.note}` : ""}`);
    for (const i of c.items) {
      out.push(`  ${i.earned}/${i.max} ${i.label}${i.classification ? ` [${i.classification}]` : ""}${i.evidence_tier ? ` · ${i.evidence_tier}` : ""}`);
      if (i.evidence) out.push(`      ${i.evidence_entry ? `${i.evidence_entry}: ` : ""}${i.evidence}`);
      if (i.source && !i.evidence) out.push(`      JD: ${i.source}`);
      if (i.warning) out.push(`      warning: ${i.warning}`);
    }
  }
  if (m.unparsed_requirements.length) {
    out.push("", `UNPARSED REQUIREMENTS (${m.unparsed_requirements.length}); review these manually`);
    for (const r of m.unparsed_requirements) out.push(`  ${r.classification}: ${r.source}`);
  }
  if (m.potential_knockouts.length) {
    out.push("", "POTENTIAL KNOCKOUTS (not automatic rejections)");
    for (const k of m.potential_knockouts) out.push(`  ${k.type}: ${k.status} · ${k.source}`);
  }
  if (m.recommendations.length) {
    out.push("", "HIGHEST IMPACT IMPROVEMENTS");
    for (const r of m.recommendations) out.push(`  +${r.recoverable_points} ${r.message}`);
  }
  out.push("", `Accounting: ${m.accounting.earned} earned + ${m.accounting.lost} lost = ${m.accounting.max} · config ${m.config_hash} · match v${m.version} · as of ${m.as_of}`);
  return out.join("\n");
}

function runDirs(root) {
  const out = [];
  for (const day of fs.readdirSync(root).sort()) {
    const dir = path.join(root, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const run = path.join(dir, name);
      if (fs.existsSync(path.join(run, "jd.txt")) && fs.existsSync(path.join(run, "resume.tex"))) out.push(run);
    }
  }
  return out;
}

function baseline(root, limit, asOf, config, bank) {
  const scores = [];
  const errors = [];
  let unscorable = 0;
  const dirs = runDirs(root).slice(-(limit || Infinity));
  for (const dir of dirs) {
    try {
      const r = scoreTarget(dir, { asOf, config, bank });
      if (r.job_match) scores.push({ dir, score: r.job_match.score, readiness: r.readiness.status,
        required: r.job_match.requirement_counts.required, preferred: r.job_match.requirement_counts.preferred });
      else unscorable++;
    } catch (e) { errors.push({ dir, error: e.message }); }
  }
  scores.sort((a, b) => a.score - b.score);
  const q = (p) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))]?.score;
  return { total: dirs.length, scored: scores.length, unscorable, errors, min: q(0), p25: q(.25), median: q(.5), p75: q(.75), max: q(1), lowest: scores.slice(0, 5), highest: scores.slice(-5), as_of: asOf, config_hash: config.hash };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const target = args.find((a, i) => !a.startsWith("--") && !["--jd", "--title", "--as-of", "--root", "--limit"].includes(args[i - 1]));
  const config = loadAtsConfig();
  const bank = loadBank();
  const asOf = flag("--as-of") || new Date().toISOString().slice(0, 10);
  if (args.includes("--baseline")) {
    const summary = baseline(flag("--root") || path.join(os.homedir(), "Documents/tailored-resumes"), Number(flag("--limit")) || 0, asOf, config, bank);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!target) throw new Error("Usage: npm run ats:match -- <resume.pdf | run-dir> [--jd job.txt] [--title 'Job title'] [--as-of YYYY-MM-DD] [--json] | --baseline [--root dir] [--limit N]");
  const output = scoreTarget(path.resolve(target), { jdPath: flag("--jd") && path.resolve(flag("--jd")), title: flag("--title"), asOf, config, bank });
  console.log(args.includes("--json") ? JSON.stringify(output, null, 2) : formatMatch(output));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
