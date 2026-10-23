// Assess the exact PDF displayed by Job Matching, including older staffing resumes with no ATS report.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAtsConfig, sha256 } from './ats/config.mjs';
import { termRegex } from './ats/jd-parse.mjs';
import { keywordCoverage } from './ats/evidence.mjs';
export { keywordCoverage };
import { parseResume } from './ats/resume-parse.mjs';
import { scoreAts } from './ats/score.mjs';

const run = promisify(execFile);
const cache = new Map();
let config;

export function keywordHighlights(jd, keywords, cfg) {
  const ranges = keywords.filter(k => k.matched).flatMap(k => k.terms.flatMap(term => {
    const pattern = termRegex(term, cfg);
    return [...jd.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].map(m => ({ start: m.index, end: m.index + m[0].length }));
  })).sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  for (const range of ranges) {
    const last = result.at(-1);
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function pageSpace(bbox) {
  const pages = [...bbox.matchAll(/<page\b[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)];
  if (pages.length !== 1) return { pages: pages.length || null, roomLines: null };
  const bottom = Math.max(0, ...[...pages[0][2].matchAll(/yMax="([\d.]+)"/g)].map(m => Number(m[1])));
  return { pages: 1, roomLines: bottom ? Math.max(0, Math.floor((Number(pages[0][1]) - 36 - bottom) / 12)) : null };
}

export async function analyzeMatchingResume(pdfPath, jd, title) {
  try {
    config ??= loadAtsConfig();
    const asOf = new Date().toISOString().slice(0, 10);
    const key = sha256(Buffer.concat([fs.readFileSync(pdfPath), Buffer.from(JSON.stringify([jd, title, config.hash, asOf]))]));
    if (cache.has(key)) return await cache.get(key);
    const pending = (async () => {
      const options = { timeout: 15_000, maxBuffer: 16 << 20 };
      const [{ stdout: layout }, { stdout: bbox }] = await Promise.all([
        run('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], options),
        run('pdftotext', ['-bbox', pdfPath, '-'], options),
      ]);
      if (!layout.trim()) throw Error('The resume PDF has no readable text');
      const { job_match: match } = scoreAts({ parsed: parseResume(layout, config.sections) }, jd, config, { title, asOf });
      const keywords = keywordCoverage(jd, layout, config);
      return {
        score: typeof match?.score === 'number' ? Math.round(match.score) : null,
        required: match?.requirement_counts?.required ?? null,
        preferred: match?.requirement_counts?.preferred ?? null,
        incomplete: match?.coverage?.status === 'incomplete',
        keywords, highlights: keywordHighlights(jd, keywords, config),
        ...pageSpace(bbox),
      };
    })();
    cache.set(key, pending);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    try { return await pending; } catch (error) { cache.delete(key); throw error; }
  } catch { return null; }
}
