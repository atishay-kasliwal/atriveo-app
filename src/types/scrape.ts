/** Shapes returned by the sidecar's /scrape/* routes (scripts/scrape-control.mjs). */

export type ScrapeRunStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  /** State file said "running" but the process is gone — Mac slept, or it was killed. */
  | "interrupted";

export type ScrapePhaseStatus = "running" | "ok" | "failed" | "cancelled";

/** Fixed order the sidecar reports, so the UI can render steps before they start. */
export type ScrapePhaseName = "scrape" | "jd_export" | "feed_deploy" | "resume_queue";

export interface ScrapePhase {
  name: ScrapePhaseName | string;
  status: ScrapePhaseStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
}

export interface ScrapeRunState {
  runId: string | null;
  status: ScrapeRunStatus;
  phase: string | null;
  phases: ScrapePhase[];
  pid?: number;
  host?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
  exitCode?: number | null;
  /** today_count before/after the run — the UI shows the delta as "N new". */
  jobsBefore?: number | null;
  jobsAfter?: number | null;
  log?: string;
  error?: string;
}

export interface ScrapeStatusResponse {
  ok: boolean;
  running: boolean;
  knownPhases: ScrapePhaseName[];
  state: ScrapeRunState;
  logLines?: string[];
}

export interface ScrapeStartResponse {
  ok: boolean;
  runId?: string;
  state?: ScrapeRunState;
  error?: string;
  code?: number;
}

export const SCRAPE_PHASE_LABELS: Record<string, string> = {
  scrape: "Scrape",
  jd_export: "Descriptions",
  feed_deploy: "Deploy feed",
  resume_queue: "Queue resumes",
};
