import type { Job } from "../types";
import type { TailorQueueItem, TailorRecord, TailorRecordStatus } from "../types/tailorQueue";
import type { CompileQueueJob } from "./compileQueueApi";
import { careerOpsRating } from "./jobPresentation";
import { parseFolderSlot, parseSessionHourFromPath } from "./resumeSlot";

export function jobKeyFromCompileJob(job: CompileQueueJob): string {
  return job.job_url || `${job.company || ""}::${job.title || ""}`;
}

function mapQueueStatus(status?: string | null): TailorQueueItem["status"] {
  switch (status) {
    case "queued": return "pending";
    case "running": return "running";
    case "success": return "done";
    case "failed": return "failed";
    case "skipped": return "skipped";
    default: return "pending";
  }
}

function mapRecordStatus(status?: string | null): TailorRecordStatus {
  switch (status) {
    case "queued": return "queued";
    case "running": return "running";
    case "success": return "done";
    case "failed": return "failed";
    case "skipped": return "failed";
    default: return "none";
  }
}

function stageToProgress(stage?: string | null): number {
  switch (stage) {
    case "QUEUED": return 8;
    case "GATED": return 18;
    case "COMPOSED": return 38;
    case "OPTIMIZED": return 52;
    case "TEX": return 72;
    case "PDF": return 88;
    case "SUCCESS": return 100;
    default: return 12;
  }
}

export function compileJobToQueueItem(job: CompileQueueJob, feedJob?: Job | null): TailorQueueItem {
  const resume = job.resume;
  const status = mapQueueStatus(resume?.status);
  const score = job.score_pct ?? (feedJob ? careerOpsRating(feedJob).score : 0);
  const jobKey = jobKeyFromCompileJob(job);
  return {
    jobKey,
    jobUrl: job.job_url,
    title: job.title || resume?.title || feedJob?.title || "Untitled role",
    company: job.company || resume?.company || feedJob?.company || "Unknown",
    score,
    priority: score,
    enqueuedAt: resume?.updated_at || new Date().toISOString(),
    hourBatch: (resume?.updated_at || "").slice(0, 13),
    source: "hourly",
    status,
    error: resume?.error || undefined,
    startedAt: status === "running" ? resume?.updated_at || undefined : undefined,
    jobSnapshot: feedJob || undefined,
  };
}

export function compileJobToTailorRecord(job: CompileQueueJob, feedJob?: Job | null): TailorRecord | null {
  const resume = job.resume;
  if (!resume?.status) return null;
  const status = mapRecordStatus(resume.status);
  const jobKey = jobKeyFromCompileJob(job);
  const score = job.score_pct ?? (feedJob ? careerOpsRating(feedJob).score : undefined);
  const progressPct = resume.status === "success"
    ? 100
    : resume.status === "running"
      ? stageToProgress(resume.stage)
      : undefined;
  const folder = resume.folder
    || (resume.run_dir ? resume.run_dir.split("/").filter(Boolean).pop() : undefined);
  const resumeSlot = resume.resume_slot
    ?? parseFolderSlot(folder || resume.run_dir || resume.pdf_path)
    ?? undefined;
  const sessionHour = resume.session_hour
    ?? parseSessionHourFromPath(resume.run_dir || resume.pdf_path)
    ?? undefined;

  return {
    jobKey,
    jobUrl: job.job_url,
    company: job.company || resume.company || feedJob?.company || "Unknown",
    title: job.title || resume.title || feedJob?.title || "Role",
    status,
    score,
    tailoredAt: resume.status === "success" ? resume.updated_at || undefined : undefined,
    pdfPath: resume.pdf_path || undefined,
    dir: resume.run_dir || undefined,
    folder,
    resumeSlot,
    sessionHour,
    progressPct,
    error: resume.error || undefined,
    compileStage: resume.stage || undefined,
    workerId: resume.worker_id || undefined,
    outcome: resume.status === "success"
      ? "done"
      : resume.status === "running"
        ? "running"
        : resume.status === "queued"
          ? "queued"
          : "error",
    serverStatus: resume.status === "success" ? "ok" : resume.error || resume.status || undefined,
  };
}

export function buildQueueFromMongo(jobs: CompileQueueJob[], feedJobs: Job[]): TailorQueueItem[] {
  const feedByUrl = new Map(feedJobs.filter((j) => j.job_url).map((j) => [j.job_url!, j]));
  return jobs
    .filter((j) => j.resume?.status)
    .map((j) => compileJobToQueueItem(j, feedByUrl.get(j.job_url) ?? null))
    .sort((a, b) => {
      const order = (s: TailorQueueItem["status"]) => (
        s === "running" ? 0 : s === "pending" ? 1 : 2
      );
      if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
      return b.score - a.score;
    });
}

export function syncRecordsFromMongo(
  jobs: CompileQueueJob[],
  feedJobs: Job[],
  markStatus: (jobKey: string, status: TailorRecordStatus, patch?: Partial<TailorRecord>) => void,
) {
  const feedByUrl = new Map(feedJobs.filter((j) => j.job_url).map((j) => [j.job_url!, j]));
  for (const job of jobs) {
    const rec = compileJobToTailorRecord(job, feedByUrl.get(job.job_url) ?? null);
    if (!rec) continue;
    markStatus(rec.jobKey, rec.status, rec);
  }
}

/** Apply one SSE delta onto the cached Mongo job list. */
export function mergeCompileJobChange(jobs: CompileQueueJob[], change: CompileQueueJob): CompileQueueJob[] {
  const idx = jobs.findIndex((j) => j.job_url === change.job_url);
  if (!change.resume?.status) {
    if (idx < 0) return jobs;
    return jobs.filter((_, i) => i !== idx);
  }
  if (idx >= 0) {
    const next = jobs.slice();
    next[idx] = change;
    return next;
  }
  return [change, ...jobs];
}
