import type { TailorPhase } from "../types/tailor";
import type { TailorRecord } from "../types/tailorQueue";
import { tailorCellDisplay } from "./tailorOutcome";

export function tailorPhaseProgress(phase: TailorPhase): number {
  switch (phase) {
    case "done": return 100;
    case "reviewing": return 94; // legacy — Gemma disabled
    case "compiling": return 94;
    case "assembling": return 55;
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

export function tailorCellLabel(record: TailorRecord | null | undefined): { label: string; tone: string; tooltip: string } {
  return tailorCellDisplay(record);
}

export function formatTailorDuration(ms: number, live = false): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) {
    return live ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.max(1, Math.round(ms))}ms`;
  }
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  const hr = Math.floor(min / 60);
  const remMin = min % 60;

  if (live) {
    if (hr > 0) return `${hr}h ${remMin}m ${sec}s`;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
  }

  if (totalSec < 60) return `${totalSec}s`;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

export function queueProgressPct(done: number, total: number, processing: boolean): number {
  if (!total) return 0;
  const base = (done / total) * 100;
  const bump = processing ? Math.min(8, 100 / total / 2) : 0;
  return Math.min(100, Math.round(base + bump));
}
