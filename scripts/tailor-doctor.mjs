#!/usr/bin/env node
/**
 * Tailor pipeline doctor — one command to see the WHOLE health of the
 * scrape → JD-export → tailor → compile chain in plain English.
 *
 *   npm run tailor:doctor
 *
 * Designed so anyone (not just the author) can read the output and know
 * exactly what is healthy and what is broken, with the fix command for each
 * failure. This exists because on 2026-06-13 ~75 resumes silently failed with
 * "No full JD captured" — the JD bucket export was a day stale and NOTHING
 * surfaced it. Each check below maps to a real failure mode.
 *
 * Node built-ins only (+ the export script's own logic for the JD check).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const JD_DIR = path.join(ROOT, "public", "job_descriptions");
const DRIVE_ROOT = "/Volumes/Kasliwal v2";
const OUT_ROOT = process.env.TAILOR_OUT_ROOT?.trim() || path.join(DRIVE_ROOT, "tailored-resumes");
const USES_EXTERNAL_DRIVE = OUT_ROOT.startsWith("/Volumes/");
const OLLAMA = "http://127.0.0.1:11434";
const SIDECAR = "http://127.0.0.1:8787";
const DEFAULT_MODEL = "gemma4:12b";
// Buckets older than this are suspicious. The scraper + auto-export run hourly
// (com.atriveo.job-pipeline → run-pipeline-and-export.sh), so anything older
// than ~2h means the auto-export after the last scrape failed — check
// /tmp/atriveo_pipeline.log.
const JD_STALE_HOURS = 2;

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
let failures = 0;
let warnings = 0;

function ok(label, detail)   { console.log(`${C.green}✓${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`); }
function warn(label, detail, fix) { warnings++; console.log(`${C.yellow}⚠${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`); if (fix) console.log(`   ${C.dim}fix: ${fix}${C.reset}`); }
function bad(label, detail, fix)  { failures++; console.log(`${C.red}✗${C.reset} ${label}${detail ? ` ${C.dim}· ${detail}${C.reset}` : ""}`); if (fix) console.log(`   ${C.dim}fix: ${fix}${C.reset}`); }
function section(title) { console.log(`\n${C.bold}${title}${C.reset}`); }

function loadEnvToken() {
  const p = path.join(ROOT, ".env.tailor");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (line.startsWith("TAILOR_TOKEN=")) return line.slice("TAILOR_TOKEN=".length).trim();
  }
  return "";
}

async function fetchJson(url, opts = {}, ms = 6000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function hoursSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

function fmtAge(hours) {
  if (hours === Infinity) return "unknown";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

// ── 1. JD bucket freshness (the check that would have caught 2026-06-13) ──────
function checkJdBuckets() {
  section("Job descriptions (the source of 'No full JD captured' failures)");
  const manifestPath = path.join(JD_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    bad("JD bucket manifest missing", JD_DIR, "npm run jd:export");
    return;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch { bad("JD manifest unreadable", manifestPath, "npm run jd:export"); return; }

  const age = hoursSince(manifest.generated_at);
  const detail = `${manifest.descriptions_found}/${manifest.active_urls} JDs · ${manifest.buckets} buckets · generated ${fmtAge(age)}`;
  if (age > JD_STALE_HOURS) {
    bad(`JD buckets are STALE (${age.toFixed(0)}h old)`, detail,
        "npm run jd:export   ← regenerate from today's scrape (this was the 2026-06-13 bug)");
  } else {
    ok("JD buckets fresh", detail);
  }

  const bucketFiles = fs.existsSync(JD_DIR) ? fs.readdirSync(JD_DIR).filter((f) => /^[0-9a-f]{2}\.json$/.test(f)) : [];
  if (bucketFiles.length === 0) {
    bad("No JD bucket files on disk", JD_DIR, "npm run jd:export");
  } else {
    ok("JD bucket files present", `${bucketFiles.length} files`);
  }

  // coverage ratio — a low ratio means many scraped jobs have no JD captured
  if (manifest.active_urls > 0) {
    const ratio = manifest.descriptions_found / manifest.active_urls;
    if (ratio < 0.85) {
      warn("JD coverage low", `${(ratio * 100).toFixed(0)}% of active jobs have a JD`,
           "some jobs will fail as 'no-jd' — normal for fresh scrapes, re-export later");
    }
  }
}

// ── 2. AC evidence bank (default tailor path) ───────────────────────────────
function checkAcBank() {
  section("AC evidence bank (default resume pipeline)");
  const bankDir = path.join(ROOT, "data", "ac-bank");
  const versionPath = path.join(bankDir, "BANK_VERSION.yaml");
  if (!fs.existsSync(bankDir)) {
    bad("AC bank missing", bankDir, "sync accomplishments into data/ac-bank");
    return;
  }
  const acFiles = fs.readdirSync(bankDir).filter((f) => /^AC-\d+\.yaml$/.test(f));
  ok("AC bank present", `${acFiles.length} accomplishment file(s)`);
  if (acFiles.length < 30) {
    warn("Seed bank only", `${acFiles.length} ACs — sync full library for better beam diversity`, "copy ACs from Desktop/June/Resume claude/Memory/ACCOMPLISHMENTS");
  }
  if (fs.existsSync(versionPath)) ok("Bank version file", path.relative(ROOT, versionPath));
}

// ── 3. Ollama + model (legacy tailor only) ─────────────────────────────────
async function checkOllama(legacyOnly = false) {
  section(legacyOnly ? "Ollama (legacy tailor — TAILOR_LEGACY=1)" : "Ollama (optional — legacy tailor only)");
  let tags;
  try { tags = await fetchJson(`${OLLAMA}/api/tags`); }
  catch (e) {
    if (legacyOnly) bad("Ollama unreachable", e.message, "open Ollama app or run: ollama serve");
    else warn("Ollama unreachable", e.message, "not needed for AC pipeline — only for TAILOR_LEGACY=1");
    return;
  }
  const names = (tags.models || []).map((m) => m.name);
  ok("Ollama responding", `${names.length} model(s)`);

  if (names.some((n) => n === DEFAULT_MODEL || n.startsWith(`${DEFAULT_MODEL.split(":")[0]}:`))) {
    ok(`Default model installed`, DEFAULT_MODEL);
  } else if (legacyOnly) {
    bad(`Default model "${DEFAULT_MODEL}" not installed`, names.slice(0, 4).join(", "),
        `ollama pull ${DEFAULT_MODEL}`);
  } else {
    warn(`Default model "${DEFAULT_MODEL}" not installed`, names.slice(0, 4).join(", "),
        `only needed for TAILOR_LEGACY=1`);
  }

  // What's currently loaded (a stuck model is a common hang cause)
  try {
    const ps = await fetchJson(`${OLLAMA}/api/ps`);
    const loaded = (ps.models || []).map((m) => m.name);
    if (loaded.length) ok("Models loaded in memory", loaded.join(", "));
  } catch { /* ps optional */ }
}

// ── 4. Tailor sidecar ────────────────────────────────────────────────────────
async function checkSidecar() {
  section("Tailor sidecar (the local server that builds resumes)");
  const token = loadEnvToken();
  let legacy = false;
  try {
    const h = await fetchJson(`${SIDECAR}/health`, token ? { headers: { "X-Tailor-Token": token } } : {});
    if (h.ok) {
      const mode = h.pipeline === "legacy" ? "legacy (Gemma rewrites)" : `ac (planner ${h.planner || "v2"})`;
      ok("Sidecar healthy", `${mode} · drive ${h.driveMounted ? "mounted" : "NOT mounted"}`);
      legacy = h.pipeline === "legacy";
    }
    if (!h.driveMounted) {
      if (USES_EXTERNAL_DRIVE) bad("External drive not mounted", DRIVE_ROOT, "plug in 'Kasliwal v2'");
      else bad("Output root missing", OUT_ROOT, `mkdir -p "${OUT_ROOT}"`);
    }
    return legacy;
  } catch (e) {
    bad("Sidecar not running", e.message, "npm run tailor   (or: launchctl kickstart -k gui/$(id -u)/com.atriveo.tailor)");
    return false;
  }
}

// ── 5. Output location ───────────────────────────────────────────────────────
function checkDrive() {
  section("Output location");
  if (USES_EXTERNAL_DRIVE) {
    if (!fs.existsSync(DRIVE_ROOT)) { bad("Drive not mounted", DRIVE_ROOT, "plug in 'Kasliwal v2'"); return; }
    ok("Drive mounted", DRIVE_ROOT);
  } else {
    if (!fs.existsSync(OUT_ROOT)) { bad("Output root missing", OUT_ROOT, `mkdir -p "${OUT_ROOT}"`); return; }
    ok("Output root reachable", OUT_ROOT);
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateDir = path.join(OUT_ROOT, today);
  if (fs.existsSync(dateDir)) {
    const dirs = fs.readdirSync(dateDir).filter((d) => /^\d+-/.test(d));
    const withPdf = dirs.filter((d) => fs.existsSync(path.join(dateDir, d, "Atishay Kasliwal.pdf"))).length;
    ok("Today's output folder", `${withPdf}/${dirs.length} have a PDF`);
    if (dirs.length && withPdf / dirs.length < 0.5) {
      warn("Many runs today have no PDF", `${dirs.length - withPdf} failed`, "run: npm run tailor:doctor after fixing JDs, then re-run failed jobs");
    }
  } else {
    ok("No runs yet today", today);
  }
}

(async function main() {
  console.log(`${C.bold}Tailor pipeline doctor${C.reset} ${C.dim}· ${new Date().toLocaleString()}${C.reset}`);
  checkJdBuckets();
  checkAcBank();
  const legacy = await checkSidecar();
  await checkOllama(legacy);
  checkDrive();

  console.log();
  if (failures) {
    console.log(`${C.red}${C.bold}${failures} problem(s)${C.reset}${warnings ? `, ${warnings} warning(s)` : ""} — fix the ✗ items above.`);
    process.exit(1);
  }
  if (warnings) {
    console.log(`${C.yellow}${C.bold}${warnings} warning(s)${C.reset} — pipeline works but review the ⚠ items.`);
    process.exit(0);
  }
  console.log(`${C.green}${C.bold}All systems healthy.${C.reset} Resumes will build with full JDs.`);
})();
