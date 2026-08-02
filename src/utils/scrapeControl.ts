/**
 * Client for the on-demand scrape routes on the Mac sidecar.
 *
 * Same transport as tailoring: localhost:8787 in dev, /tailor/* through the
 * Cloudflare relay in production. That relay already enforces the session JWT,
 * so nothing here needs its own auth.
 */
import { getTailorServerBase, tailorSidecarErrorMessage, tailorUnavailableMessage } from "./tailorServer";
import type { ScrapeStartResponse, ScrapeStatusResponse, ScrapeRunState } from "../types/scrape";

const IDLE_STATE: ScrapeRunState = {
  runId: null,
  status: "idle",
  phase: null,
  phases: [],
};

/** Network failure here means the Mac is asleep/offline, not that the app broke. */
export class ScrapeOfflineError extends Error {
  constructor() {
    super(tailorUnavailableMessage());
    this.name = "ScrapeOfflineError";
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return tailorSidecarErrorMessage(res.status, body?.error);
  } catch {
    return tailorSidecarErrorMessage(res.status);
  }
}

export async function fetchScrapeStatus(
  { withLog = false, signal }: { withLog?: boolean; signal?: AbortSignal } = {},
): Promise<ScrapeStatusResponse> {
  const qs = new URLSearchParams({ t: String(Date.now()) });
  if (withLog) qs.set("log", "1");
  let res: Response;
  try {
    res = await fetch(`${getTailorServerBase()}/scrape/status?${qs}`, {
      credentials: "include",
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ScrapeOfflineError();
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as ScrapeStatusResponse;
  return { ...data, state: data.state ?? IDLE_STATE };
}

/**
 * Start a run. A 409 means one is already going — surfaced as `ok: false` with
 * the live state rather than thrown, so the UI can just attach to it.
 */
export async function startScrapeRun(
  opts: { skipResume?: boolean; skipDeploy?: boolean } = {},
): Promise<ScrapeStartResponse> {
  let res: Response;
  try {
    res = await fetch(`${getTailorServerBase()}/scrape/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(opts),
    });
  } catch {
    throw new ScrapeOfflineError();
  }
  const body = (await res.json().catch(() => null)) as ScrapeStartResponse | null;
  if (res.status === 409 && body) return { ...body, ok: false, code: 409 };
  if (!res.ok) throw new Error(body?.error || (await readError(res)));
  return body ?? { ok: false, error: "Empty response from the Mac." };
}

export async function cancelScrapeRun(): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${getTailorServerBase()}/scrape/cancel`, {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ScrapeOfflineError();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error || (await readError(res)) };
  return { ok: true };
}

export async function fetchScrapeLog(lines = 200): Promise<string[]> {
  try {
    const res = await fetch(`${getTailorServerBase()}/scrape/log?lines=${lines}&t=${Date.now()}`, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.lines) ? (body.lines as string[]) : [];
  } catch {
    return [];
  }
}

/** Human "3m 12s" for the elapsed/total readouts. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

export function scrapeElapsedMs(state: ScrapeRunState, now: number): number {
  if (!state.startedAt) return 0;
  const start = Date.parse(state.startedAt);
  if (Number.isNaN(start)) return 0;
  const end = state.finishedAt ? Date.parse(state.finishedAt) : now;
  return (Number.isNaN(end) ? now : end) - start;
}

/** Jobs added by the run, when both counts were captured. */
export function scrapeJobDelta(state: ScrapeRunState): number | null {
  if (state.jobsBefore == null || state.jobsAfter == null) return null;
  return state.jobsAfter - state.jobsBefore;
}
