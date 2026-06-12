export type TailorPhase = "queued" | "analyzing" | "assembling" | "compiling" | "done";

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
}

export interface TailorRunState {
  active: boolean;
  total: number;
  completed: number;
  dateDir?: string;
  model?: string;
  jobs: TailorJobState[];
  summary?: string;
  fatalError?: string;
}

export type TailorStreamEvent =
  | { type: "start"; total: number; dateDir?: string; model?: string }
  | { type: "job"; index: number; phase: TailorPhase; company?: string; role?: string; status?: string; ats?: string; folder?: string; dir?: string; pdfPath?: string; pdf?: boolean; error?: string; headerTitle?: string }
  | { type: "end" }
  | { type: "fatal"; error: string };
