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
    const key = sha256(Buffer.concat([fs.readFileSync(pdfPath), Buffer.from(JSON.stringify([jd, fit?.ledger?.skills ?? [], config.hash]))]));
    if (cache.has(key)) return await cache.get(key);
    const pending = (async () => {
      const { stdout: bbox } = await run('pdftotext', ['-bbox', pdfPath, '-'], { timeout: 15_000, maxBuffer: 16 << 20 });
      const matched = (fit?.ledger?.skills ?? []).filter(s => s.status === 'matched').map(s => ({ name: s.label, terms: s.alternatives, matched: true }));
      const proofs = (fit?.ledger?.skills ?? []).map(s => {
        const tier=s.evidence?.tier;
        const strength=s.status==='missing'?'missing':s.status==='partial'?'partial':tier==='skills_only'?'weak':tier==='job_tools'||tier==='project_tools'?'moderate':'strong';
        return { label:s.label, class:s.class, status:s.status, strength, source:s.source??null, entry:s.evidence?.entry??null, text:s.evidence?.text??null, tier:tier??null, box:evidenceBox(bbox,s.evidence?.text) };
      });
      return { highlights: keywordHighlights(jd, matched, config), proofs, ...pageSpace(bbox) };
    })();
    cache.set(key, pending);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    try { return await pending; } catch (error) { cache.delete(key); throw error; }
  } catch { return null; }
}

const normalize = text => String(text).normalize('NFKD').replace(/ﬁ/g,'fi').replace(/ﬂ/g,'fl').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const xmlText = text => text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
/** Exact normalized word sequence only: a bank bullet absent from this PDF gets no highlight. */
export function evidenceBox(bbox, text) {
 if(!text)return null;
 const first=bbox.match(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/);if(!first)return null;
 const words=[...first[3].matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g)].map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:normalize(xmlText(m[5]))}));
 const tokens=[];for(const [i,w]of words.entries())for(const t of w.text.split(' ').filter(Boolean))tokens.push({t,i});
 const needle=normalize(/\.\.\.$/.test(text)?text.replace(/\s+\S*\.\.\.$/, ''):text).split(' ').filter(Boolean);if(needle.length<3)return null;
 const joined=tokens.map(x=>x.t).join(' ');const query=needle.join(' ');const at=(' '+joined+' ').indexOf(' '+query+' ');if(at<0)return null;
 const start=joined.slice(0,at).trim().split(' ').filter(Boolean).length;
 const slice=tokens.slice(start,start+needle.length).map(t=>words[t.i]);if(!slice.length)return null;
 const x=Math.min(...slice.map(w=>w.x)),y=Math.min(...slice.map(w=>w.y)),right=Math.max(...slice.map(w=>w.right)),bottom=Math.max(...slice.map(w=>w.bottom));
 return {x:x/+first[1]*100,y:y/+first[2]*100,width:(right-x)/+first[1]*100,height:(bottom-y)/+first[2]*100};
}
