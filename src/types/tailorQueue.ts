import type { TailorLogEntry } from "./tailor";
import type { Job } from "./index";

import type { TailorExplainSummary } from "./tailorExplain";

export type TailorQueueSource = "hourly" | "manual";

export type TailorQueueItemStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TailorQueueItem {
  jobKey: string;
  jobUrl: string;
  title: string;
  company: string;
  score: number;
  priority: number;
  enqueuedAt: string;
  hourBatch: string;
  source: TailorQueueSource;
  status: TailorQueueItemStatus;
  error?: string;
  startedAt?: string;
  durationMs?: number;
  /** Frozen job payload so queue items work off-feed (manual tailor lab). */
  jobSnapshot?: Job;
}

export interface TailorProcessLogEntry {
  id: string;
  at: string;
  message: string;
  durationMs?: number;
  /** Real result classification so the UI can label honestly (not just "Failed"). */
  outcome?: TailorOutcomeKind;
}

export type TailorRecordStatus = "none" | "queued" | "running" | "done" | "failed" | "no-go";

/** Specific tailor result — used for table labels and tooltips. */
export type TailorOutcomeKind =
  | "done"
  | "running"
  | "queued"
  | "skip"
  | "compile"
  | "ai"
  | "no-jd"
  | "no-resume"
  | "offline"
  | "timeout"
  | "missing"
  | "unsupported"
  | "borderline"
  | "error";

export interface TailorRecord {
  jobKey: string;
  jobUrl: string;
  company: string;
  title: string;
  status: TailorRecordStatus;
  score?: number;
  ats?: string;
  tailoredAt?: string;
  pdfPath?: string;
  dir?: string;
  folder?: string;
  progressPct?: number;
  error?: string;
  logs?: TailorLogEntry[];
  durationMs?: number;
  /** Specific result for UI labels (compile, skip, offline, etc.). */
  outcome?: TailorOutcomeKind;
  /** Raw server status: ok | no-go | unsupported-jd | tex-failed | ai-failed */
  serverStatus?: string;
  /** Evidence compiler explain artifact (identity, swaps, IG). */
  explain?: TailorExplainSummary;
  borderline?: boolean;
  /** Mongo compile stage (GATED, COMPOSED, …) when worker-owned. */
  compileStage?: string;
  workerId?: string;
  /** Matches folder prefix `NN-company-role` and table # column. */
  resumeSlot?: number;
  /** ET hour folder segment (matches sidebar session time). */
  sessionHour?: string;
}

export const HOURLY_QUEUE_SIZE = 25;
export const HOURLY_SYNC_MS = 60 * 60 * 1000;
