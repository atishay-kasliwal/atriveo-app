import type { Job } from "../types";
import type { SortBy, SortDir } from "../pages/Dashboard.types";
import type { TailorRecord } from "../types/tailorQueue";
import { careerOpsRating } from "./jobPresentation";
import { tailorSortRank } from "./tailorOutcome";

export type TailorRecordLookup = (job: Job) => TailorRecord | null | undefined;

/** Higher = further along (done on top when sorting desc). */
export function tailorSortValue(record: TailorRecord | null | undefined): number {
  if (!record || record.status === "none") return 0;
  return tailorSortRank(record);
}

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:\d{2})$/;

const LEVEL_ORDER: Record<string, number> = {
  "New Grad": 0,
  Entry: 1,
  Mid: 2,
};

function toMs(iso?: string | null): number {
  if (!iso) return 0;
  const value = iso.trim();
  if (!value) return 0;
  const normalized = TZ_SUFFIX_RE.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function defaultSortDir(column: SortBy): SortDir {
  switch (column) {
    case "company":
    case "location":
    case "level":
      return "asc";
    default:
      return "desc";
  }
}

export function compareJobs(
  a: Job,
  b: Job,
  sortBy: SortBy,
  sortDir: SortDir,
  getTailorRecord?: TailorRecordLookup,
): number {
  const mul = sortDir === "asc" ? 1 : -1;

  switch (sortBy) {
    case "score":
    case "rating":
      return mul * (careerOpsRating(a).score - careerOpsRating(b).score);
    case "company": {
      const byCompany = (a.company || "").localeCompare(b.company || "", undefined, { sensitivity: "base" });
      if (byCompany !== 0) return mul * byCompany;
      return mul * (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
    }
    case "location":
      return mul * ((a.location || "").localeCompare(b.location || "", undefined, { sensitivity: "base" }));
    case "comp":
      return mul * ((a.competition_score ?? -1) - (b.competition_score ?? -1));
    case "level": {
      const la = LEVEL_ORDER[a.level || ""] ?? 99;
      const lb = LEVEL_ORDER[b.level || ""] ?? 99;
      if (la !== lb) return mul * (la - lb);
      return mul * (a.level || "").localeCompare(b.level || "", undefined, { sensitivity: "base" });
    }
    case "time":
      return mul * (toMs(a.batch_time || a.date_posted) - toMs(b.batch_time || b.date_posted));
    case "ats":
      return mul * ((a.ats_score ?? -1) - (b.ats_score ?? -1));
    case "fit":
      return mul * ((a.fit_score ?? -1) - (b.fit_score ?? -1));
    case "tailored": {
      if (!getTailorRecord) return 0;
      const delta = tailorSortValue(getTailorRecord(a)) - tailorSortValue(getTailorRecord(b));
      if (delta !== 0) return mul * delta;
      return mul * (careerOpsRating(a).score - careerOpsRating(b).score);
    }
    default:
      return 0;
  }
}

export function sortJobs(
  jobs: Job[],
  sortBy: SortBy,
  sortDir: SortDir,
  getTailorRecord?: TailorRecordLookup,
): Job[] {
  return [...jobs].sort((a, b) => compareJobs(a, b, sortBy, sortDir, getTailorRecord));
}
