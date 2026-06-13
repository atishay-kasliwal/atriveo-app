import type { Job } from "../types";
import type { TailorStreamEvent } from "../types/tailor";
import { jobDismissKey } from "./jobCopy";

type StreamTailorStatus = {
  applyStreamEvent: (
    jobKey: string,
    event: TailorStreamEvent,
    base?: {
      jobUrl?: string;
      company?: string;
      title?: string;
      score?: number;
    },
  ) => void;
};

export function buildTailorStreamHandler(
  tailorStatus: StreamTailorStatus,
  job: Job,
  options?: { shouldSkip?: () => boolean },
): (event: TailorStreamEvent) => void {
  const key = jobDismissKey(job);
  const base = {
    jobUrl: job.job_url || "",
    company: job.company || "Unknown",
    title: job.title || "Untitled role",
    score: job.score_pct,
  };

  return (event: TailorStreamEvent) => {
    if (options?.shouldSkip?.()) return;
    tailorStatus.applyStreamEvent(key, event, base);
  };
}
