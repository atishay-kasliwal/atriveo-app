// Immutable artifact dirs keyed by compile fingerprint + manifest.json checkpoints.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFingerprint } from "./ac-fingerprint.mjs";
import { PIPELINE_VERSION } from "./ac-pipeline.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const COMPILE_STAGES = [
  "QUEUED",
  "GATED",
  "COMPOSED",
  "OPTIMIZED",
  "TEX",
  "PDF",
  "SUCCESS",
];

const DEFAULT_ARTIFACTS_ROOT = "/Volumes/Kasliwal v2/artifacts";

export function getArtifactsRoot() {
  return process.env.ARTIFACTS_ROOT?.trim() || DEFAULT_ARTIFACTS_ROOT;
}

export function artifactDir(fingerprint) {
  return path.join(getArtifactsRoot(), fingerprint);
}

export function manifestPath(fingerprint) {
  return path.join(artifactDir(fingerprint), "manifest.json");
}

function nowIso() {
  return new Date().toISOString();
}

function readManifestFile(fingerprint) {
  const p = manifestPath(fingerprint);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeManifestFile(fingerprint, manifest) {
  const dir = artifactDir(fingerprint);
  fs.mkdirSync(dir, { recursive: true });
  manifest.updated_at = nowIso();
  fs.writeFileSync(manifestPath(fingerprint), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Start or resume an artifact run for a compile. */
export function createArtifactRun({
  jd,
  planner = "v2",
  bankVersion,
  pipelineVersion = PIPELINE_VERSION,
  job = {},
  runDir,
  force = false,
}) {
  const fpMeta = computeFingerprint({ jd, bankVersion, planner, pipelineVersion });
  const { fingerprint } = fpMeta;
  const existing = readManifestFile(fingerprint);

  if (!force && manifestSucceeded(fingerprint)) {
    return { fingerprint, manifest: existing, dir: artifactDir(fingerprint), cacheHit: true };
  }

  const createdAt = existing?.created_at || nowIso();

  const manifest = {
    fingerprint,
    ...fpMeta,
    job: {
      company: job.company || null,
      title: job.title || job.role || null,
      job_url: job.job_url || null,
      score_pct: job.score_pct ?? null,
    },
    stage: existing?.stage || "GATED",
    status: existing?.status === "success" ? "success" : "in_progress",
    stages: existing?.stages || [],
    created_at: createdAt,
    updated_at: nowIso(),
    run_dir: runDir || existing?.run_dir || null,
    pdf_path: existing?.pdf_path || null,
    error: null,
  };

  if (!manifest.stages.some((s) => s.stage === "GATED")) {
    manifest.stages.push({ stage: "GATED", at: nowIso(), detail: { jd_chars: (jd || "").length } });
  }

  writeManifestFile(fingerprint, manifest);

  // Symlink latest run dir for quick navigation (best-effort)
  if (runDir) {
    try {
      const link = path.join(artifactDir(fingerprint), "latest-run");
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.symlinkSync(runDir, link);
    } catch { /* drive permissions */ }
  }

  return { fingerprint, manifest, dir: artifactDir(fingerprint) };
}

export function advanceArtifactStage(ctx, stage, detail = {}) {
  if (!ctx?.fingerprint) return null;
  const manifest = readManifestFile(ctx.fingerprint) || ctx.manifest;
  if (!manifest) return null;

  manifest.stage = stage;
  manifest.stages.push({ stage, at: nowIso(), detail });
  if (ctx.runDir && !manifest.run_dir) manifest.run_dir = ctx.runDir;
  writeManifestFile(ctx.fingerprint, manifest);
  ctx.manifest = manifest;
  return manifest;
}

export function finalizeArtifactRun(ctx, { success, pdfPath, error, runDir } = {}) {
  if (!ctx?.fingerprint) return null;
  const manifest = readManifestFile(ctx.fingerprint) || ctx.manifest;
  if (!manifest) return null;

  manifest.status = success ? "success" : "failed";
  manifest.stage = success ? "SUCCESS" : manifest.stage;
  if (pdfPath) manifest.pdf_path = pdfPath;
  if (runDir) manifest.run_dir = runDir;
  if (error) manifest.error = String(error).slice(0, 500);
  if (success && !manifest.stages.some((s) => s.stage === "SUCCESS")) {
    manifest.stages.push({ stage: "SUCCESS", at: nowIso(), detail: { pdf_path: pdfPath } });
  }
  writeManifestFile(ctx.fingerprint, manifest);
  ctx.manifest = manifest;
  return manifest;
}

export function readManifest(fingerprint) {
  return readManifestFile(fingerprint);
}

export function manifestSucceeded(fingerprint) {
  const m = readManifestFile(fingerprint);
  return m?.status === "success" && m?.pdf_path && fs.existsSync(m.pdf_path);
}

export function isCacheEnabled(force = false) {
  if (force) return false;
  if (process.env.TAILOR_FORCE_RECOMPILE === "1") return false;
  if (process.env.TAILOR_SKIP_CACHE === "0") return false;
  return true;
}

/** Look up a prior successful compile by fingerprint (JD + bank + planner + pipeline). */
export function resolveCachedCompile({
  jd,
  planner = "v2",
  bankVersion,
  pipelineVersion = PIPELINE_VERSION,
  force = false,
} = {}) {
  const fpMeta = computeFingerprint({ jd, bankVersion, planner, pipelineVersion });
  const { fingerprint } = fpMeta;
  if (!isCacheEnabled(force)) {
    return { hit: false, fingerprint, fpMeta, manifest: readManifestFile(fingerprint) };
  }
  const manifest = readManifestFile(fingerprint);
  if (!manifestSucceeded(fingerprint)) {
    return { hit: false, fingerprint, fpMeta, manifest };
  }
  return {
    hit: true,
    fingerprint,
    fpMeta,
    manifest,
    pdfPath: manifest.pdf_path,
    runDir: manifest.run_dir,
  };
}

/** Record that a compile reused an existing artifact (no re-compose). */
export function recordCacheReuse(fingerprint, detail = {}) {
  const manifest = readManifestFile(fingerprint);
  if (!manifest) return null;
  manifest.stages.push({
    stage: "CACHE_HIT",
    at: nowIso(),
    detail,
  });
  manifest.updated_at = nowIso();
  manifest.cache_hits = (manifest.cache_hits || 0) + 1;
  writeManifestFile(fingerprint, manifest);
  return manifest;
}

/**
 * Symlink (or copy) cached PDF into today's date folder so list-tailored / check-job still work.
 */
export function materializeCachedRun(cached, targetDir, { company, role, jobUrl, score_pct } = {}) {
  fs.mkdirSync(targetDir, { recursive: true });
  const pdfName = "Atishay Kasliwal.pdf";
  const targetPdf = path.join(targetDir, pdfName);

  if (fs.existsSync(targetPdf)) {
    try { fs.unlinkSync(targetPdf); } catch { /* ignore */ }
  }
  try {
    fs.symlinkSync(cached.pdfPath, targetPdf);
  } catch {
    fs.copyFileSync(cached.pdfPath, targetPdf);
  }

  const meta = {
    company,
    role,
    url: jobUrl,
    score_pct,
    tailored_at: new Date().toISOString(),
    pipeline: "ac",
    pipeline_version: PIPELINE_VERSION,
    cached: true,
    cache_fingerprint: cached.fingerprint,
    cache_source_dir: cached.runDir,
    cache_pdf_path: cached.pdfPath,
  };
  fs.writeFileSync(path.join(targetDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  fs.writeFileSync(path.join(targetDir, "cache.json"), `${JSON.stringify({
    cache_hit: true,
    fingerprint: cached.fingerprint,
    source_dir: cached.runDir,
    pdf_path: cached.pdfPath,
    materialized_at: new Date().toISOString(),
  }, null, 2)}\n`);

  return { pdfPath: targetPdf, dir: targetDir };
}

/** Dev fallback when external drive is not mounted. */
export function resolveArtifactsRoot() {
  const preferred = getArtifactsRoot();
  if (fs.existsSync(path.dirname(preferred)) || preferred.startsWith(ROOT)) {
    return preferred;
  }
  const fallback = path.join(ROOT, "data", "artifacts");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** Resolve full fingerprint from exact hash or unique prefix. */
export function resolveFingerprint(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  const root = getArtifactsRoot();
  if (!fs.existsSync(root)) return null;

  if (/^[a-f0-9]{64}$/.test(trimmed)) {
    return fs.existsSync(manifestPath(trimmed)) ? trimmed : null;
  }
  if (!/^[a-f0-9]{4,63}$/.test(trimmed)) return null;

  const matches = fs.readdirSync(root)
    .filter((d) => /^[a-f0-9]{64}$/.test(d) && d.startsWith(trimmed) && fs.existsSync(manifestPath(d)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const err = new Error(`Ambiguous fingerprint prefix "${trimmed}" — ${matches.length} manifests match`);
    err.matches = matches;
    throw err;
  }
  return null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Load manifest + on-disk run artifacts for replay / trust report. */
export function loadFingerprintBundle(fingerprintOrPrefix) {
  const fingerprint = resolveFingerprint(fingerprintOrPrefix) || fingerprintOrPrefix;
  const manifest = readManifestFile(fingerprint);
  if (!manifest) throw new Error(`Manifest not found for fingerprint: ${fingerprintOrPrefix}`);

  const runDir = manifest.run_dir;
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory missing for ${fingerprint.slice(0, 16)}… — expected ${runDir}`);
  }

  const jdPath = path.join(runDir, "jd.txt");
  const jd = fs.existsSync(jdPath) ? fs.readFileSync(jdPath, "utf8") : null;

  return {
    fingerprint,
    manifest,
    runDir,
    jd,
    composition: readJsonFile(path.join(runDir, "composition.json")),
    explain: readJsonFile(path.join(runDir, "explain.json")),
    meta: readJsonFile(path.join(runDir, "meta.json")),
    pdfPath: manifest.pdf_path,
  };
}

/** List manifests newest-first (for CLI discovery). */
export function listManifests({ limit = 20 } = {}) {
  const root = getArtifactsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((d) => /^[a-f0-9]{64}$/.test(d) && fs.existsSync(manifestPath(d)))
    .map((fp) => ({ fingerprint: fp, ...readManifestFile(fp) }))
    .filter((m) => m.fingerprint)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, limit);
}
