import type { TailorStreamEvent } from "../types/tailor";
import type { TailorRecord, TailorQueueItem } from "../types/tailorQueue";
import { captureTailorStreamEvent } from "./tailorLogCapture";
import { tailorPhaseProgress } from "./tailorProgress";

export function reconcileTailorRecordsWithQueue(
  records: Record<string, TailorRecord>,
  queue: TailorQueueItem[],
): Record<string, TailorRecord> {
  const queueByKey = new Map(queue.map((item) => [item.jobKey, item]));
  let changed = false;
  const next: Record<string, TailorRecord> = { ...records };

  for (const [key, record] of Object.entries(records)) {
    if (record.status !== "running") continue;
    const item = queueByKey.get(key);
    if (item?.status === "running") continue;
    next[key] = {
      ...record,
      status: item?.status === "done" ? "done" : item?.status === "failed" ? "failed" : "queued",
      progressPct: item?.status === "done"
        ? 100
        : item?.status === "failed"
          ? record.progressPct
          : 5,
    };
    changed = true;
  }

  return changed ? next : records;
}

export function mergeStreamIntoTailorRecord(
  existing: TailorRecord | undefined,
  jobKey: string,
  event: TailorStreamEvent,
  base: Partial<TailorRecord>,
): TailorRecord | null {
  let logs = existing?.logs ?? [];
  const captured = captureTailorStreamEvent(logs, event, 0);
  const logsChanged = captured.length !== logs.length;
  logs = captured;

  let progressPct = existing?.progressPct;
  if (event.type === "job" && event.index === 0 && event.phase && event.phase !== "done") {
    progressPct = tailorPhaseProgress(event.phase);
  }

  if (!logsChanged && progressPct === existing?.progressPct && existing?.status === "running") {
    return null;
  }

  return {
    jobKey,
    jobUrl: base.jobUrl ?? existing?.jobUrl ?? "",
    company: base.company ?? existing?.company ?? "Unknown",
    title: base.title ?? existing?.title ?? "Role",
    status: "running",
    score: base.score ?? existing?.score,
    ats: existing?.ats,
    tailoredAt: existing?.tailoredAt,
    pdfPath: existing?.pdfPath,
    dir: existing?.dir,
    folder: existing?.folder,
    progressPct,
    error: existing?.error,
    logs,
    durationMs: existing?.durationMs,
  };
}
