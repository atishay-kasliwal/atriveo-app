import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import type { TailorRecord, TailorRecordStatus } from "../types/tailorQueue";
import { jobDismissKey } from "../utils/jobCopy";

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

export function useTailorStatus() {
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [records, setRecords] = useState<Record<string, TailorRecord>>({});

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
      };
      const next = { ...prev, [jobKey]: nextRecord };
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const getRecord = useCallback((jobKey: string) => records[jobKey] ?? null, [records]);

  const getRecordForJob = useCallback((job: { job_url?: string | null; company?: string | null; title?: string | null; location?: string | null; batch_time?: string | null }) => {
    const key = jobDismissKey(job as Parameters<typeof jobDismissKey>[0]);
    return records[key] ?? null;
  }, [records]);

  const doneCount = useMemo(
    () => Object.values(records).filter((r) => r.status === "done").length,
    [records],
  );

  return {
    records,
    doneCount,
    upsertRecord,
    markStatus,
    getRecord,
    getRecordForJob,
  };
}
