import { getTailorServerBase, tailorSidecarErrorMessage } from "./tailorServer";

export interface MongoResumeState {
  status?: "queued" | "running" | "success" | "failed" | "skipped" | null;
  stage?: string | null;
  fingerprint?: string | null;
  lease_until?: string | null;
  worker_id?: string | null;
  updated_at?: string | null;
  error?: string | null;
  company?: string | null;
  title?: string | null;
  pdf_path?: string | null;
  run_dir?: string | null;
  resume_slot?: number | null;
  session_hour?: string | null;
  batch_time?: string | null;
  folder?: string | null;
}

export interface CompileQueueJob {
  job_url: string;
  company?: string;
  title?: string;
  score_pct?: number | null;
  batch_time?: string | null;
  resume?: MongoResumeState | null;
}

export interface CompileWorker {
  worker_id: string;
  hostname?: string | null;
  planner?: string | null;
  out_root?: string | null;
  drive_mounted?: boolean | null;
  status?: "idle" | "busy" | "offline" | string;
  current_job_url?: string | null;
  last_seen_at?: string | null;
  started_at?: string | null;
}

function tailorHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

async function sidecarFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${getTailorServerBase()}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(tailorSidecarErrorMessage(res.status, data?.error));
  }
  return data;
}

export async function fetchCompileQueue(limit = 100): Promise<CompileQueueJob[]> {
  const data = await sidecarFetch(`/compile-queue?limit=${limit}&t=${Date.now()}`);
  return Array.isArray(data.jobs) ? data.jobs as CompileQueueJob[] : [];
}

export async function fetchCompileQueueStats(): Promise<{ queued: number; running: number; active: number }> {
  return sidecarFetch("/compile-queue/stats");
}

export interface PipelineKpis {
  today: { postings: number; resumes: number };
  hour: { postings: number; resumes: number; hourLabel: string | null; sessionId: string | null; runAt: string | null };
}

export async function fetchPipelineKpis(): Promise<PipelineKpis> {
  return sidecarFetch("/compile-queue/kpis");
}

export async function fetchCompileWorkers(): Promise<CompileWorker[]> {
  const data = await sidecarFetch(`/compile-workers?t=${Date.now()}`);
  return Array.isArray(data.workers) ? data.workers as CompileWorker[] : [];
}

export async function enqueueCompileJob(job: {
  job_url: string;
  company?: string;
  title?: string;
  score_pct?: number | null;
  resume_slot?: number | null;
  session_hour?: string | null;
  batch_time?: string | null;
  force?: boolean;
}): Promise<{ skipped?: boolean; reason?: string; fingerprint?: string; pdf_path?: string }> {
  return sidecarFetch("/compile-enqueue", {
    method: "POST",
    headers: tailorHeaders(),
    body: JSON.stringify(job),
  });
}

export async function enqueueCompileTop(limit: number | null = null, minScore = 0): Promise<{ enqueued: number }> {
  return sidecarFetch("/compile-enqueue-top", {
    method: "POST",
    headers: tailorHeaders(),
    body: JSON.stringify({ limit: limit == null ? "all" : limit, min_score: minScore }),
  });
}

export async function enqueueCompileBatch(
  jobs: Array<{
    job_url: string;
    company?: string;
    title?: string;
    score_pct?: number | null;
    resume_slot?: number | null;
    session_hour?: string | null;
    batch_time?: string | null;
  }>,
  force = false,
): Promise<{ enqueued: number }> {
  const data = await sidecarFetch("/compile-enqueue-batch", {
    method: "POST",
    headers: tailorHeaders(),
    body: JSON.stringify({ jobs, force }),
  });
  return { enqueued: data.enqueued ?? 0 };
}

export async function cancelCompileJob(jobUrl: string): Promise<{ cancelled: boolean }> {
  return sidecarFetch("/compile-cancel", {
    method: "POST",
    headers: tailorHeaders(),
    body: JSON.stringify({ job_url: jobUrl }),
  });
}

export async function isMongoCompileAvailable(): Promise<boolean> {
  try {
    await fetchCompileQueue(1);
    return true;
  } catch {
    return false;
  }
}

interface CompileQueueStreamHandlers {
  limit?: number;
  onSnapshot: (jobs: CompileQueueJob[]) => void;
  onChange: (job: CompileQueueJob) => void;
  onConnect?: () => void;
  onDisconnect?: (err: Error) => void;
}

async function consumeCompileQueueSse(
  url: string,
  signal: AbortSignal,
  handlers: Pick<CompileQueueStreamHandlers, "onSnapshot" | "onChange"> & {
    onStreamError?: (message: string) => void;
  },
) {
  const res = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === "string" ? data.error : tailorSidecarErrorMessage(res.status));
  }
  if (!res.body) throw new Error("No stream body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      let event = "message";
      let data = "";
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;

      const payload = JSON.parse(data) as {
        ok?: boolean;
        jobs?: CompileQueueJob[];
        job?: CompileQueueJob;
        error?: string;
      };

      if (event === "snapshot" && Array.isArray(payload.jobs)) {
        handlers.onSnapshot(payload.jobs);
      } else if (event === "change" && payload.job) {
        handlers.onChange(payload.job);
      } else if (event === "error") {
        handlers.onStreamError?.(payload.error || "compile queue stream error");
      }
    }
  }
}

/** Live compile queue via SSE (Mongo change stream). Returns unsubscribe. */
export function subscribeCompileQueueStream(handlers: CompileQueueStreamHandlers): () => void {
  const limit = handlers.limit ?? 120;
  const url = `${getTailorServerBase()}/compile-queue/stream?limit=${limit}`;
  let cancelled = false;
  let reconnectMs = 2000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  const connect = async () => {
    if (cancelled) return;
    abortController?.abort();
    abortController = new AbortController();

    try {
      await consumeCompileQueueSse(`${url}&t=${Date.now()}`, abortController.signal, {
        onSnapshot: (jobs) => {
          reconnectMs = 2000;
          handlers.onSnapshot(jobs);
          handlers.onConnect?.();
        },
        onChange: (job) => handlers.onChange(job),
        onStreamError: (message) => handlers.onDisconnect?.(new Error(message)),
      });
    } catch (err) {
      if (cancelled) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === "AbortError") return;
      handlers.onDisconnect?.(error);
    }

    if (cancelled) return;
    reconnectTimer = setTimeout(() => { void connect(); }, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, 60_000);
  };

  void connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    abortController?.abort();
  };
}
