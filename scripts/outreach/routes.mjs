import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { discover } from './discovery.mjs';

const engine = process.env.OUTREACH_ENGINE_DIR || process.env.PLAYATRIVEO_DIR || path.join(os.homedir(), 'playatriveo');
export function outreachCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let u; try { u = new URL(origin); } catch { return false; }
  if (!['localhost', '127.0.0.1', 'apply.atriveo.com', 'application.atriveo.com'].includes(u.hostname) || !['http:', 'https:'].includes(u.protocol)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); return true;
}
export function runOutreach(op, input = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(engine, 'src/cli/outreachWeb.ts')], { cwd: engine, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let settled = false;
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); done(new Error('Outreach operation timed out. Reload its status before trying again.')); }, 90000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 12_000_000) { child.kill(); done(new Error('Outreach response too large')); } });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', e => done(e));
    child.on('close', () => { try { const result = JSON.parse(output.trim()); if (!result.ok) throw new Error(result.error || 'Outreach operation failed'); done(null, result); } catch (e) { done(new Error(output.trim().startsWith('{') ? e.message : 'Outreach backend unavailable. Check the engine configuration.')); } });
    child.stdin.end(JSON.stringify({ op, input }));
  });
}
let authPending;
function authorize() {
  if (authPending) return authPending;
  authPending = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(engine, 'src/cli/outreach.ts'), 'auth'], { cwd: engine, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let found = false;
    const timer = setTimeout(() => child.kill(), 600000); timer.unref();
    child.stderr.resume();
    child.stdout.on('data', chunk => { output += chunk; const url = output.match(/https:\/\/accounts\.google\.com\/[^\s]+/); if (url && !found) { found = true; resolve({ url: url[0] }); } });
    child.on('error', () => { clearTimeout(timer); authPending = null; reject(new Error('Could not start Gmail authorization')); });
    child.on('close', () => { clearTimeout(timer); authPending = null; if (!found) reject(new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the local engine, then connect Gmail again.')); });
  });
  return authPending;
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 7_100_000) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export function createOutreachRoutes(run = runOutreach, find = discover, auth = authorize) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/outreach/')) return false;
    const json = (value, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
    if (!outreachCors(req, res)) { json({ ok: false, error: 'Origin not allowed' }, 403); return true; }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.statusCode = 204; res.end(); return true; }
    try {
      const route = url.pathname.slice('/outreach/'.length);
      const read = req.method === 'GET';
      if (!(read ? ['list', 'detail', 'settings', 'attachment'] : ['POST', 'PUT'].includes(req.method) ? ['create', 'draft', 'action', 'settings', 'test', 'scan', 'auth'] : []).includes(route)) { json({ ok: false, error: 'Unknown outreach route' }, 404); return true; }
      const input = read ? Object.fromEntries(url.searchParams) : await body(req);
      let result;
      if (route === 'auth') result = await auth();
      else if (route === 'action') {
        if (!['discover', 'posting', 'upload', 'use_resume', 'remove_attachment', 'template', 'approve', 'skip', 'cancel'].includes(input.action)) throw new Error('Unknown outreach action');
        if (input.action === 'discover') {
          const { draft } = await run('detail', { id: input.id });
          if (draft.revision !== input.revision) throw new Error('Draft changed. Reload before discovering contacts.');
          if (!draft.websiteConfirmed || !draft.website) throw new Error('Confirm the company website first');
          const discovery = await find(draft.website, draft.jobUrl);
          result = await run('action', { id: input.id, revision: input.revision, action: 'discover_result', discovery });
        } else result = await run('action', input);
      } else result = await run(route === 'draft' ? 'save' : route === 'settings' && !read ? 'saveSettings' : route, input);
      if (route === 'attachment') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(result.name)}`); res.end(Buffer.from(result.base64, 'base64')); }
      else json({ ...result, ok: true });
    } catch (e) { json({ ok: false, error: e.message }, 400); }
    return true;
  };
}
export function outreachHandler() {
  const handler = createOutreachRoutes(); let running = false;
  handler.start = () => {
    const tick = async () => { if (running) return; running = true; try { await runOutreach('tick'); } catch (e) { console.warn('[outreach]', e.message); } finally { running = false; } };
    void runOutreach('recover').catch(e => console.warn('[outreach]', e.message)).finally(() => { void tick(); const timer = setInterval(() => void tick(), 30000); timer.unref(); });
  };
  return handler;
}
