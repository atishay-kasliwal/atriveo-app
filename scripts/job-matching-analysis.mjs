// Assess the exact PDF displayed by Job Matching, including older staffing resumes with no ATS report.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAtsConfig, sha256 } from './ats/config.mjs';
import { termRegex } from './ats/jd-parse.mjs';
import { keywordCoverage } from './ats/evidence.mjs';
export { keywordCoverage };

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

// What Matching needs from the PDF itself: its page count, how much room is left, and which words of the posting to
// highlight. The skills highlighted are the ones Fit found evidence for in your bank (the ledger), never a count made
// from the tailored resume: every number on the page comes from Fit.
export async function analyzeMatchingResume(pdfPath, jd, fit) {
  try {
    config ??= loadAtsConfig();
    const key = sha256(Buffer.concat([fs.readFileSync(pdfPath), Buffer.from(JSON.stringify([jd, fit?.ledger?.matched ?? [], config.hash]))]));
    if (cache.has(key)) return await cache.get(key);
    const pending = (async () => {
      const { stdout: bbox } = await run('pdftotext', ['-bbox', pdfPath, '-'], { timeout: 15_000, maxBuffer: 16 << 20 });
      const matched = (fit?.ledger?.skills ?? []).filter(s => s.status === 'matched').map(s => ({ name: s.label, terms: s.alternatives, matched: true }));
      return { highlights: keywordHighlights(jd, matched, config), ...pageSpace(bbox) };
    })();
    cache.set(key, pending);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    try { return await pending; } catch (error) { cache.delete(key); throw error; }
  } catch { return null; }
}
