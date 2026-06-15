import type { TailorRecord, TailorOutcomeKind } from "../types/tailorQueue";

export interface TailorCellDisplay {
  label: string;
  tone: string;
  tooltip: string;
}

const OUTCOME_DISPLAY: Record<TailorOutcomeKind, Omit<TailorCellDisplay, "tooltip"> & { tooltip?: string }> = {
  done: { label: "100%", tone: "done" },
  running: { label: "…", tone: "running" },
  queued: { label: "Queued", tone: "queued" },
  skip: { label: "Skip", tone: "skip", tooltip: "Not worth tailoring — eligibility or fit blocked" },
  compile: { label: "Compile", tone: "compile", tooltip: "PDF compile failed (Tectonic)" },
  ai: { label: "AI err", tone: "ai", tooltip: "Model step failed (Ollama)" },
  "no-jd": { label: "No JD", tone: "warn", tooltip: "No full job description available" },
  "no-resume": { label: "No CV", tone: "warn", tooltip: "Save your resume in Settings first" },
  offline: { label: "Offline", tone: "offline", tooltip: "Tailor server or relay unreachable" },
  timeout: { label: "Timeout", tone: "timeout", tooltip: "Connection dropped while tailoring" },
  missing: { label: "Missing", tone: "warn", tooltip: "Job no longer in feed" },
  unsupported: { label: "N/A JD", tone: "warn", tooltip: "Not an engineering job description — tailoring skipped" },
  borderline: { label: "Warn", tone: "warn", tooltip: "Borderline JD — PDF created with low-confidence warning" },
  error: { label: "Error", tone: "error", tooltip: "Tailor run failed" },
};

export function outcomeFromError(error?: string | null): TailorOutcomeKind {
  const err = (error || "").toLowerCase();
  if (!err) return "error";
  if (err.includes("no-go") || err.includes("eligibility") || err.includes("not worth tailoring")) return "skip";
  if (err.includes("tectonic") || err.includes("tex-failed") || err.includes("compile")) return "compile";
  if (err.includes("ai-failed") || err.includes("ollama") || err.includes("model step")) return "ai";
  if (err.includes("no full jd") || err.includes("job description") || err.includes("jd captured")) return "no-jd";
  if (err.includes("unsupported jd") || err.includes("not an engineering") || err.includes("non-engineering")) return "unsupported";
  if (err.includes("save your resume") || (err.includes("resume") && err.includes("settings"))) return "no-resume";
  if (
    err.includes("relay unreachable")
    || err.includes("not running")
    || err.includes("unreachable")
    || err.includes("drive not mounted")
    || err.includes("failed to fetch")
    || err.includes("unauthorized")
  ) return "offline";
  if (
    err.includes("connection dropped")
    || err.includes("timeout")
    || err.includes("aborted")
    || err.includes("idle-timed out")
  ) return "timeout";
  if (err.includes("fetch failed") || err.includes("disconnected")) return "ai";
  if (err.includes("no longer in feed") || err.includes("dismissed")) return "missing";
  return "error";
}

export function outcomeFromServerStatus(status?: string | null, error?: string | null): TailorOutcomeKind {
  switch (status) {
    case "ok":
      return "done";
    case "no-go":
      return "skip";
    case "tex-failed":
      return "compile";
    case "ai-failed":
      return "ai";
    case "no-jd":
      return "no-jd";
    case "unsupported-jd":
      return "unsupported";
    default:
      return outcomeFromError(error);
  }
}

export function resolveTailorOutcome(record: TailorRecord | null | undefined): TailorOutcomeKind {
  if (!record || record.status === "none") return "error";
  if (record.outcome) return record.outcome;
  if (record.status === "done" && record.borderline) return "borderline";
  if (record.status === "done") return "done";
  if (record.status === "running") return "running";
  if (record.status === "queued") return "queued";
  if (record.status === "no-go") return "skip";
  if (record.status === "failed") return outcomeFromError(record.error);
  return "error";
}

export function tailorCellDisplay(record: TailorRecord | null | undefined): TailorCellDisplay {
  if (!record || record.status === "none") {
    return { label: "—", tone: "none", tooltip: "Not tailored" };
  }

  const outcome = resolveTailorOutcome(record);
  const base = OUTCOME_DISPLAY[outcome];
  let label = base.label;

  if (outcome === "running") {
    label = `${record.progressPct ?? 5}%`;
  }

  const tooltip = base.tooltip
    || record.error
    || (record.ats ? `ATS ${record.ats}` : undefined)
    || label;

  return { label, tone: base.tone, tooltip };
}

export function tailorSortRank(record: TailorRecord | null | undefined): number {
  const outcome = resolveTailorOutcome(record);
  switch (outcome) {
    case "done":
      return 1000 + (record?.progressPct ?? 100);
    case "running":
      return 500 + (record?.progressPct ?? 5);
    case "queued":
      return 100;
    case "skip":
      return 40;
    case "compile":
    case "ai":
      return 35;
    case "timeout":
    case "offline":
      return 30;
    case "no-jd":
    case "no-resume":
    case "missing":
    case "unsupported":
    case "borderline":
      return 28;
    case "error":
    default:
      return 25;
  }
}

export function mapResultToRecordStatus(
  ok: boolean,
  serverStatus?: string | null,
  error?: string | null,
  borderline?: boolean,
): { status: TailorRecord["status"]; outcome: TailorOutcomeKind } {
  if (ok) return { status: "done", outcome: borderline ? "borderline" : "done" };
  const outcome = outcomeFromServerStatus(serverStatus, error);
  if (outcome === "skip") return { status: "no-go", outcome: "skip" };
  if (outcome === "unsupported") return { status: "failed", outcome: "unsupported" };
  return { status: "failed", outcome };
}
