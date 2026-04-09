import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
  MONGO_DATA_API_KEY: string;
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

async function mongoFind(
  apiKey: string,
  database: string,
  collection: string,
  filter: object = {},
  sort: object = {},
  limit = 1000
) {
  const res = await fetch(
    "https://data.mongodb-api.com/app/data-api/endpoint/data/v1/action/find",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        dataSource: "AtriveoAirflow",
        database,
        collection,
        filter,
        sort,
        limit,
      }),
    }
  );
  const data = (await res.json()) as { documents: object[] };
  return data.documents || [];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "today";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let jobs: object[] = [];

  if (type === "today") {
    // All sessions from today
    const sessions = await mongoFind(
      env.MONGO_DATA_API_KEY,
      "job_pipeline",
      "sessions",
      { pipeline: "standard", archived: false, run_at: { $gte: { $date: today.toISOString() } } },
      { run_at: -1 },
      48
    );
    const sids = sessions.map((s: any) => s.session_id);
    if (sids.length) {
      jobs = await mongoFind(
        env.MONGO_DATA_API_KEY,
        "job_pipeline",
        "jobs",
        { session_id: { $in: sids } },
        { score: -1 },
        2000
      );
    }
  } else if (type === "hour") {
    const sessions = await mongoFind(
      env.MONGO_DATA_API_KEY,
      "job_pipeline",
      "sessions",
      { pipeline: "standard", archived: false },
      { run_at: -1 },
      1
    );
    if (sessions.length) {
      jobs = await mongoFind(
        env.MONGO_DATA_API_KEY,
        "job_pipeline",
        "jobs",
        { session_id: (sessions[0] as any).session_id },
        { score: -1 },
        500
      );
    }
  } else if (type === "runs") {
    jobs = await mongoFind(
      env.MONGO_DATA_API_KEY,
      "job_pipeline",
      "sessions",
      { pipeline: "standard", archived: false },
      { run_at: -1 },
      48
    );
  }

  return Response.json(jobs, {
    headers: { "Cache-Control": "no-store" },
  });
};
