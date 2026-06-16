import type { Job } from "../types";
import type { TailorLogEntry, TailorStreamEvent } from "../types/tailor";
import type { TailorOutcomeKind } from "../types/tailorQueue";
import type { TailorExplainSummary } from "../types/tailorExplain";
import type { ResumeArtifacts } from "./resumeDiff";
import { outcomeFromError, outcomeFromServerStatus } from "./tailorOutcome";
import { captureTailorStreamEvent, resetTailorLogCapture, trimTailorLogs } from "./tailorLogCapture";
import { loadJobDescriptions } from "./jobDescriptionBuckets";
import { getTailorServerBase, isLocalTailorHost } from "./tailorServer";

const MIN_JD_HARD_CHARS = 200;
const MIN_JD_IDEAL_CHARS = 400;
/** Ollama + compile can take several minutes; abort if the relay stream stalls longer. */
const TAILOR_JOB_TIMEOUT_MS = 18 * 60 * 1000;

let activeAbort: AbortController | null = null;

export function abortActiveTailorJob(): void {
  activeAbort?.abort();
}

function tailorUnavailableMessage(): string {
  if (!isLocalTailorHost()) {
    return "Tailor relay unreachable. Start npm run tailor:prod on your Mac.";
  }
  return "Tailor server not running. Run: npm run tailor";
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

async function readTailorStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TailorStreamEvent) => void,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Tailor stream aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as TailorStreamEvent);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

export async function assertTailorServerReady(signal?: AbortSignal): Promise<void> {
  const base = getTailorServerBase();
  const res = await fetch(`${base}/health`, {
    signal: signal ?? AbortSignal.timeout(8000),
    credentials: "include",
  });
  if (!res.ok) throw new Error(tailorUnavailableMessage());
  const data = await res.json();
  if (!data.ok) throw new Error(tailorUnavailableMessage());
  if (!data.driveMounted) {
    throw new Error('External drive not mounted. Plug in "Kasliwal v2" and retry.');
  }
}

export interface SingleTailorResult {
  ok: boolean;
  ats?: string;
  pdfPath?: string;
  dir?: string;
  folder?: string;
  error?: string;
  logs?: TailorLogEntry[];
  serverStatus?: string;
  outcome?: TailorOutcomeKind;
  explain?: TailorExplainSummary;
  borderline?: boolean;
}

export async function checkJobOnDisk(job: Job): Promise<{ found: boolean; pdfPath?: string; dir?: string; folder?: string; ats?: string }> {
  try {
    const res = await fetch(`${getTailorServerBase()}/check-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ company: job.company || "", title: job.title || "" }),
    });
    if (!res.ok) return { found: false };
    const data = await res.json();
    return data.found ? { found: true, pdfPath: data.pdfPath, dir: data.dir, folder: data.folder, ats: data.ats } : { found: false };
  } catch {
    return { found: false };
  }
}

export interface TailoredResumeOnDisk {
  folder: string;
  dateDir: string;
  dir: string;
  pdfPath: string;
  company: string;
  title: string;
  jobUrl: string;
  score: number | null;
  ats: string | null;
  tailoredAt: string | null;
  identity?: string | null;
  informationGain?: number | null;
  borderline?: boolean;
}

/** Full composition + explain payload for diff / detail views. */
export async function fetchResumeArtifacts(dir: string): Promise<ResumeArtifacts | null> {
  try {
    const res = await fetch(
      `${getTailorServerBase()}/resume-artifacts?dir=${encodeURIComponent(dir)}&t=${Date.now()}`,
      { cache: "no-store", credentials: "include", signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    return {
      dir: String(data.dir || dir),
      selectedAcs: Array.isArray(data.selectedAcs) ? data.selectedAcs as string[] : [],
      explain: data.explain ?? null,
      identity: data.identity ?? null,
      informationGain: data.informationGain ?? null,
      borderline: Boolean(data.borderline),
      coverage: data.coverage ?? null,
      graphCoverage: data.graphCoverage ?? null,
      hiringManager: data.hiringManager ?? null,
    };
  } catch {
    return null;
  }
}

/** Source-of-truth list of created resumes, read from the Mac drive (not localStorage). */
export async function listTailoredResumes(): Promise<TailoredResumeOnDisk[]> {
  try {
    const res = await fetch(`${getTailorServerBase()}/list-tailored?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.resumes) ? data.resumes as TailoredResumeOnDisk[] : [];
  } catch {
    return [];
  }
}

export async function openTailorPath(targetPath: string): Promise<void> {
  const res = await fetch(`${getTailorServerBase()}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ path: targetPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || "Could not open folder");
}

export async function runSingleTailorJob(
  job: Job,
  onEvent?: (event: TailorStreamEvent) => void,
): Promise<SingleTailorResult> {
  const resumeText = localStorage.getItem("atriveo_resume") || "";

  const controller = new AbortController();
  activeAbort = controller;
  const timeoutId = window.setTimeout(() => controller.abort(), TAILOR_JOB_TIMEOUT_MS);

  try {
    await assertTailorServerReady(controller.signal);
    const descriptionsByUrl = await loadJobDescriptions([job]);
    const bucketJd = job.job_url ? descriptionsByUrl[job.job_url] : undefined;
    const isManualJob = job.site === "manual" || (job.job_url || "").startsWith("manual://");
    const jd = bucketJd || job.summary || "";
    if (jd.trim().length < MIN_JD_HARD_CHARS) {
      return { ok: false, error: "Job description is too short — paste the full posting (200+ characters).", outcome: "no-jd" };
    }
    if (!bucketJd && !isManualJob && jd.trim().length < MIN_JD_IDEAL_CHARS) {
      return {
        ok: false,
        error: "Only a short job snippet is available — paste the full JD in Tailor Lab or wait for scrape.",
        outcome: "no-jd",
      };
    }

    let result: SingleTailorResult = {
      ok: false,
      error: "Connection dropped while tailoring — check your Mac output folder; the PDF may still have been created.",
      outcome: "timeout",
    };
    resetTailorLogCapture();
    let logs: TailorLogEntry[] = [];

    const res = await fetch(`${getTailorServerBase()}/tailor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        resumeText,
        jobs: [{
          company: job.company,
          title: job.title,
          job_url: job.job_url,
          score_pct: job.score_pct,
          jd,
        }],
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok && !contentType.includes("ndjson")) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, error: err.error || "Tailor failed", outcome: outcomeFromError(err.error) };
    }
    if (!res.body) {
      return { ok: false, error: "No response from tailor server", outcome: "offline" };
    }

    await readTailorStream(res.body, (event) => {
      logs = captureTailorStreamEvent(logs, event, 0);
      onEvent?.(event);
      if (event.type === "fatal") {
        const outcome = outcomeFromError(event.error);
        result = { ok: false, error: event.error, logs: trimTailorLogs([...logs]), outcome };
        return;
      }
      if (event.type !== "job" || event.index !== 0) return;
      if (event.phase !== "done") return;
      const serverStatus = event.status;
      if (event.status === "ok" && event.pdf) {
        const borderline = event.borderline === true || event.explain?.borderline === true;
        result = {
          ok: true,
          ats: event.ats,
          pdfPath: event.pdfPath,
          dir: event.dir,
          folder: event.folder,
          logs: trimTailorLogs([...logs]),
          serverStatus: "ok",
          outcome: borderline ? "borderline" : "done",
          explain: event.explain,
          borderline,
        };
        return;
      }
      if (event.status === "no-go") {
        result = {
          ok: false,
          error: event.error || "no-go: not worth tailoring",
          dir: event.dir,
          folder: event.folder,
          logs: trimTailorLogs([...logs]),
          serverStatus: "no-go",
          outcome: "skip",
        };
        return;
      }
      if (event.status === "unsupported-jd") {
        result = {
          ok: false,
          error: event.error || "Unsupported job description — not an engineering role.",
          dir: event.dir,
          folder: event.folder,
          logs: trimTailorLogs([...logs]),
          serverStatus: "unsupported-jd",
          outcome: "unsupported",
        };
        return;
      }
      const outcome = outcomeFromServerStatus(serverStatus, event.error);
      result = {
        ok: false,
        error: event.error || `Tailor finished with status ${event.status || "unknown"}`,
        ats: event.ats,
        pdfPath: event.pdfPath,
        dir: event.dir,
        folder: event.folder,
        logs: trimTailorLogs([...logs]),
        serverStatus,
        outcome,
      };
    }, controller.signal);

    if (!result.logs?.length && logs.length) {
      result = { ...result, logs: trimTailorLogs([...logs]) };
    }

    // If the stream ended without a "done" event (stream dropped mid-run), check
    // whether the Mac actually finished the job and wrote a PDF to disk.
    if (!result.ok && (result.outcome === "timeout" || result.outcome === "error" || result.outcome === "ai")) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const check = await checkJobOnDisk(job);
        if (check.found) {
          return {
            ok: true,
            ats: check.ats,
            pdfPath: check.pdfPath,
            dir: check.dir,
            folder: check.folder,
            logs: result.logs,
            serverStatus: "ok",
            outcome: "done",
          };
        }
        if (attempt < 3) await new Promise((r) => window.setTimeout(r, 5000));
      }
    }

    return result;
  } catch (err) {
    if (isAbortError(err)) {
      const check = await checkJobOnDisk(job);
      if (check.found) {
        return {
          ok: true,
          ats: check.ats,
          pdfPath: check.pdfPath,
          dir: check.dir,
          folder: check.folder,
          serverStatus: "ok",
          outcome: "done",
        };
      }
      return {
        ok: false,
        error: "Connection dropped while tailoring — Ollama may still be running on your Mac. Check the output folder or wait and retry.",
        outcome: "timeout",
      };
    }
    const message = (err as Error).message || String(err);
    return { ok: false, error: message, outcome: outcomeFromError(message) };
  } finally {
    window.clearTimeout(timeoutId);
    if (activeAbort === controller) activeAbort = null;
  }
}
