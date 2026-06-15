import type { ApplyRecord } from "../hooks/useApplyTracker";
import type { JobResumeView, CompileStage, JobResumeStatus } from "../types/jobResumeView";
import type { TailorQueueItem, TailorRecord } from "../types/tailorQueue";
import { resolveTailorOutcome } from "./tailorOutcome";
import { summarizeExplain } from "./summarizeExplain";

function fmtRelative(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffM = Math.floor((Date.now() - t) / 60000);
  if (diffM < 1) return "just now";
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 48) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function stageFromProgress(pct?: number): { stage: CompileStage; label: string } {
  const p = pct ?? 12;
  if (p < 20) return { stage: "gate", label: "Gate" };
  if (p < 45) return { stage: "compose", label: "Compose" };
  if (p < 70) return { stage: "optimize", label: "Optimize" };
  if (p < 94) return { stage: "tex", label: "LaTeX" };
  return { stage: "pdf", label: "PDF" };
}

function stageIndex(stage: CompileStage): number {
  return { gate: 1, compose: 2, optimize: 3, tex: 4, pdf: 5 }[stage];
}

const MONGO_STAGE_LABEL: Record<string, { stage: CompileStage; label: string }> = {
  QUEUED: { stage: "gate", label: "Queued" },
  GATED: { stage: "gate", label: "JD gate" },
  COMPOSED: { stage: "compose", label: "Compose" },
  OPTIMIZED: { stage: "optimize", label: "Optimize" },
  TEX: { stage: "tex", label: "LaTeX" },
  PDF: { stage: "pdf", label: "PDF" },
  SUCCESS: { stage: "pdf", label: "PDF" },
};

function workerLabel(workerId?: string): string | undefined {
  if (!workerId) return undefined;
  const short = workerId.split("-")[0];
  return short.length > 20 ? `${short.slice(0, 18)}…` : short;
}

export function buildJobResumeView(
  tailorRecord: TailorRecord | null,
  queueItem: TailorQueueItem | null,
  applyRecord?: ApplyRecord | null,
): JobResumeView {
  const explain = tailorRecord?.explain;
  const { bullets, confidence } = summarizeExplain(explain);
  const identityPrimary = explain?.engineering_identity?.primary ?? undefined;
  const identityConfidence = explain?.engineering_identity?.confidence ?? undefined;
  const compiledAt = tailorRecord?.tailoredAt;
  const pdfPath = tailorRecord?.pdfPath;
  const folderPath = tailorRecord?.dir || tailorRecord?.folder;

  let status: JobResumeStatus = "never";
  let statusLine = "Never compiled";
  let subLine: string | undefined;
  let stage: CompileStage | undefined;
  let stageLabel: string | undefined;

  if (queueItem?.status === "pending") {
    status = "queued";
    statusLine = "Queued";
    subLine = "Waiting for compiler";
  } else if (
    queueItem?.status === "running"
    || tailorRecord?.status === "running"
    || tailorRecord?.status === "queued"
  ) {
    status = "compiling";
    const mongoStage = tailorRecord?.compileStage ? MONGO_STAGE_LABEL[tailorRecord.compileStage] : null;
    const prog = tailorRecord?.progressPct ?? 12;
    const st = mongoStage || stageFromProgress(prog);
    stage = st.stage;
    stageLabel = st.label;
    statusLine = "Compiling";
    const worker = workerLabel(tailorRecord?.workerId);
    subLine = worker
      ? `Phase ${stageIndex(st.stage)}/5 · ${st.label} · ${worker}`
      : `Phase ${stageIndex(st.stage)}/5 · ${st.label}`;
  } else if (tailorRecord && tailorRecord.status !== "none") {
    const outcome = resolveTailorOutcome(tailorRecord);
    switch (outcome) {
      case "done":
        status = "ready";
        statusLine = "PDF ready";
        subLine = identityPrimary
          ? `${identityPrimary}${compiledAt ? ` · ${fmtRelative(compiledAt)}` : ""}`
          : compiledAt ? fmtRelative(compiledAt) : undefined;
        break;
      case "borderline":
        status = "borderline";
        statusLine = "Borderline";
        subLine = identityPrimary ? `${identityPrimary} · needs review` : "Needs review";
        break;
      case "unsupported":
        status = "unsupported";
        statusLine = "N/A";
        subLine = "Not an engineering JD";
        break;
      case "skip":
        status = "skipped";
        statusLine = "Skipped";
        subLine = tailorRecord.error || "Eligibility blocked";
        break;
      case "no-jd":
        status = "no-jd";
        statusLine = "No JD";
        subLine = "Full description not available";
        break;
      default:
        status = "failed";
        statusLine = "Failed";
        subLine = tailorRecord.error?.slice(0, 80) || outcome;
        break;
    }
  }

  if (applyRecord?.lastAppliedAt && (status === "ready" || status === "borderline")) {
    subLine = `Applied ${fmtRelative(applyRecord.lastAppliedAt)}`;
  }

  return {
    status,
    stage,
    stageLabel,
    identityPrimary,
    identityConfidence,
    compiledAt,
    pdfPath,
    folderPath,
    explain,
    summaryBullets: bullets,
    confidenceLabel: confidence,
    statusLine,
    subLine,
  };
}
