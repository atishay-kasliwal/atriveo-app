import { jwtVerify } from "jose";
import { emailAllowed, type AdminEnv } from "../../_lib/admin";
interface Env extends AdminEnv { JWT_SECRET: string; TAILOR_ORIGIN?: string; TAILOR_TOKEN?: string }
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const route = url.pathname.replace('/api/push/', '');
  if (!['config', 'subscription', 'test', 'health'].includes(route)) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return new Response(null, { status: 405 });
  if (request.method !== 'GET' && (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json'))) return Response.json({ error: 'Same-origin JSON required' }, { status: 403 });
  if (route === 'health') {
    if (request.method !== 'GET' || !env.TAILOR_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.TAILOR_TOKEN}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!env.TAILOR_ORIGIN) return Response.json({ error: 'Relay not configured' }, { status: 503 });
    try {
      const target = new URL('/push/config', env.TAILOR_ORIGIN);
      const upstream = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Tailor-Token': env.TAILOR_TOKEN, 'X-Atriveo-Push-User': 'health@atriveo.invalid' } });
      const text = await upstream.text();
      let publicKeyBytes = 0;
      try { publicKeyBytes = JSON.parse(text).publicKey?.length || 0; } catch { /* Report response metadata only. */ }
      return Response.json({ host: target.hostname, upstreamStatus: upstream.status, contentType: upstream.headers.get('Content-Type'), encoding: upstream.headers.get('Content-Encoding'), publicKeyBytes, pageTitle: text.match(/<title[^>]*>([^<]{0,120})<\/title>/i)?.[1] || null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Relay failed' }, { status: 502 }); }
  }
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
  let userId: string;
  try {
    const { payload } = await jwtVerify(token || '', new TextEncoder().encode(env.JWT_SECRET));
    if (typeof payload.email !== 'string' || !emailAllowed(env, payload.email)) throw new Error();
    userId = payload.email.toLowerCase();
  } catch { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!env.TAILOR_ORIGIN || !env.TAILOR_TOKEN) return Response.json({ error: 'Push backend not configured' }, { status: 503 });
  const body = request.method === 'GET' ? undefined : await request.text();
  if (body && body.length > 8192) return Response.json({ error: 'Payload too large' }, { status: 413 });
  try {
    const res = await fetch(new URL(`/push/${route}`, env.TAILOR_ORIGIN), {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(20000), body,
      headers: { 'Content-Type': 'application/json', 'X-Tailor-Token': env.TAILOR_TOKEN, 'X-Atriveo-Push-User': userId },
    });
    // Workers may pass the upstream compressed stream through unchanged. Preserve
    // Content-Encoding so the browser can decode it before parsing the JSON.
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  } catch { return Response.json({ error: 'Push backend unreachable' }, { status: 502 }); }
};
