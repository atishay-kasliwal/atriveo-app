import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import type { TailorRecord, TailorRecordStatus, TailorQueueItem } from "../types/tailorQueue";
import type { TailorStreamEvent } from "../types/tailor";
import { jobDismissKey } from "../utils/jobCopy";
import { mergeStreamIntoTailorRecord, reconcileTailorRecordsWithQueue } from "../utils/tailorSync";
import { estDateKey, useEstDayKey, estHourKey } from "../utils/estDate";

const KEY = (uid: string) => `atriveo_tailor_status_v1_${uid}`;

function load(uid: string): Record<string, TailorRecord> {
  try {
    const raw = localStorage.getItem(KEY(uid)) ?? localStorage.getItem(KEY("anon"));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TailorRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(uid: string, records: Record<string, TailorRecord>) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(records));
  } catch {
    /* ignore */
  }
}

function tailorRecordChanged(before: TailorRecord | undefined, after: TailorRecord): boolean {
  if (!before) return true;
  const keys: (keyof TailorRecord)[] = [
    "status", "progressPct", "error", "pdfPath", "dir", "folder", "resumeSlot", "sessionHour", "ats",
    "outcome", "serverStatus", "borderline", "tailoredAt", "jobUrl", "company", "title", "score",
  ];
  for (const key of keys) {
    if (before[key] !== after[key]) return true;
  }
  if ((before.logs?.length ?? 0) !== (after.logs?.length ?? 0)) return true;
  return false;
}

export function useTailorStatus() {
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [records, setRecords] = useState<Record<string, TailorRecord>>({});
  const estDayKey = useEstDayKey();

  useEffect(() => {
    if (loading) return;
    let loaded = load(uid);
    if (uid !== "anon") {
      try {
        const anonRaw = localStorage.getItem(KEY("anon"));
        if (anonRaw) {
          const anon = JSON.parse(anonRaw) as Record<string, TailorRecord>;
          loaded = { ...anon, ...loaded };
          persist(uid, loaded);
          localStorage.removeItem(KEY("anon"));
        }
      } catch {
        /* ignore */
      }
    }
    setRecords(loaded);
  }, [loading, uid]);

  // Keep tailor records in sync when another tab updates localStorage.
  useEffect(() => {
    const storageKey = KEY(uid);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as Record<string, TailorRecord>;
        if (parsed && typeof parsed === "object") setRecords(parsed);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [uid]);

  const upsertRecord = useCallback((record: TailorRecord) => {
    setRecords((prev) => {
      const next = { ...prev, [record.jobKey]: record };
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const markStatus = useCallback((
    jobKey: string,
    status: TailorRecordStatus,
    patch: Partial<TailorRecord> = {},
  ) => {
    setRecords((prev) => {
      const existing = prev[jobKey];
      const nextRecord: TailorRecord = {
        jobKey,
        jobUrl: patch.jobUrl || existing?.jobUrl || "",
        company: patch.company || existing?.company || "Unknown",
        title: patch.title || existing?.title || "Role",
        status,
        score: patch.score ?? existing?.score,
        ats: patch.ats ?? existing?.ats,
        tailoredAt: patch.tailoredAt ?? existing?.tailoredAt,
        pdfPath: patch.pdfPath ?? existing?.pdfPath,
        dir: patch.dir ?? existing?.dir,
        folder: patch.folder ?? existing?.folder,
        progressPct: patch.progressPct ?? existing?.progressPct,
        error: patch.error ?? existing?.error,
        logs: patch.logs ?? existing?.logs,
        durationMs: patch.durationMs ?? existing?.durationMs,
        outcome: patch.outcome ?? existing?.outcome,
        serverStatus: patch.serverStatus ?? existing?.serverStatus,
        explain: patch.explain ?? existing?.explain,
        borderline: patch.borderline ?? existing?.borderline,
        compileStage: patch.compileStage ?? existing?.compileStage,
        workerId: patch.workerId ?? existing?.workerId,
        resumeSlot: patch.resumeSlot ?? existing?.resumeSlot,
        sessionHour: patch.sessionHour ?? existing?.sessionHour,
      };
      if (!tailorRecordChanged(existing, nextRecord)) return prev;
      const next = { ...prev, [jobKey]: nextRecord };
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const applyStreamEvent = useCallback((
    jobKey: string,
    event: TailorStreamEvent,
    base: Partial<TailorRecord> = {},
  ) => {
    setRecords((prev) => {
      const merged = mergeStreamIntoTailorRecord(prev[jobKey], jobKey, event, base);
      if (!merged) return prev;
      const next = { ...prev, [jobKey]: merged };
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const reconcileWithQueue = useCallback((queue: TailorQueueItem[]) => {
    setRecords((prev) => {
      const next = reconcileTailorRecordsWithQueue(prev, queue);
      if (next === prev) return prev;
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const getRecord = useCallback((jobKey: string) => records[jobKey] ?? null, [records]);

  const getRecordForJob = useCallback((job: { job_url?: string | null; company?: string | null; title?: string | null; location?: string | null; batch_time?: string | null }) => {
    const key = jobDismissKey(job as Parameters<typeof jobDismissKey>[0]);
    return records[key] ?? null;
  }, [records]);

  const clearAllLogs = useCallback(() => {
    setRecords((prev) => {
      let changed = false;
      const next: Record<string, TailorRecord> = {};
      for (const [key, record] of Object.entries(prev)) {
        if (record.logs?.length) {
          next[key] = { ...record, logs: [] };
          changed = true;
        } else {
          next[key] = record;
        }
      }
      if (!changed) return prev;
      persist(uid, next);
      return next;
    });
  }, [uid]);

  /** Clear queued/running pipeline state (e.g. Reset tailor). Keeps done history. */
  const resetPipelineRecords = useCallback(() => {
    setRecords((prev) => {
      let changed = false;
      const next: Record<string, TailorRecord> = { ...prev };
      for (const [key, record] of Object.entries(prev)) {
        if (record.status === "queued" || record.status === "running") {
          next[key] = {
            ...record,
            status: "none",
            progressPct: undefined,
            error: undefined,
            logs: [],
          };
          changed = true;
        }
      }
      if (!changed) return prev;
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const doneCount = useMemo(
    () => Object.values(records).filter((r) => r.status === "done").length,
    [records],
  );

  const resumesCreatedTodayCount = useMemo(
    () => Object.values(records).filter((record) => (
      record.status === "done"
      && Boolean(record.pdfPath)
      && record.tailoredAt
      && estDateKey(new Date(record.tailoredAt)) === estDayKey
    )).length,
    [records, estDayKey],
  );

  const resumesCreatedThisHourCount = useMemo(() => {
    const hourKey = estHourKey(new Date());
    return Object.values(records).filter((record) => (
      record.status === "done"
      && Boolean(record.pdfPath)
      && record.tailoredAt
      && estHourKey(new Date(record.tailoredAt)) === hourKey
    )).length;
  }, [records]);

  return useMemo(() => ({
    records,
    doneCount,
    resumesCreatedTodayCount,
    resumesCreatedThisHourCount,
    upsertRecord,
    markStatus,
    applyStreamEvent,
    reconcileWithQueue,
    getRecord,
    getRecordForJob,
    clearAllLogs,
    resetPipelineRecords,
  }), [
    records,
    doneCount,
    resumesCreatedTodayCount,
    resumesCreatedThisHourCount,
    upsertRecord,
    markStatus,
    applyStreamEvent,
    reconcileWithQueue,
    getRecord,
    getRecordForJob,
    clearAllLogs,
    resetPipelineRecords,
  ]);
}
