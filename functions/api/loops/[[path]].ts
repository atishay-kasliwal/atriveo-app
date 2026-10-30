import { jwtVerify } from "jose";
import { emailAllowed, type AdminEnv } from "../../_lib/admin";
interface Env extends AdminEnv { JWT_SECRET: string; TAILOR_ORIGIN?: string; TAILOR_TOKEN?: string }

// Loops (docs/loops.md): checks your sign-in cookie, then forwards to the dashboard sidecar with the shared token and your email.
// The Mac worker never comes through here: it calls the sidecar's /loops/worker/* itself, with only the token.
const ACTIONS = new Set(['confirm', 'edit', 'done', 'snooze', 'dismiss', 'retry', 'reopen', 'transcript']);
const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/loops\/?/, '').split('/').filter(Boolean);
  const audioUpload = request.method === 'POST' && parts[0] === 'capture' && parts[1] === 'audio' && parts.length === 2;
  const known = parts.length === 0 ? request.method === 'GET'
    : parts[0] === 'summary' ? request.method === 'GET' && parts.length === 1
    : parts[0] === 'capture' ? (parts.length === 1 && request.method === 'POST') || audioUpload
    : ID.test(parts[0]) && ((parts.length === 1 && request.method === 'GET') || (parts.length === 2 && parts[1] === 'audio' && request.method === 'GET') || (parts.length === 2 && ACTIONS.has(parts[1]) && request.method === 'POST'));
  if (!known) return Response.json({ error: 'Not found' }, { status: 404 });
  const type = request.headers.get('Content-Type') ?? '';
  if (request.method === 'POST' && (request.headers.get('Origin') !== url.origin || !(audioUpload ? type.startsWith('audio/') : type.startsWith('application/json')))) return Response.json({ error: 'Same-origin request required' }, { status: 403 });
  let userId: string;
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
  try {
    const { payload } = await jwtVerify(token || '', new TextEncoder().encode(env.JWT_SECRET));
    if (typeof payload.email !== 'string' || !emailAllowed(env, payload.email)) throw new Error();
    userId = payload.email.toLowerCase();
  } catch { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!env.TAILOR_ORIGIN || !env.TAILOR_TOKEN) return Response.json({ error: 'Loops backend not configured' }, { status: 503 });
  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > (audioUpload ? 8 * 1024 * 1024 : 64_000)) return Response.json({ error: 'Payload too large' }, { status: 413 });
  try {
    const res = await fetch(new URL(`/loops${parts.length ? '/' + parts.join('/') : ''}${url.search}`, env.TAILOR_ORIGIN.trim()), {
      method: request.method, redirect: 'manual', signal: AbortSignal.timeout(30000), body,
      headers: { 'Accept-Encoding': 'identity', 'Content-Type': type || 'application/json', 'X-Tailor-Token': env.TAILOR_TOKEN, 'X-Atriveo-User': userId, ...(request.headers.get('Range') ? { Range: request.headers.get('Range')! } : {}) },
    });
    if (res.status >= 300 && res.status < 400) return Response.json({ error: 'Loops backend redirect refused' }, { status: 502 });
    const out = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) { const v = res.headers.get(h); if (v) out.set(h, v); }
    return new Response(res.body, { status: res.status, headers: out });
  } catch { return Response.json({ error: 'Loops backend unreachable' }, { status: 502 }); }
};
