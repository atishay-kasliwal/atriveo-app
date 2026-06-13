import type { Job } from "../types";
import type { SortBy, SortDir } from "../pages/Dashboard.types";
import { careerOpsRating } from "./jobPresentation";
import { compareJobs, type TailorRecordLookup } from "./jobSort";

export interface CompanyJobGroup {
  company: string;
  jobs: Job[];
  bestScore: number;
}

export function groupJobsByCompany(
  jobs: Job[],
  sortBy: SortBy = "score",
  sortDir: SortDir = "desc",
  getTailorRecord?: TailorRecordLookup,
): CompanyJobGroup[] {
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
    group.jobs.sort((a, b) => compareJobs(a, b, sortBy, sortDir, getTailorRecord));
    group.bestScore = Math.max(...group.jobs.map((job) => careerOpsRating(job).score));
  }

  groups.sort((a, b) => {
    if (sortBy === "company") {
      const byCompany = a.company.localeCompare(b.company, undefined, { sensitivity: "base" });
      if (byCompany !== 0) return compareJobs(a.jobs[0], b.jobs[0], "company", sortDir, getTailorRecord);
      return compareJobs(a.jobs[0], b.jobs[0], "score", "desc", getTailorRecord);
    }
    return compareJobs(a.jobs[0], b.jobs[0], sortBy, sortDir, getTailorRecord);
  });

  return groups;
}
