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
  notes?: string | null;
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

type SyncScope = "latest" | "today";

type AppliedJobEntry = {
  jobUrl: string;
  record: ApplyRecord;
  submittedAt: string;
  submittedLocalDate: string;
  time: number;
};

function appliedJobEntries(stats: ApplyStats): AppliedJobEntry[] {
  const appliedJobs = stats.appliedJobs;
  if (!appliedJobs || typeof appliedJobs !== "object") return [];

  const entries: AppliedJobEntry[] = [];
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
    const submittedLocalDate = easternDateKey(rawAppliedAt);
    if (!submittedLocalDate) continue;
    entries.push({ jobUrl, record, submittedAt: rawAppliedAt, submittedLocalDate, time });
  }
  return entries.sort((a, b) => a.time - b.time);
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

async function syncApplicationToTracker(
  env: Env,
  user: AuthUser,
  stats: ApplyStats,
  entry: AppliedJobEntry,
  userName: string | undefined,
  trackerApiUrl: string,
  trackerApiToken: string,
) {
  const title = String(entry.record.title || stats.lastJobTitle || "").trim();
  const company = String(entry.record.company || stats.lastCompany || "").trim();
  if (!title || !company) return { configured: true, skipped: "missing-title-or-company" };

  const jobApplicationId =
    entry.record.jobApplicationId?.trim() ||
    entry.record.job_application_id?.trim() ||
    extractJobApplicationId(entry.jobUrl);
  const location = entry.record.location?.trim();

  const extractedJob: { url: string; location?: string } = {
    url: entry.jobUrl,
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
    job_link: entry.jobUrl,
    keyword_match: "Medium",
    referral: "No",
    notes: entry.record.notes?.trim() || "Applied from Atriveo Job Platform.",
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
    submitted_at: entry.submittedAt,
    submitted_local_date: entry.submittedLocalDate,
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
    return { configured: true, synced: true, status: response.status, jobUrl: entry.jobUrl };
  }
  if (response.status === 409) {
    return { configured: true, synced: true, duplicate: true, status: response.status, jobUrl: entry.jobUrl };
  }

  const detail = await response.text().catch(() => "");
  return { configured: true, synced: false, status: response.status, error: detail.slice(0, 500), jobUrl: entry.jobUrl };
}

async function syncApplicationsToTracker(env: Env, user: AuthUser, stats: ApplyStats, scope: SyncScope) {
  const trackerApiUrl = env.TRACKER_API_URL?.trim().replace(/\/+$/, "");
  const trackerApiToken = env.TRACKER_API_TOKEN?.trim();
  const entries = appliedJobEntries(stats);
  if (!trackerApiUrl || !trackerApiToken) {
    return {
      configured: false,
      scope,
      jobUrl: scope === "latest" ? entries.at(-1)?.jobUrl : undefined,
      missing: [
        ...(!trackerApiUrl ? ["TRACKER_API_URL"] : []),
        ...(!trackerApiToken ? ["TRACKER_API_TOKEN"] : []),
      ],
    };
  }

  const today = easternDateKey(new Date().toISOString());
  const scopedEntries = scope === "today" && today
    ? entries.filter((entry) => entry.submittedLocalDate === today)
    : entries.slice(-1);
  if (!scopedEntries.length) return { configured: true, scope, skipped: "no-valid-application" };

  const userName = await getUserName(env, user.email, user.name);
  const selectedEntries = scope === "today" ? scopedEntries.slice(-150) : scopedEntries;
  const results = [];
  for (const entry of selectedEntries) {
    results.push(await syncApplicationToTracker(env, user, stats, entry, userName, trackerApiUrl, trackerApiToken));
  }

  if (scope === "latest") return results[0];

  return {
    configured: true,
    scope,
    total: results.length,
    synced: results.filter((result) => result.synced).length,
    duplicates: results.filter((result) => result.duplicate).length,
    failed: results.filter((result) => result.synced === false).length,
    skipped: results.filter((result) => result.skipped).length,
    results,
  };
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

  const syncScope: SyncScope = new URL(request.url).searchParams.get("sync") === "today" ? "today" : "latest";
  const trackerSync = await syncApplicationsToTracker(env, user, body, syncScope).catch((error) => ({
    configured: Boolean(env.TRACKER_API_URL && env.TRACKER_API_TOKEN),
    scope: syncScope,
    synced: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  return Response.json({ ok: true, trackerSync });
};
