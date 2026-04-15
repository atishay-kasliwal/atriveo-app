import { jwtVerify } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

async function getEmail(request: Request, secret: string): Promise<string | null> {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return (payload.email as string) || null;
  } catch {
    return null;
  }
}

const EMPTY_TRACKER = {
  count: 0,
  lastClickAt: null,
  lastJobTitle: null,
  lastCompany: null,
  appliedJobs: {},
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const row = await env.atriveo_auth
    .prepare("SELECT data FROM apply_tracker WHERE email = ?")
    .bind(email)
    .first<{ data: string }>();

  const data = row ? JSON.parse(row.data) : EMPTY_TRACKER;
  return Response.json(data);
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = JSON.stringify(body);

  await env.atriveo_auth
    .prepare(
      `INSERT INTO apply_tracker (email, data, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at`
    )
    .bind(email, data)
    .run();

  return Response.json({ ok: true });
};
