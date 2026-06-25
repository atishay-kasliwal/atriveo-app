import { jwtVerify } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

interface ConnectorRow {
  endpoint_url: string;
  api_key: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  // Auth
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let email: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    email = (payload.email as string).toLowerCase();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get active connector
  const connector = await env.atriveo_auth
    .prepare("SELECT endpoint_url, api_key FROM connectors WHERE user_email = ? AND is_active = 1 LIMIT 1")
    .bind(email)
    .first<ConnectorRow>();

  if (!connector) {
    return Response.json({ error: "No active connector. Complete onboarding first.", code: "NO_CONNECTOR" }, { status: 503 });
  }

  // Forward request
  const pathParts = Array.isArray(params.path) ? params.path : [params.path ?? ""];
  const subPath = pathParts.join("/");
  const targetUrl = new URL(request.url);
  const forwardUrl = `${connector.endpoint_url}/${subPath}${targetUrl.search}`;

  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set("Authorization", `Bearer ${connector.api_key}`);
  forwardHeaders.delete("Cookie"); // Don't forward session cookie to the backend

  try {
    const upstreamRes = await fetch(forwardUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    // Update last_ping in background (non-blocking)
    env.atriveo_auth
      .prepare("UPDATE connectors SET last_ping = datetime('now'), last_status = ? WHERE user_email = ? AND is_active = 1")
      .bind(upstreamRes.status, email)
      .run()
      .catch(() => {});

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Backend unreachable", code: "UPSTREAM_TIMEOUT" }, { status: 502 });
  }
};
