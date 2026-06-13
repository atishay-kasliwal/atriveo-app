import type { Job } from "../types";

/** Companies that still have 2+ visible roles in the feed (ignores dismissed rows). */
export function multiRoleCompanies(jobs: Job[]): Set<string> {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const company = (job.company || "Unknown").trim() || "Unknown";
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([company]) => company),
  );
}
