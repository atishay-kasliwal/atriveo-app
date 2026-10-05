#!/usr/bin/env node
/**
 * JD skill match — the share of the hard skills a job description names that appear in the
 * resume text, the way outside ATS tools (Jobscan and the like) score a resume. Skills come from
 * data/ac-bank/JD_SKILLS.yaml, so a skill the bank has never heard of still counts as missing.
 *
 * A skill weighs 1, 1.5 when the JD names it more than once, half when it only appears under a
 * "preferred / nice to have" heading. Written another way in the resume (RAG for
 * Retrieval-Augmented Generation) still counts, and is listed so both forms can be added.
 *
 * Usage:
 *   node scripts/ac-jd-skills.mjs <run-dir>                      one resume (jd.txt + the PDF)
 *   node scripts/ac-jd-skills.mjs --baseline [--track <id>] [--root <dir>]
 *                                                                every resume on disk, summarized
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { resolveBankDir } from "./ac-role-meta.mjs";
import { classifyTrack, loadTracks } from "./ac-tracks.mjs";

export function loadSkills(bankDir = resolveBankDir()) {
  const doc = yaml.load(fs.readFileSync(path.join(bankDir, "JD_SKILLS.yaml"), "utf8")) || {};
  const caseSensitive = new Set(doc.case_sensitive || []);
  const skills = [];
  for (const [category, entries] of Object.entries(doc.skills || {})) {
    for (const [name, aliases] of Object.entries(entries || {})) {
      skills.push({ name, category, forms: [name, ...(aliases || [])].map((form) => formPattern(form, caseSensitive.has(form))) });
    }
  }
  return skills;
}

// Markdown escapes out, hyphens and dashes as spaces, one space between words.
const normalize = (text) => String(text || "").replace(/\\/g, "").replace(/[-–—_]+/g, " ").replace(/\s+/g, " ");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function formPattern(form, caseSensitive) {
  const body = escapeRe(normalize(form)).replace(/ /g, "\\s+");
  const plural = /[a-z]$/i.test(form) ? "(?:e?s)?" : "";
  const source = `(?<![A-Za-z0-9+#])${body}${plural}(?![A-Za-z0-9+#])`;
  // `re` tests, `all` counts; neither keeps a position between calls (matchAll works on a copy).
  return { form, re: new RegExp(source, caseSensitive ? "" : "i"), all: new RegExp(source, caseSensitive ? "g" : "gi") };
}

const PREFERRED_HEADING = /\b(preferred|nice to have|nice-to-have|bonus|good to have|pluses|desired)\b/i;

/** Where the "preferred" part of a JD starts: the first short line that heads it. */
function preferredStart(jd) {
  let offset = 0;
  for (const line of String(jd || "").split("\n")) {
    if (line.trim().length < 80 && PREFERRED_HEADING.test(line)) return normalize(String(jd).slice(0, offset)).length;
    offset += line.length + 1;
  }
  return Infinity;
}

/** The skills this JD names, with how much each matters. */
export function jdSkills(jd, skills = loadSkills()) {
  const text = normalize(jd);
  const cut = preferredStart(jd);
  const out = [];
  for (const skill of skills) {
    const at = skill.forms.flatMap(({ all }) => [...text.matchAll(all)].map((m) => m.index));
    if (!at.length) continue;
    const weight = (at.length > 1 ? 1.5 : 1) * (at.every((i) => i >= cut) ? 0.5 : 1);
    out.push({ ...skill, mentions: at.length, preferredOnly: at.every((i) => i >= cut), weight });
  }
  return out;
}

/** Score a resume's text against a JD: 0-100, with what matched (and how) and what's missing. */
export function jdSkillMatch(jd, resumeText, skills = loadSkills()) {
  const wanted = jdSkills(jd, skills);
  const text = normalize(resumeText);
  const matched = [];
  const missing = [];
  for (const skill of wanted) {
    const form = skill.forms.find(({ re }) => re.test(text));
    if (form) matched.push({ skill: skill.name, as: form.form === skill.name ? null : form.form, weight: skill.weight });
    else missing.push({ skill: skill.name, weight: skill.weight, preferredOnly: skill.preferredOnly });
  }
  const total = wanted.reduce((n, s) => n + s.weight, 0);
  const got = matched.reduce((n, s) => n + s.weight, 0);
  return {
    score: total ? Math.round((100 * got) / total) : null,
    skills: wanted.length,
    matched,
    missing: missing.sort((a, b) => b.weight - a.weight),
  };
}

/** The text an ATS reads from a resume PDF. */
export function pdfText(pdf) {
  const r = spawnSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`pdftotext failed for ${pdf}: ${r.stderr || r.error}`);
  return r.stdout;
}

const readJson = (dir, file) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { return null; } };

/** One tailoring run's directory: its JD, PDF and the scores our pipeline gave it. */
export function scoreRunDir(dir, skills = loadSkills()) {
  const pdf = fs.readdirSync(dir).find((f) => f.endsWith(".pdf"));
  if (!pdf || !fs.existsSync(path.join(dir, "jd.txt"))) return null;
  const meta = readJson(dir, "meta.json") || {};
  const report = readJson(dir, "report.json");
  const optimizer = readJson(dir, "optimizer.json");
  return {
    dir,
    role: meta.role ?? null,
    company: meta.company ?? null,
    ...jdSkillMatch(fs.readFileSync(path.join(dir, "jd.txt"), "utf8"), pdfText(path.join(dir, pdf)), skills),
    ours: {
      coverage: report?.composition?.coverage?.weighted_coverage != null ? Math.round(report.composition.coverage.weighted_coverage * 100) : null,
      confidence: optimizer?.resume_confidence_score ?? null,
    },
  };
}

function runDirs(root) {
  const out = [];
  for (const day of fs.readdirSync(root)) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const run of fs.readdirSync(dayDir)) if (fs.existsSync(path.join(dayDir, run, "meta.json"))) out.push(path.join(dayDir, run));
  }
  return out;
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function summarize(label, rows) {
  const scores = rows.map((r) => r.score).filter((s) => s != null).sort((a, b) => a - b);
  if (!scores.length) return `${label.padEnd(18)} no resumes`;
  return [
    label.padEnd(18), String(scores.length).padStart(5),
    String(mean(scores)).padStart(6), String(pct(scores, 0.5)).padStart(7),
    `${pct(scores, 0.25)}–${pct(scores, 0.75)}`.padStart(8),
    `${Math.round((100 * scores.filter((s) => s >= 80).length) / scores.length)}%`.padStart(6),
    String(mean(rows.map((r) => r.ours.coverage).filter((x) => x != null))).padStart(10),
    String(mean(rows.map((r) => r.ours.confidence).filter((x) => x != null))).padStart(11),
  ].join(" ");
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const skills = loadSkills();

  if (!args.includes("--baseline")) {
    const dir = args[0];
    if (!dir) {
      console.error("Usage: node scripts/ac-jd-skills.mjs <run-dir> | --baseline [--track <id>] [--root <dir>]");
      process.exit(1);
    }
    const r = scoreRunDir(path.resolve(dir), skills);
    if (!r) throw new Error(`No jd.txt and PDF in ${dir}`);
    console.log(`${r.company} · ${r.role}`);
    console.log(`JD skill match ${r.score}% (${r.matched.length} of ${r.skills} skills) · our coverage ${r.ours.coverage}% · confidence ${r.ours.confidence}`);
    console.log(`matched: ${r.matched.map((m) => (m.as ? `${m.skill} (as "${m.as}")` : m.skill)).join(", ")}`);
    console.log(`missing: ${r.missing.map((m) => `${m.skill}${m.preferredOnly ? " (preferred)" : ""}`).join(", ")}`);
    return;
  }

  const root = flag("--root") || path.join(os.homedir(), "Documents", "tailored-resumes");
  const only = flag("--track");
  const tracks = loadTracks();
  const byTrack = {};
  for (const dir of runDirs(root)) {
    const track = classifyTrack(readJson(dir, "meta.json")?.role, tracks) ?? "no track";
    if (only && track !== only) continue;
    const r = scoreRunDir(dir, skills);
    if (r) (byTrack[track] ??= []).push(r);
  }
  console.log(`${"track".padEnd(18)} ${"runs".padStart(5)} ${"mean".padStart(6)} ${"median".padStart(7)} ${"middle".padStart(8)} ${"≥80".padStart(6)} ${"our cov.".padStart(10)} ${"our conf.".padStart(11)}`);
  for (const [track, rows] of Object.entries(byTrack).sort((a, b) => b[1].length - a[1].length)) console.log(summarize(track, rows));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
