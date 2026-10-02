// Persist a versioned ATS assessment beside a completed resume PDF.
// The file is advisory: scoring failures must not turn a successful compile into a failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAtsConfig, sha256 } from "./config.mjs";
import { resolveInput } from "./cli.mjs";
import { loadBank, scoreTarget } from "./match-cli.mjs";

export const ATS_SCORE_FILE = "ats-score.json";
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const ATS_ALGORITHM_HASH = sha256(Buffer.concat(["cli.mjs", "extract.mjs", "patterns.mjs", "resume-parse.mjs", "readiness.mjs", "jd-parse.mjs", "evidence.mjs", "match.mjs", "score.mjs"]
  .map((name) => fs.readFileSync(path.join(sourceDir, name))))).slice(0, 16);

export function readSavedAts(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, ATS_SCORE_FILE), "utf8")); }
  catch { return null; }
}

export function scoreAndSaveRun(dir, { asOf = new Date().toISOString().slice(0, 10), config = loadAtsConfig(), bank = loadBank(), force = false } = {}) {
  const { pdf } = resolveInput(dir);
  const jdPath = path.join(dir, "jd.txt");
  const pdfHash = sha256(fs.readFileSync(pdf));
  const jdHash = fs.existsSync(jdPath) ? sha256(fs.readFileSync(jdPath)) : null;
  const inputs = { pdf_sha256: pdfHash, jd_sha256: jdHash };
  const previous = readSavedAts(dir);
  if (!force && previous?.schema_version === 1 && previous.algorithm_hash === ATS_ALGORITHM_HASH && previous.config_hash === config.hash
    && previous.as_of === asOf && previous.inputs?.pdf_sha256 === pdfHash
    && previous.inputs?.jd_sha256 === jdHash) return { saved: previous, changed: false };

  const result = scoreTarget(dir, { asOf, config, bank });
  const saved = {
    schema_version: 1,
    scored_at: new Date().toISOString(),
    as_of: asOf,
    config_hash: config.hash,
    algorithm_hash: ATS_ALGORITHM_HASH,
    inputs,
    readiness: result.readiness,
    job_match: result.job_match,
    note: result.note ?? null,
    jd: result.jd ?? null,
  };
  const target = path.join(dir, ATS_SCORE_FILE);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`);
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { saved, changed: true };
}
