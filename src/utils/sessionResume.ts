import type { Job } from "../types";
import { careerOpsRating } from "./jobPresentation";

const TZ = "America/New_York";

export interface SessionResumeMeta {
  slot: number;
  hour: string;
  sessionId: string;
}

/** ET hour folder segment (00–23) from batch_time — matches sidebar session time. */
export function sessionHourFromBatch(batchTime?: string | null): string {
  if (!batchTime) return "00";
  const d = new Date(batchTime);
  if (Number.isNaN(d.getTime())) return "00";
  const hour = Number(d.toLocaleString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }));
  return String(hour).padStart(2, "0");
}

function sessionKey(job: Job): string {
  return job.session_id || `hour:${sessionHourFromBatch(job.batch_time)}`;
}

/** Slot within each pipeline session (score order), keyed by job_url. */
export function buildSessionResumeSlots(jobs: Job[]): Map<string, SessionResumeMeta> {
  const bySession = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!job.job_url) continue;
    const key = sessionKey(job);
    const list = bySession.get(key) || [];
    list.push(job);
    bySession.set(key, list);
  }

  const out = new Map<string, SessionResumeMeta>();
  for (const [sessionId, sessionJobs] of bySession) {
    const sorted = [...sessionJobs].sort(
      (a, b) => careerOpsRating(b).score - careerOpsRating(a).score,
    );
    sorted.forEach((job, i) => {
      if (!job.job_url) return;
      out.set(job.job_url, {
        slot: i + 1,
        hour: sessionHourFromBatch(job.batch_time),
        sessionId,
      });
    });
  }
  return out;
}

export function formatResumeId(hour: string, slot: number, compact = false): string {
  const slotLabel = String(slot).padStart(2, "0");
  return compact ? slotLabel : `${hour}·${slotLabel}`;
}
