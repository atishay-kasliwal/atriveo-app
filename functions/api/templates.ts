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

interface TemplateBody {
  id?: number;
  title?: string;
  body?: string;
}

// List the logged-in user's outreach templates, newest first.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { results } = await env.atriveo_auth
    .prepare(
      `SELECT id, title, body, created_at FROM outreach_templates
       WHERE email = ? ORDER BY created_at DESC`
    )
    .bind(email)
    .all();

  return Response.json({ templates: results ?? [] });
};

// Create a new template (or update if an id is supplied).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json()) as TemplateBody;
  const title = (b.title || "").trim();
  const body = (b.body || "").trim();
  if (!body) return Response.json({ error: "body is required" }, { status: 400 });

  if (b.id) {
    await env.atriveo_auth
      .prepare(
        "UPDATE outreach_templates SET title = ?, body = ? WHERE id = ? AND email = ?"
      )
      .bind(title, body, b.id, email)
      .run();
  } else {
    await env.atriveo_auth
      .prepare("INSERT INTO outreach_templates (email, title, body) VALUES (?, ?, ?)")
      .bind(email, title, body)
      .run();
  }

  return Response.json({ ok: true });
};

// Delete a template by id (must belong to the logged-in user).
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  await env.atriveo_auth
    .prepare("DELETE FROM outreach_templates WHERE id = ? AND email = ?")
    .bind(id, email)
    .run();

  return Response.json({ ok: true });
};
