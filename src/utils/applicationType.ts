import type { Job } from "../types";

export function applicationLabel(job: Pick<Job, "apply_type">): string {
  return job.apply_type === "easy_apply" ? "Easy Apply" : "Open Link";
}

export function applicationHint(job: Pick<Job, "apply_type">): string {
  if (job.apply_type === "easy_apply") return "Apply using LinkedIn Easy Apply";
  if (job.apply_type === "offsite") return "Open the posting to apply on the company website";
  if (job.apply_type === "closed") return "This posting was marked closed";
  return "Open the posting; application type has not been verified";
}
