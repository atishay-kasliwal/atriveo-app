import type { Job } from "../types";
import type { ApplyRecord } from "../hooks/useApplyTracker";
import type { TailorRecord } from "../types/tailorQueue";
import { resolveTailorOutcome } from "./tailorOutcome";

export function isResumeReady(record: TailorRecord | null | undefined): boolean {
  if (!record?.pdfPath) return false;
  const outcome = resolveTailorOutcome(record);
  return outcome === "done" || outcome === "borderline";
}

export function isJobReadyToApply(
  _job: Job,
  record: TailorRecord | null | undefined,
  applyRecord?: ApplyRecord | null,
): boolean {
  if (!isResumeReady(record)) return false;
  if (applyRecord?.lastAppliedAt) return false;
  return true;
}

export function countReadyToApply(
  jobs: Job[],
  getRecord: (job: Job) => TailorRecord | null,
  getApply: (url: string) => ApplyRecord | null,
): number {
  let n = 0;
  for (const job of jobs) {
    if (!job.job_url) continue;
    if (isJobReadyToApply(job, getRecord(job), getApply(job.job_url))) n += 1;
  }
  return n;
}

export function countAppliedToday(
  jobs: Job[],
  getApply: (url: string) => ApplyRecord | null,
  todayKey: string,
): number {
  let n = 0;
  for (const job of jobs) {
    if (!job.job_url) continue;
    const applied = getApply(job.job_url)?.lastAppliedAt;
    if (!applied) continue;
    const d = new Date(applied);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (key === todayKey) n += 1;
  }
  return n;
}
