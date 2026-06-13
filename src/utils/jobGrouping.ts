import type { Job } from "../types";
import { careerOpsRating } from "./jobPresentation";

export interface CompanyJobGroup {
  company: string;
  jobs: Job[];
  bestScore: number;
}

export function groupJobsByCompany(jobs: Job[]): CompanyJobGroup[] {
  const groups: CompanyJobGroup[] = [];
  const indexByCompany = new Map<string, number>();

  for (const job of jobs) {
    const company = (job.company || "Unknown").trim() || "Unknown";
    let idx = indexByCompany.get(company);
    if (idx === undefined) {
      idx = groups.length;
      indexByCompany.set(company, idx);
      groups.push({ company, jobs: [], bestScore: 0 });
    }
    groups[idx].jobs.push(job);
  }

  for (const group of groups) {
    group.bestScore = Math.max(...group.jobs.map((job) => careerOpsRating(job).score));
  }

  return groups;
}
