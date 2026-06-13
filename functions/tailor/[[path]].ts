import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
  /** Public URL of the cloudflared tunnel → localhost:8787, e.g. https://tailor-relay.atriveo.com */
  TAILOR_ORIGIN?: string;
  /** Optional shared secret forwarded as X-Tailor-Token to the sidecar */
  TAILOR_TOKEN?: string;
}

async function requireAuth(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAuth(request, env))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const origin = env.TAILOR_ORIGIN?.trim();
  if (!origin) {
    return Response.json(
      {
        ok: false,
        error:
          "Tailor relay not configured on Cloudflare. Set TAILOR_ORIGIN to your tunnel URL, or run locally with npm run dev + npm run tailor.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/tailor/, "") || "/";
  const target = new URL(subpath + url.search, origin.replace(/\/$/, ""));

  const headers = new Headers(request.headers);
  headers.delete("host");
  if (env.TAILOR_TOKEN) {
    headers.set("X-Tailor-Token", env.TAILOR_TOKEN);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  try {
    const res = await fetch(target.toString(), init);
    const outHeaders = new Headers(res.headers);
    outHeaders.set("Access-Control-Allow-Origin", url.origin);
    return new Response(res.body, { status: res.status, headers: outHeaders });
  } catch {
    return Response.json(
      {
        ok: false,
        error:
          "Could not reach your Mac tailor relay. Ensure npm run tailor:prod is running and tailor-relay.atriveo.com resolves (npm run tailor:dns).",
      },
      { status: 502 },
    );
  }
};
