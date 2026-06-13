import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../types";
import type { TailorQueueItem, TailorQueueItemStatus } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE, HOURLY_SYNC_MS } from "../types/tailorQueue";
import { careerOpsRating } from "../utils/jobPresentation";
import { jobDismissKey } from "../utils/jobCopy";
import { useAuth } from "./useAuth";
import type { useTailorStatus } from "./useTailorStatus";

const QUEUE_KEY = (uid: string) => `atriveo_tailor_queue_v1_${uid}`;
const SYNC_KEY = (uid: string) => `atriveo_tailor_last_hourly_sync_v1_${uid}`;

function hourBatchKey(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 13);
}

function loadQueue(uid: string): TailorQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY(uid)) ?? localStorage.getItem(QUEUE_KEY("anon"));
    return raw ? (JSON.parse(raw) as TailorQueueItem[]) : [];
  } catch {
    return [];
  }
}

function persistQueue(uid: string, items: TailorQueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY(uid), JSON.stringify(items.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

function loadLastSync(uid: string): number {
  try {
    const raw = localStorage.getItem(SYNC_KEY(uid));
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function persistLastSync(uid: string, ts: number) {
  try {
    localStorage.setItem(SYNC_KEY(uid), String(ts));
  } catch {
    /* ignore */
  }
}

function sortQueue(items: TailorQueueItem[]): TailorQueueItem[] {
  return [...items].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    const aPending = a.status === "pending";
    const bPending = b.status === "pending";
    if (aPending && bPending) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.enqueuedAt).getTime() - new Date(b.enqueuedAt).getTime();
    }
    if (aPending && !bPending) return -1;
    if (bPending && !aPending) return 1;
    return new Date(b.enqueuedAt).getTime() - new Date(a.enqueuedAt).getTime();
  });
}

function isActiveStatus(status: TailorQueueItemStatus): boolean {
  return status === "pending" || status === "running";
}

type TailorStatusApi = Pick<
  ReturnType<typeof useTailorStatus>,
  "getRecord" | "markStatus"
>;

interface Options {
  tailorStatus: TailorStatusApi;
  onProcessJob?: (job: Job) => Promise<{ ok: boolean; ats?: string; pdfPath?: string; error?: string }>;
}

export function useTailorQueue(jobs: Job[], options: Options) {
  const { tailorStatus, onProcessJob } = options;
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [queue, setQueue] = useState<TailorQueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [lastHourlySyncAt, setLastHourlySyncAt] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const processingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    setQueue(loadQueue(uid));
    setLastHourlySyncAt(loadLastSync(uid));
  }, [loading, uid]);

  const updateQueue = useCallback((updater: (prev: TailorQueueItem[]) => TailorQueueItem[]) => {
    setQueue((prev) => {
      const next = sortQueue(updater(prev));
      persistQueue(uid, next);
      return next;
    });
  }, [uid]);

  const enqueueJob = useCallback((job: Job, source: TailorQueueItem["source"], urgent = false) => {
    const jobKey = jobDismissKey(job);
    const score = careerOpsRating(job).score;
    const existing = tailorStatus.getRecord(jobKey);
    if (existing?.status === "done") {
      setSyncMessage(`${job.company || "Job"} already tailored`);
      return false;
    }

    let added = false;
    updateQueue((prev) => {
      const idx = prev.findIndex((item) => item.jobKey === jobKey && isActiveStatus(item.status));
      if (idx >= 0) {
        if (!urgent) return prev;
        const bumped = [...prev];
        bumped[idx] = {
          ...bumped[idx],
          priority: Math.max(bumped[idx].priority, 1000) + 1,
          source: "manual",
        };
        added = true;
        return bumped;
      }
      const item: TailorQueueItem = {
        jobKey,
        jobUrl: job.job_url || "",
        title: job.title || "Untitled role",
        company: job.company || "Unknown",
        score,
        priority: urgent ? 1000 + score : score,
        enqueuedAt: new Date().toISOString(),
        hourBatch: hourBatchKey(),
        source,
        status: "pending",
      };
      tailorStatus.markStatus(jobKey, "queued", {
        jobUrl: item.jobUrl,
        company: item.company,
        title: item.title,
        score,
      });
      added = true;
      return [item, ...prev];
    });
    if (added) {
      setSyncMessage(urgent ? `Queued urgent: ${job.title || "role"}` : `Queued: ${job.title || "role"}`);
    }
    return added;
  }, [tailorStatus, updateQueue]);

  const runHourlySync = useCallback((availableJobs: Job[], force = false) => {
    const now = Date.now();
    if (!force && lastHourlySyncAt && now - lastHourlySyncAt < HOURLY_SYNC_MS) {
      return 0;
    }

    const batch = hourBatchKey();
    const ranked = [...availableJobs]
      .map((job) => ({ job, score: careerOpsRating(job).score, key: jobDismissKey(job) }))
      .filter(({ key, job }) => {
        if (!job.job_url) return false;
        const status = tailorStatus.getRecord(key)?.status;
        if (status === "done" || status === "running") return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);

    let added = 0;
    updateQueue((prev) => {
      const activeKeys = new Set(
        prev.filter((item) => isActiveStatus(item.status)).map((item) => item.jobKey),
      );
      const next = [...prev];
      for (const { job, score, key } of ranked) {
        if (added >= HOURLY_QUEUE_SIZE) break;
        if (activeKeys.has(key)) continue;
        next.push({
          jobKey: key,
          jobUrl: job.job_url || "",
          title: job.title || "Untitled role",
          company: job.company || "Unknown",
          score,
          priority: score,
          enqueuedAt: new Date().toISOString(),
          hourBatch: batch,
          source: "hourly",
          status: "pending",
        });
        tailorStatus.markStatus(key, "queued", {
          jobUrl: job.job_url || "",
          company: job.company || "Unknown",
          title: job.title || "Untitled role",
          score,
        });
        activeKeys.add(key);
        added += 1;
      }
      return next;
    });

    const ts = Date.now();
    setLastHourlySyncAt(ts);
    persistLastSync(uid, ts);
    if (added > 0) {
      setSyncMessage(`Hourly sync added ${added} job${added === 1 ? "" : "s"} to the tailor queue`);
    } else if (force) {
      setSyncMessage("Hourly sync: no new jobs to add");
    }
    return added;
  }, [lastHourlySyncAt, tailorStatus, uid, updateQueue]);

  const bumpUrgent = useCallback((jobKey: string) => {
    updateQueue((prev) => prev.map((item) => (
      item.jobKey === jobKey && item.status === "pending"
        ? { ...item, priority: 2000 + item.score, source: "manual" as const }
        : item
    )));
    tailorStatus.markStatus(jobKey, "queued");
    setSyncMessage("Moved to front of queue");
  }, [tailorStatus, updateQueue]);

  const removeFromQueue = useCallback((jobKey: string) => {
    updateQueue((prev) => prev.filter((item) => item.jobKey !== jobKey || item.status === "done"));
    const record = tailorStatus.getRecord(jobKey);
    if (record?.status === "queued") {
      tailorStatus.markStatus(jobKey, "none");
    }
  }, [tailorStatus, updateQueue]);

  const processQueue = useCallback(async () => {
    if (!onProcessJob || processingRef.current) return;
    const nextItem = queue.find((item) => item.status === "pending");
    if (!nextItem) return;

    processingRef.current = true;
    setProcessing(true);

    updateQueue((prev) => prev.map((item) => (
      item.jobKey === nextItem.jobKey ? { ...item, status: "running" as const } : item
    )));
    tailorStatus.markStatus(nextItem.jobKey, "running", {
      jobUrl: nextItem.jobUrl,
      company: nextItem.company,
      title: nextItem.title,
      score: nextItem.score,
    });

    const job = jobs.find((j) => jobDismissKey(j) === nextItem.jobKey);
    if (!job) {
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? { ...item, status: "skipped" as const, error: "Job no longer in feed" }
          : item
      )));
      tailorStatus.markStatus(nextItem.jobKey, "failed", { error: "Job no longer in feed" });
      processingRef.current = false;
      setProcessing(false);
      return;
    }

    try {
      const result = await onProcessJob(job);
      const done = result.ok;
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? {
              ...item,
              status: done ? "done" as const : "failed" as const,
              error: result.error,
            }
          : item
      )));
      tailorStatus.markStatus(
        nextItem.jobKey,
        done ? "done" : (result.error?.includes("no-go") ? "no-go" : "failed"),
        {
          jobUrl: nextItem.jobUrl,
          company: nextItem.company,
          title: nextItem.title,
          score: nextItem.score,
          ats: result.ats,
          pdfPath: result.pdfPath,
          tailoredAt: done ? new Date().toISOString() : undefined,
          error: result.error,
        },
      );
    } catch (e) {
      const error = (e as Error).message || String(e);
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey ? { ...item, status: "failed" as const, error } : item
      )));
      tailorStatus.markStatus(nextItem.jobKey, "failed", { error });
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [jobs, onProcessJob, queue, tailorStatus, updateQueue]);

  useEffect(() => {
    if (processing || !onProcessJob) return;
    const hasPending = queue.some((item) => item.status === "pending");
    if (!hasPending) return;
    void processQueue();
  }, [queue, processing, onProcessJob, processQueue]);

  useEffect(() => {
    if (loading || !jobs.length) return;
    runHourlySync(jobs);
    const id = window.setInterval(() => runHourlySync(jobs), HOURLY_SYNC_MS);
    return () => window.clearInterval(id);
  }, [jobs, loading, runHourlySync]);

  const pendingCount = useMemo(
    () => queue.filter((item) => item.status === "pending").length,
    [queue],
  );
  const runningItem = useMemo(
    () => queue.find((item) => item.status === "running") ?? null,
    [queue],
  );
  const doneInQueue = useMemo(
    () => queue.filter((item) => item.status === "done").length,
    [queue],
  );

  const clearDone = useCallback(() => {
    updateQueue((prev) => prev.filter((item) => item.status !== "done" && item.status !== "failed" && item.status !== "skipped"));
    setSyncMessage("Cleared finished queue items");
  }, [updateQueue]);

  return {
    queue,
    pendingCount,
    runningItem,
    doneInQueue,
    processing,
    lastHourlySyncAt,
    syncMessage,
    enqueueJob,
    bumpUrgent,
    removeFromQueue,
    runHourlySync,
    processQueue,
    clearDone,
  };
}
