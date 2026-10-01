// Inbox watcher (playatriveo) → the job feed's Applied list.
// GET  /api/tracker/inbox?user_email=…                 entries (url, title, company, status)
// PATCH /api/tracker/inbox  { user_email, job_url, tracker_status, note? }
// Bearer INBOX_API_TOKEN (not a login cookie; the middleware lets this path through).
// A status set here is time-stamped (trackerStatusAt), and PUT /api/tracker keeps it unless
// the page sends a newer change, so an open tab can't silently undo it.

interface Env {
  atriveo_auth: D1Database;
  INBOX_API_TOKEN?: string;
}

type Entry = Record<string, unknown> & {
  title?: string | null;
  company?: string | null;
  trackerStatus?: "applied" | "rejected" | null;
  trackerStatusAt?: string | null;
  trackerStatusBy?: "you" | "inbox" | null;
  notes?: string | null;
  lastAppliedAt?: string;
};

function authorized(request: Request, env: Env): boolean {
  const expected = env.INBOX_API_TOKEN?.trim();
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && bearer && bearer === expected);
}

async function loadData(env: Env, email: string): Promise<{ appliedJobs?: Record<string, Entry> } & Record<string, unknown> | null> {
  const row = await env.atriveo_auth.prepare("SELECT data FROM apply_tracker WHERE email = ?").bind(email).first<{ data: string }>();
  return row ? JSON.parse(row.data) : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const email = new URL(request.url).searchParams.get("user_email")?.trim().toLowerCase();
  if (!email) return Response.json({ error: "user_email is required" }, { status: 400 });
  const data = await loadData(env, email);
  const entries = Object.entries(data?.appliedJobs ?? {}).map(([jobUrl, e]) => ({
    jobUrl,
    title: e.title ?? null,
    company: e.company ?? null,
    trackerStatus: e.trackerStatus ?? null,
    lastAppliedAt: e.lastAppliedAt ?? null,
  }));
  return Response.json({ entries });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { user_email?: string; job_url?: string; tracker_status?: string; note?: string } | null;
  const email = body?.user_email?.trim().toLowerCase();
  const jobUrl = body?.job_url?.trim();
  const status = body?.tracker_status;
  if (!email || !jobUrl || (status !== "applied" && status !== "rejected")) {
    return Response.json({ error: "user_email, job_url and tracker_status (applied|rejected) are required" }, { status: 400 });
  }
  const data = await loadData(env, email);
  const entry = data?.appliedJobs?.[jobUrl];
  if (!data || !entry) return Response.json({ error: "Not found" }, { status: 404 });
  const note = body?.note?.trim().slice(0, 300);
  data.appliedJobs![jobUrl] = {
    ...entry,
    trackerStatus: status,
    trackerStatusAt: new Date().toISOString(),
    trackerStatusBy: "inbox",
    notes: note && !String(entry.notes ?? "").includes(note) ? [entry.notes, note].filter(Boolean).join("\n") : entry.notes ?? null,
  };
  await env.atriveo_auth
    .prepare("UPDATE apply_tracker SET data = ?, updated_at = datetime('now') WHERE email = ?")
    .bind(JSON.stringify(data), email)
    .run();
  return Response.json({ ok: true, entry: { jobUrl, ...data.appliedJobs![jobUrl] } });
};
