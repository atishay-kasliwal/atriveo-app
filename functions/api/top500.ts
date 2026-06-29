import { jwtVerify } from "jose";

const ADMIN_EMAIL = "katishay@gmail.com";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

interface Top500Row {
  id: string;
  name: string;
  domain: string | null;
  normalized_name: string;
  ticker: string | null;
  sector: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
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

function normalizeName(name: string): string {
  return name
    .replace(/\b(llc|llp|lp|inc|corp|corporation|ltd|limited|co|company|companies|technologies|technology|tech|solutions|services|service|systems|system|group|international|global|americas|america|holdings|holding|ventures|partners|associates|consulting|consultants|staffing|software|enterprises|enterprise)\b[.,]?/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^www\./, "").trim() || null;
}

// GET /api/top500 — list all (with optional ?q= search)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "1000"), 2000);

  let rows: { results: Top500Row[] };
  if (q) {
    rows = await env.atriveo_auth
      .prepare("SELECT * FROM top500_companies WHERE lower(name) LIKE ? OR lower(domain) LIKE ? OR lower(ticker) LIKE ? ORDER BY name ASC LIMIT ?")
      .bind(`%${q}%`, `%${q}%`, `%${q}%`, limit)
      .all<Top500Row>();
  } else {
    rows = await env.atriveo_auth
      .prepare("SELECT * FROM top500_companies ORDER BY name ASC LIMIT ?")
      .bind(limit)
      .all<Top500Row>();
  }

  return Response.json({ companies: rows.results, total: rows.results.length });
};

// POST /api/top500 — add one or bulk seed
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (email !== ADMIN_EMAIL) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // Bulk seed from built-in list
  if (action === "seed") {
    const body = (await request.json()) as { companies: { name: string; domain?: string; normalized_name?: string; ticker?: string; sector?: string }[] };
    let inserted = 0;
    let skipped = 0;
    for (const c of body.companies) {
      const normalized = c.normalized_name ?? normalizeName(c.name);
      const domain = normalizeDomain(c.domain);
      try {
        await env.atriveo_auth
          .prepare(`INSERT OR IGNORE INTO top500_companies (name, domain, normalized_name, ticker, sector)
                    VALUES (?, ?, ?, ?, ?)`)
          .bind(c.name, domain, normalized, c.ticker ?? null, c.sector ?? null)
          .run();
        inserted++;
      } catch {
        skipped++;
      }
    }
    return Response.json({ ok: true, inserted, skipped });
  }

  // Single add
  const body = (await request.json()) as { name: string; domain?: string; ticker?: string; sector?: string; logo_url?: string };
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });

  const name = body.name.trim();
  const domain = normalizeDomain(body.domain);
  const normalized = normalizeName(name);

  try {
    const row = await env.atriveo_auth
      .prepare(`INSERT INTO top500_companies (name, domain, normalized_name, ticker, sector, logo_url)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING *`)
      .bind(name, domain, normalized, body.ticker ?? null, body.sector ?? null, body.logo_url ?? null)
      .first<Top500Row>();
    return Response.json({ company: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return Response.json({ error: "Company already exists" }, { status: 409 });
    return Response.json({ error: msg }, { status: 500 });
  }
};

// PUT /api/top500 — update one (id in body)
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (email !== ADMIN_EMAIL) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { id: string; name?: string; domain?: string; ticker?: string; sector?: string; logo_url?: string };
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });

  const existing = await env.atriveo_auth
    .prepare("SELECT * FROM top500_companies WHERE id = ?")
    .bind(body.id)
    .first<Top500Row>();
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const name = body.name?.trim() ?? existing.name;
  const domain = body.domain !== undefined ? normalizeDomain(body.domain) : existing.domain;
  const normalized = normalizeName(name);

  try {
    const row = await env.atriveo_auth
      .prepare(`UPDATE top500_companies
                SET name = ?, domain = ?, normalized_name = ?, ticker = ?, sector = ?, logo_url = ?, updated_at = datetime('now')
                WHERE id = ?
                RETURNING *`)
      .bind(name, domain, normalized, body.ticker ?? existing.ticker, body.sector ?? existing.sector, body.logo_url ?? existing.logo_url, body.id)
      .first<Top500Row>();
    return Response.json({ company: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return Response.json({ error: "Domain or name already exists" }, { status: 409 });
    return Response.json({ error: msg }, { status: 500 });
  }
};

// DELETE /api/top500?id=xxx — delete one
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const email = await getEmail(request, env);
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (email !== ADMIN_EMAIL) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const result = await env.atriveo_auth
    .prepare("DELETE FROM top500_companies WHERE id = ?")
    .bind(id)
    .run();

  if (!result.meta.changes) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
};
