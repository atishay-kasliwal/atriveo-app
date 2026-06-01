import { jwtVerify } from "jose";

interface Env {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
  TRACKER_API_URL?: string;
  TRACKER_API_TOKEN?: string;
}

type AuthUser = {
  email: string;
  name?: string;
};

async function getAuthUser(request: Request, secret: string): Promise<AuthUser | null> {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email) return null;
    const name = typeof payload.name === "string" ? payload.name : undefined;
    return { email, name };
  } catch {
    return null;
  }
}

const EMPTY_TRACKER = {
  count: 0,
  todayCount: 0,
  todayDate: null,
  lastClickAt: null,
  lastJobTitle: null,
  lastCompany: null,
  appliedJobs: {},
};

type ApplyRecord = {
  clicks?: number;
  lastAppliedAt?: string;
  appliedAt?: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  jobApplicationId?: string | null;
  job_application_id?: string | null;
  trackerStatus?: "applied" | "rejected" | null;
};

type ApplyStats = {
  count?: number;
  todayCount?: number;
  todayDate?: string | null;
  lastClickAt?: string | null;
  lastJobTitle?: string | null;
  lastCompany?: string | null;
  appliedJobs?: Record<string, ApplyRecord>;
};

function latestAppliedJob(stats: ApplyStats): { jobUrl: string; record: ApplyRecord } | null {
  const appliedJobs = stats.appliedJobs;
  if (!appliedJobs || typeof appliedJobs !== "object") return null;

  let latest: { jobUrl: string; record: ApplyRecord; time: number } | null = null;
  for (const [jobUrl, record] of Object.entries(appliedJobs)) {
    if (!jobUrl || !record || typeof record !== "object") continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(jobUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) continue;

    const rawAppliedAt = record.lastAppliedAt || record.appliedAt;
    const time = rawAppliedAt ? Date.parse(rawAppliedAt) : 0;
    if (!Number.isFinite(time) || time <= 0) continue;
    if (!latest || time > latest.time) latest = { jobUrl, record, time };
  }
  return latest ? { jobUrl: latest.jobUrl, record: latest.record } : null;
}

function easternDateKey(iso: string | undefined): string | undefined {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function extractJobApplicationId(jobUrl: string): string | undefined {
  try {
    const url = new URL(jobUrl);
    const linkedInMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (linkedInMatch?.[1]) return linkedInMatch[1];
    const greenhouseId = url.searchParams.get("gh_jid");
    if (greenhouseId) return greenhouseId;
    const leverMatch = url.pathname.match(/\/([^/]+)$/);
    return leverMatch?.[1] || undefined;
  } catch {
    return undefined;
  }
}

async function getUserName(env: Env, email: string, tokenName?: string): Promise<string | undefined> {
  if (tokenName?.trim()) return tokenName.trim();
  const row = await env.atriveo_auth
    .prepare("SELECT name FROM users WHERE email = ?")
    .bind(email)
    .first<{ name: string }>()
    .catch(() => null);
  return row?.name?.trim() || undefined;
}

async function syncLatestApplicationToTracker(env: Env, user: AuthUser, stats: ApplyStats) {
  const trackerApiUrl = env.TRACKER_API_URL?.trim().replace(/\/+$/, "");
  const trackerApiToken = env.TRACKER_API_TOKEN?.trim();
  if (!trackerApiUrl || !trackerApiToken) return { configured: false };

  const latest = latestAppliedJob(stats);
  if (!latest) return { configured: true, skipped: "no-valid-application" };

  const title = String(latest.record.title || stats.lastJobTitle || "").trim();
  const company = String(latest.record.company || stats.lastCompany || "").trim();
  if (!title || !company) return { configured: true, skipped: "missing-title-or-company" };

  const submittedAt = latest.record.lastAppliedAt || latest.record.appliedAt || new Date().toISOString();
  const submittedLocalDate = easternDateKey(submittedAt);
  if (!submittedLocalDate) return { configured: true, skipped: "invalid-submitted-at" };

  const jobApplicationId =
    latest.record.jobApplicationId?.trim() ||
    latest.record.job_application_id?.trim() ||
    extractJobApplicationId(latest.jobUrl);
  const location = latest.record.location?.trim();
  const userName = await getUserName(env, user.email, user.name);

  const extractedJob: { url: string; location?: string } = {
    url: latest.jobUrl,
  };
  if (location) extractedJob.location = location;

  const application: {
    job_title: string;
    company: string;
    job_link: string;
    job_application_id?: string;
    keyword_match: "Medium";
    referral: "No";
    notes: string;
  } = {
    job_title: title,
    company,
    job_link: latest.jobUrl,
    keyword_match: "Medium",
    referral: "No",
    notes: "Applied from Atriveo Job Platform.",
  };
  if (jobApplicationId) application.job_application_id = jobApplicationId;

  const payload: {
    payload_version: "v1";
    user_email: string;
    user_name?: string;
    source: string;
    submitted_at: string;
    submitted_local_date: string;
    extracted_job: typeof extractedJob;
    application: typeof application;
  } = {
    payload_version: "v1",
    user_email: user.email,
    ...(userName ? { user_name: userName } : {}),
    source: "Atriveo Job Platform",
    submitted_at: submittedAt,
    submitted_local_date: submittedLocalDate,
    extracted_job: extractedJob,
    application,
  };

  const response = await fetch(`${trackerApiUrl}/integrations/atriveo/applications`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${trackerApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 200 || response.status === 201) {
    return { configured: true, synced: true, status: response.status };
  }
  if (response.status === 409) {
    return { configured: true, synced: true, duplicate: true, status: response.status };
  }

  const detail = await response.text().catch(() => "");
  return { configured: true, synced: false, status: response.status, error: detail.slice(0, 500) };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getAuthUser(request, env.JWT_SECRET);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const row = await env.atriveo_auth
    .prepare("SELECT data FROM apply_tracker WHERE email = ?")
    .bind(user.email)
    .first<{ data: string }>();

  const data = row ? JSON.parse(row.data) : EMPTY_TRACKER;
  return Response.json(data);
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getAuthUser(request, env.JWT_SECRET);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as ApplyStats;
  const data = JSON.stringify(body);

  await env.atriveo_auth
    .prepare(
      `INSERT INTO apply_tracker (email, data, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at`
    )
    .bind(user.email, data)
    .run();

  const trackerSync = await syncLatestApplicationToTracker(env, user, body).catch((error) => ({
    configured: Boolean(env.TRACKER_API_URL && env.TRACKER_API_TOKEN),
    synced: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  return Response.json({ ok: true, trackerSync });
};
