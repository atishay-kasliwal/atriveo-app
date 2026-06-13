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
}

export interface TailorProcessLogEntry {
  id: string;
  at: string;
  message: string;
  durationMs?: number;
}

export type TailorRecordStatus = "none" | "queued" | "running" | "done" | "failed" | "no-go";

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
}

export const HOURLY_QUEUE_SIZE = 25;
export const HOURLY_SYNC_MS = 60 * 60 * 1000;
