import type { Job } from "../types";
import type { TailorStreamEvent } from "../types/tailor";
import { loadJobDescriptions } from "./jobDescriptionBuckets";
import { getTailorServerBase, isLocalTailorHost } from "./tailorServer";

function tailorUnavailableMessage(): string {
  if (!isLocalTailorHost()) {
    return "Tailor relay unreachable. Start npm run tailor:prod on your Mac.";
  }
  return "Tailor server not running. Run: npm run tailor";
}

async function readTailorStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TailorStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
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
}

async function assertTailorServerReady(): Promise<void> {
  const base = getTailorServerBase();
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000), credentials: "include" });
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
  error?: string;
}

export async function runSingleTailorJob(job: Job): Promise<SingleTailorResult> {
  const resumeText = localStorage.getItem("atriveo_resume") || "";
  if (resumeText.trim().length < 50) {
    return { ok: false, error: "Save your resume in Settings first." };
  }

  await assertTailorServerReady();
  const descriptionsByUrl = await loadJobDescriptions([job]);
  const jd = descriptionsByUrl[job.job_url] || job.summary || "";
  if (jd.trim().length < 50) {
    return { ok: false, error: "No full JD captured for this job." };
  }

  let result: SingleTailorResult = { ok: false, error: "Tailor stream ended without result" };

  const res = await fetch(`${getTailorServerBase()}/tailor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
    return { ok: false, error: err.error || "Tailor failed" };
  }
  if (!res.body) return { ok: false, error: "No response from tailor server" };

  await readTailorStream(res.body, (event) => {
    if (event.type === "fatal") {
      result = { ok: false, error: event.error };
      return;
    }
    if (event.type !== "job" || event.index !== 0) return;
    if (event.phase !== "done") return;
    if (event.status === "ok" && event.pdf) {
      result = {
        ok: true,
        ats: event.ats,
        pdfPath: event.pdfPath,
      };
      return;
    }
    if (event.status === "no-go") {
      result = { ok: false, error: "no-go: not worth tailoring" };
      return;
    }
    result = {
      ok: false,
      error: event.error || `Tailor finished with status ${event.status || "unknown"}`,
      ats: event.ats,
      pdfPath: event.pdfPath,
    };
  });

  return result;
}
