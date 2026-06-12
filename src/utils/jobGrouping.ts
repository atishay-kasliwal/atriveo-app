import type { Job } from "../types";
import { careerOpsRating } from "./jobPresentation";

export interface CompanyJobGroup {
  company: string;
  jobs: Job[];
  bestScore: number;
}

export function groupJobsByCompany(jobs: Job[]): CompanyJobGroup[] {
  const map = new Map<string, Job[]>();
  for (const job of jobs) {
    const company = (job.company || "Unknown").trim() || "Unknown";
    const list = map.get(company) ?? [];
    list.push(job);
    map.set(company, list);
  }

  return [...map.entries()]
    .map(([company, groupJobs]) => {
      const sorted = [...groupJobs].sort(
        (a, b) => careerOpsRating(b).score - careerOpsRating(a).score,
      );
      return {
        company,
        jobs: sorted,
        bestScore: careerOpsRating(sorted[0]).score,
      };
    })
    .sort((a, b) => b.bestScore - a.bestScore);
}
