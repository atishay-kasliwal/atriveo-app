import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export function museAuthorized(header, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '') || typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 512) return false;
  const actual = createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function runMuse(input) {
  return new Promise((resolve, reject) => {
    const dir = process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo');
    const child = spawn(path.join(dir, 'node_modules', '.bin', 'tsx'), ['src/cli/muse.ts'], { cwd: dir, env: process.env });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Muse timed out')); }, 60000);
    child.stdout.on('data', c => { out += c; if (out.length > 8000000) { child.kill('SIGKILL'); reject(new Error('Response too large')); } });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(new Error('Invalid Muse response')); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

/** Called before the dashboard token gate. This credential never authorizes any dashboard route. */
export async function handleMuse(req, res, url, { hash = process.env.MUSE_TOKEN_SHA256, run = runMuse } = {}) {
  if (!url.pathname.startsWith('/integrations/muse/')) return false;
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(JSON.stringify(body)); };
  if (!museAuthorized(req.headers.authorization, hash)) { send(401, { ok: false, error: 'Unauthorized' }); return true; }
  const operation = url.pathname === '/integrations/muse/questions' ? 'questions' : url.pathname === '/integrations/muse/drafts' ? 'drafts' : null;
  if (!operation) { send(404, { ok: false, error: 'Unknown Muse route' }); return true; }
  if (req.method !== (operation === 'questions' ? 'GET' : 'POST')) { send(405, { ok: false, error: 'Method not allowed' }); return true; }
  try {
    let body;
    if (operation === 'drafts') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) { send(415, { ok: false, error: 'Use application/json' }); return true; }
      let raw = '';
      for await (const c of req) { raw += c; if (Buffer.byteLength(raw) > 200000) { send(413, { ok: false, error: 'Request too large' }); return true; } }
      try { body = JSON.parse(raw); } catch { send(400, { ok: false, error: 'Invalid JSON' }); return true; }
    }
    const result = await run({ operation, ...(operation === 'questions' ? { query: Object.fromEntries(url.searchParams) } : { body }) });
    send(result.ok ? 200 : [400, 404, 409, 413, 500].includes(result.status) ? result.status : 500, result);
  } catch { send(500, { ok: false, error: 'Muse operation failed; contact the Atriveo administrator' }); }
  return true;
}
