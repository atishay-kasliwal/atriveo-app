import { jwtVerify } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

interface Connector {
  id: string;
  name: string;
  endpoint_url: string;
  api_key: string;
  is_active: number;
  last_ping: string | null;
  last_status: number | null;
  created_at: string;
}

async function getEmail(request: Request, env: Env): Promise<string | null> {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    return (payload.email as string) ?? null;
  } catch {
    return null;
  }
}

// GET /api/connectors — list all connectors for current user
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await env.atriveo_auth
    .prepare("SELECT id, name, endpoint_url, is_active, last_ping, last_status, created_at FROM connectors WHERE user_email = ? ORDER BY created_at ASC")
    .bind(email)
    .all<Omit<Connector, "api_key">>();

  return Response.json({ connectors: rows.results });
};

// POST /api/connectors — create or update a connector
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { name?: string; endpoint_url?: string; api_key?: string; id?: string };
  const { name, endpoint_url, api_key, id } = body;

  if (!endpoint_url || !api_key) {
    return Response.json({ error: "endpoint_url and api_key are required" }, { status: 400 });
  }

  const cleanUrl = endpoint_url.replace(/\/$/, "");

  // Test the connection before saving
  let pingStatus = 0;
  try {
    const pingRes = await fetch(`${cleanUrl}/health`, {
      headers: { Authorization: `Bearer ${api_key}` },
      signal: AbortSignal.timeout(8000),
    });
    pingStatus = pingRes.status;
  } catch {
    return Response.json({ error: "Could not reach that endpoint. Is your backend running?" }, { status: 422 });
  }

  if (pingStatus !== 200) {
    return Response.json({ error: `Endpoint responded with ${pingStatus}. Check your URL and API key.` }, { status: 422 });
  }

  if (id) {
    // Update existing
    await env.atriveo_auth
      .prepare("UPDATE connectors SET name = ?, endpoint_url = ?, api_key = ?, last_ping = datetime('now'), last_status = ?, updated_at = datetime('now') WHERE id = ? AND user_email = ?")
      .bind(name ?? "My Instance", cleanUrl, api_key, pingStatus, id, email)
      .run();
    return Response.json({ ok: true, id });
  }

  // Insert new — if first connector, make it active
  const existingCount = await env.atriveo_auth
    .prepare("SELECT COUNT(*) as cnt FROM connectors WHERE user_email = ?")
    .bind(email)
    .first<{ cnt: number }>();

  const isFirst = (existingCount?.cnt ?? 0) === 0;
  const newId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await env.atriveo_auth
    .prepare("INSERT INTO connectors (id, user_email, name, endpoint_url, api_key, is_active, last_ping, last_status) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)")
    .bind(newId, email, name ?? "My Instance", cleanUrl, api_key, isFirst ? 1 : 0, pingStatus)
    .run();

  return Response.json({ ok: true, id: newId, is_active: isFirst });
};

// PATCH /api/connectors — switch active connector
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await request.json()) as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Deactivate all, then activate the chosen one
  await env.atriveo_auth
    .prepare("UPDATE connectors SET is_active = 0 WHERE user_email = ?")
    .bind(email)
    .run();

  await env.atriveo_auth
    .prepare("UPDATE connectors SET is_active = 1 WHERE id = ? AND user_email = ?")
    .bind(id, email)
    .run();

  return Response.json({ ok: true });
};

// DELETE /api/connectors — remove a connector
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await request.json()) as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  await env.atriveo_auth
    .prepare("DELETE FROM connectors WHERE id = ? AND user_email = ?")
    .bind(id, email)
    .run();

  // If we deleted the active one, promote the next connector
  await env.atriveo_auth
    .prepare(`
      UPDATE connectors SET is_active = 1
      WHERE user_email = ? AND id = (
        SELECT id FROM connectors WHERE user_email = ? ORDER BY created_at ASC LIMIT 1
      )
    `)
    .bind(email, email)
    .run();

  return Response.json({ ok: true });
};
