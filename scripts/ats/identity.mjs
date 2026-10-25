// Shared by the writer and every reader: a saved score is valid only for these inputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAtsConfig, sha256 } from './config.mjs';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const ATS_ALGORITHM_HASH = sha256(Buffer.concat(['identity.mjs', 'cli.mjs', 'extract.mjs', 'patterns.mjs', 'resume-parse.mjs', 'readiness.mjs', 'jd-parse.mjs', 'evidence.mjs', 'match.mjs', 'score.mjs']
  .map(name => fs.readFileSync(path.join(sourceDir, name))))).slice(0, 16);

export function assessmentInputs(pdfPath, dir = path.dirname(pdfPath)) {
  const jdPath = path.join(dir, 'jd.txt'), metaPath = path.join(dir, 'meta.json');
  const title = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')).role || null : null;
  return { pdf_sha256: sha256(fs.readFileSync(pdfPath)), jd_sha256: fs.existsSync(jdPath) ? sha256(fs.readFileSync(jdPath)) : null, title_sha256: sha256(JSON.stringify(title)) };
}

export function assessmentFreshness(saved, pdfPath, { config = loadAtsConfig(), asOf = new Date().toISOString().slice(0, 10) } = {}) {
  if (saved?.schema_version !== 1 || saved.algorithm_hash !== ATS_ALGORITHM_HASH || saved.config_hash !== config.hash) return { current: false, reason: 'Scoring rules have changed; refresh this assessment' };
  // Experience duration changes with the month; do not invalidate everything at midnight.
  if (saved.as_of?.slice(0, 7) !== asOf.slice(0, 7)) return { current: false, reason: 'Experience dates need a current assessment' };
  try {
    const inputs = assessmentInputs(pdfPath);
    if (Object.entries(inputs).some(([key, value]) => saved.inputs?.[key] !== value)) return { current: false, reason: 'The resume, posting or role title changed; refresh this assessment' };
  } catch { return { current: false, reason: 'Assessment inputs are unavailable; refresh before relying on this score' }; }
  return { current: true, reason: null };
}
