import type { TailorExplainSummary } from "./tailorExplain";

export type JobResumeStatus =
  | "never"
  | "queued"
  | "compiling"
  | "ready"
  | "borderline"
  | "unsupported"
  | "failed"
  | "skipped"
  | "no-jd";

export type CompileStage = "gate" | "compose" | "optimize" | "tex" | "pdf";

export interface JobResumeView {
  status: JobResumeStatus;
  stage?: CompileStage;
  stageLabel?: string;
  identityPrimary?: string;
  identityConfidence?: number;
  compiledAt?: string;
  pdfPath?: string;
  folderPath?: string;
  explain?: TailorExplainSummary;
  summaryBullets?: string[];
  confidenceLabel?: "High" | "Medium" | "Low";
  statusLine: string;
  subLine?: string;
}

export interface JobActivityView {
  appliedAt?: string;
  appliedLabel?: string;
}
