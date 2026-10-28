import { jwtVerify } from "jose";
import { emailAllowed, type AdminEnv } from "../../_lib/admin";
interface Env extends AdminEnv { JWT_SECRET: string; TAILOR_ORIGIN?: string; TAILOR_TOKEN?: string }
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const route = url.pathname.replace('/api/push/', '');
  if (!['config', 'subscription', 'test', 'health'].includes(route)) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return new Response(null, { status: 405 });
  if (request.method !== 'GET' && (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json'))) return Response.json({ error: 'Same-origin JSON required' }, { status: 403 });
  let userId: string;
  const health = route === 'health';
  if (health) {
    if (request.method !== 'GET' || !env.TAILOR_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.TAILOR_TOKEN}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    userId = 'health@atriveo.invalid';
  } else {
    const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)atriveo_token=([^;]+)/)?.[1];
    try {
      const { payload } = await jwtVerify(token || '', new TextEncoder().encode(env.JWT_SECRET));
      if (typeof payload.email !== 'string' || !emailAllowed(env, payload.email)) throw new Error();
      userId = payload.email.toLowerCase();
    } catch { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  }
  if (!env.TAILOR_ORIGIN || !env.TAILOR_TOKEN) return Response.json({ error: 'Push backend not configured' }, { status: 503 });
  const body = request.method === 'GET' ? undefined : await request.text();
  if (body && body.length > 8192) return Response.json({ error: 'Payload too large' }, { status: 413 });
  try {
    const res = await fetch(new URL(`/push/${health ? 'config' : route}`, env.TAILOR_ORIGIN.trim()), {
      method: request.method, redirect: 'manual', signal: AbortSignal.timeout(20000), body,
      headers: { 'Accept-Encoding': 'identity', 'Content-Type': 'application/json', 'X-Tailor-Token': env.TAILOR_TOKEN, 'X-Atriveo-Push-User': userId },
    });
    if (res.status >= 300 && res.status < 400) return Response.json({ error: 'Push backend redirect refused' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    // These endpoints return small JSON objects, not streams. Consume the
    // upstream response so transport encoding and headers cannot leak through.
    if (!res.headers.get('Content-Type')?.includes('application/json')) return Response.json({ error: `Push backend returned an unexpected response (HTTP ${res.status})` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    const data = await res.json();
    return Response.json(data, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Push backend unreachable' }, { status: 502 }); }
};
