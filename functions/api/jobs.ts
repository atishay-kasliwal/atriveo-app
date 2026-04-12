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
  const type = url.searchParams.get("type") || "today";

  const fileMap: Record<string, string> = {
    hour:      "/jobs.json",
    today:     "/today_jobs.json",
    yesterday: "/yesterday_jobs.json",
    week:      "/week_jobs.json",
    runs:      "/run_history.json",
    important: "/important_jobs.json",
  };

  const file = fileMap[type] || "/jobs.json";

  // Serve the static JSON asset through the Pages ASSETS binding
  const assetRes = await env.ASSETS.fetch(new URL(file, request.url).toString());
  const data = await assetRes.json();

  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
};
