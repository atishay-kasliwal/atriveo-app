import type { TailorExplainSummary } from "./tailorExplain";

export type TailorLogKind = "step" | "think" | "result" | "warn" | "error";

export interface TailorLogEntry {
  id: string;
  index: number;
  kind: TailorLogKind;
  text: string;
  at: string;
  step?: number;
  elapsedMs?: number;
}

export type TailorPhase = "queued" | "analyzing" | "assembling" | "compiling" | "reviewing" | "done";

export interface TailorJobState {
  index: number;
  company: string;
  role: string;
  phase: TailorPhase;
  status?: string;
  ats?: string;
  folder?: string;
  dir?: string;
  pdfPath?: string;
  pdf?: boolean;
  error?: string;
  headerTitle?: string;
  logs: TailorLogEntry[];
  explain?: TailorExplainSummary;
  borderline?: boolean;
}

export interface TailorRunState {
  active: boolean;
  total: number;
  completed: number;
  dateDir?: string;
  model?: string;
  jobs: TailorJobState[];
  runLogs: TailorLogEntry[];
  summary?: string;
  fatalError?: string;
}

export type TailorStreamEvent =
  | { type: "start"; total: number; dateDir?: string; model?: string }
  | { type: "job"; index: number; phase: TailorPhase; company?: string; role?: string; status?: string; ats?: string; folder?: string; dir?: string; pdfPath?: string; pdf?: boolean; error?: string; headerTitle?: string; explain?: TailorExplainSummary; borderline?: boolean }
  | { type: "log"; index: number; kind: TailorLogKind; text: string; step?: number; elapsedMs?: number; ts?: string }
  | { type: "ping"; ts?: string }
  | { type: "end" }
  | { type: "fatal"; error: string };
