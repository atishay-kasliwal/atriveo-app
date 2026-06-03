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

interface ContactBody {
  contact_email?: string;
  name?: string;
  company?: string;
  domain?: string;
  linkedin_url?: string;
  source?: string;
  score?: number;
  notes?: string;
  status?: string;
}

// List the logged-in user's saved recruiter contacts, newest first.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { results } = await env.atriveo_auth
    .prepare(
      `SELECT id, contact_email, name, company, domain, linkedin_url, source, score, notes, status, created_at
       FROM recruiter_contacts WHERE email = ? ORDER BY created_at DESC`
    )
    .bind(email)
    .all();

  return Response.json({ contacts: results ?? [] });
};

// Save (or update) a recruiter contact. Unique on (owner, contact_email).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json()) as ContactBody;
  const contactEmail = (b.contact_email || "").trim().toLowerCase();
  if (!contactEmail) {
    return Response.json({ error: "contact_email is required" }, { status: 400 });
  }

  await env.atriveo_auth
    .prepare(
      `INSERT INTO recruiter_contacts
         (email, contact_email, name, company, domain, linkedin_url, source, score, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email, contact_email) DO UPDATE SET
         name = excluded.name,
         company = excluded.company,
         domain = excluded.domain,
         linkedin_url = excluded.linkedin_url,
         source = excluded.source,
         score = excluded.score,
         notes = excluded.notes,
         status = excluded.status`
    )
    .bind(
      email,
      contactEmail,
      b.name ?? "",
      b.company ?? "",
      b.domain ?? "",
      b.linkedin_url ?? "",
      b.source ?? "guess",
      Number.isFinite(b.score) ? Math.round(b.score as number) : 0,
      b.notes ?? "",
      b.status ?? "saved"
    )
    .run();

  return Response.json({ ok: true });
};

// Delete a saved contact by id (must belong to the logged-in user).
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env.JWT_SECRET);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  await env.atriveo_auth
    .prepare("DELETE FROM recruiter_contacts WHERE id = ? AND email = ?")
    .bind(id, email)
    .run();

  return Response.json({ ok: true });
};
