import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
  ASSETS: Fetcher;
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") || "";
  if (!/^[0-9a-f]{2}$/.test(bucket)) {
    return Response.json({ error: "Invalid bucket" }, { status: 400 });
  }

  const assetUrl = new URL(`/job_descriptions/${bucket}.json`, request.url);
  const assetRes = await env.ASSETS.fetch(assetUrl.toString());
  if (!assetRes.ok) return Response.json({}, { headers: { "Cache-Control": "no-store" } });

  return new Response(assetRes.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
