import { jwtVerify } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

interface Exclusions {
  companies: string[];
  keywords: string[];
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const row = await env.atriveo_auth
    .prepare("SELECT exclusions FROM user_prefs WHERE email = ?")
    .bind(email)
    .first<{ exclusions: string }>();

  const exclusions: Exclusions = row
    ? (JSON.parse(row.exclusions) as Exclusions)
    : { companies: [], keywords: [] };

  return Response.json(exclusions);
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as Exclusions;
  const exclusions = JSON.stringify({
    companies: Array.isArray(body.companies) ? body.companies.map(String) : [],
    keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
  });

  await env.atriveo_auth
    .prepare(
      `INSERT INTO user_prefs (email, exclusions, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         exclusions = excluded.exclusions,
         updated_at = excluded.updated_at`
    )
    .bind(email, exclusions)
    .run();

  return Response.json({ ok: true });
};
