import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
  GITHUB_TOKEN: string;   // Personal Access Token with workflow:write scope
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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.GITHUB_TOKEN) {
    return Response.json({ error: "GITHUB_TOKEN not configured" }, { status: 503 });
  }

  const res = await fetch(
    "https://api.github.com/repos/atishay-kasliwal/job-pipeline/actions/workflows/update-pages.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "atriveo-app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (res.status === 204) {
    return Response.json({ ok: true, message: "Workflow triggered — data refreshes in ~60s" });
  }

  const body = await res.text();
  return Response.json({ error: `GitHub API error ${res.status}: ${body}` }, { status: 502 });
};
