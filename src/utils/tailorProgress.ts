import type { TailorPhase } from "../types/tailor";
import type { TailorRecord } from "../types/tailorQueue";

export function tailorPhaseProgress(phase: TailorPhase): number {
  switch (phase) {
    case "done": return 100;
    case "compiling": return 88;
    case "assembling": return 62;
    case "analyzing": return 28;
    case "queued": return 5;
    default: return 0;
  }
}

export function tailorFolderPath(record: TailorRecord | null | undefined): string | null {
  if (!record) return null;
  if (record.dir) return record.dir;
  if (record.pdfPath) return record.pdfPath.replace(/\/[^/]+$/, "");
  return null;
}

export function tailorCellLabel(record: TailorRecord | null | undefined): { label: string; tone: string } {
  if (!record || record.status === "none") return { label: "—", tone: "none" };
  switch (record.status) {
    case "done":
      return { label: "100%", tone: "done" };
    case "running":
      return { label: `${record.progressPct ?? 5}%`, tone: "running" };
    case "queued":
      return { label: "Queued", tone: "queued" };
    case "no-go":
      return { label: "Skip", tone: "skip" };
    case "failed":
      return { label: "Fail", tone: "failed" };
    default:
      return { label: "—", tone: "none" };
  }
}

export function queueProgressPct(done: number, total: number, processing: boolean): number {
  if (!total) return 0;
  const base = (done / total) * 100;
  const bump = processing ? Math.min(8, 100 / total / 2) : 0;
  return Math.min(100, Math.round(base + bump));
}
