import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../types";
import type { TailorProcessLogEntry, TailorQueueItem, TailorQueueItemStatus } from "../types/tailorQueue";
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

function mergeQueues(base: TailorQueueItem[], incoming: TailorQueueItem[]): TailorQueueItem[] {
  const byKey = new Map(base.map((item) => [item.jobKey, item]));
  for (const item of incoming) {
    if (!byKey.has(item.jobKey)) byKey.set(item.jobKey, item);
  }
  return sortQueue([...byKey.values()]);
}

interface HourlyMark {
  key: string;
  patch: {
    jobUrl: string;
    company: string;
    title: string;
    score: number;
  };
}

function buildHourlyAdditions(
  prev: TailorQueueItem[],
  ranked: Array<{ job: Job; score: number; key: string }>,
  batch: string,
): { next: TailorQueueItem[]; marks: HourlyMark[] } {
  const activeKeys = new Set(
    prev.filter((item) => isActiveStatus(item.status)).map((item) => item.jobKey),
  );
  const next = [...prev];
  const marks: HourlyMark[] = [];
  for (const { job, score, key } of ranked) {
    if (marks.length >= HOURLY_QUEUE_SIZE) break;
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
    marks.push({
      key,
      patch: {
        jobUrl: job.job_url || "",
        company: job.company || "Unknown",
        title: job.title || "Untitled role",
        score,
      },
    });
    activeKeys.add(key);
  }
  return { next, marks };
}

type TailorStatusApi = Pick<
  ReturnType<typeof useTailorStatus>,
  "getRecord" | "markStatus"
>;

interface Options {
  tailorStatus: TailorStatusApi;
  onProcessJob?: (job: Job) => Promise<{
    ok: boolean;
    ats?: string;
    pdfPath?: string;
    dir?: string;
    folder?: string;
    error?: string;
  }>;
}

export function useTailorQueue(jobs: Job[], options: Options) {
  const { tailorStatus, onProcessJob } = options;
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [queue, setQueue] = useState<TailorQueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [lastHourlySyncAt, setLastHourlySyncAt] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const [processLogs, setProcessLogs] = useState<TailorProcessLogEntry[]>([]);
  const processingRef = useRef(false);
  const logSeqRef = useRef(0);
  const queueRef = useRef<TailorQueueItem[]>([]);
  const processQueueRef = useRef<(() => Promise<void>) | null>(null);

  const pushLog = useCallback((message: string, durationMs?: number) => {
    const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    logSeqRef.current += 1;
    const entry: TailorProcessLogEntry = {
      id: `${Date.now()}-${logSeqRef.current}`,
      at,
      message,
      durationMs,
    };
    setProcessLogs((prev) => [entry, ...prev].slice(0, 40));
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const kickProcess = useCallback(() => {
    window.setTimeout(() => {
      void processQueueRef.current?.();
    }, 0);
  }, []);

  useEffect(() => {
    if (loading) return;
    let loaded = loadQueue(uid);
    if (uid !== "anon") {
      try {
        const anonRaw = localStorage.getItem(QUEUE_KEY("anon"));
        if (anonRaw) {
          loaded = mergeQueues(loaded, JSON.parse(anonRaw) as TailorQueueItem[]);
          persistQueue(uid, loaded);
          localStorage.removeItem(QUEUE_KEY("anon"));
        }
      } catch {
        /* ignore */
      }
    }
    queueRef.current = loaded;
    setQueue(loaded);
    setLastHourlySyncAt(loadLastSync(uid));
    if (loaded.some((item) => item.status === "pending")) {
      kickProcess();
    }
  }, [loading, uid, kickProcess]);

  const commitQueue = useCallback((next: TailorQueueItem[]) => {
    const sorted = sortQueue(next);
    queueRef.current = sorted;
    setQueue(sorted);
    persistQueue(uid, sorted);
    return sorted;
  }, [uid]);

  const updateQueue = useCallback((updater: (prev: TailorQueueItem[]) => TailorQueueItem[]) => {
    return commitQueue(updater(queueRef.current));
  }, [commitQueue]);

  const enqueueJob = useCallback((job: Job, source: TailorQueueItem["source"], urgent = false) => {
    const jobKey = jobDismissKey(job);
    const score = careerOpsRating(job).score;
    const existing = tailorStatus.getRecord(jobKey);
    if (existing?.status === "done") {
      setSyncMessage(`${job.company || "Job"} already tailored`);
      return false;
    }

    let changed = false;
    let markPatch: {
      jobUrl: string;
      company: string;
      title: string;
      score: number;
    } | null = null;

    updateQueue((prev) => {
      const idx = prev.findIndex((item) => item.jobKey === jobKey && isActiveStatus(item.status));
      if (idx >= 0) {
        if (!urgent) return prev;
        changed = true;
        const bumped = [...prev];
        bumped[idx] = {
          ...bumped[idx],
          priority: Math.max(bumped[idx].priority, 1000) + 1,
          source: "manual",
        };
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
      markPatch = {
        jobUrl: item.jobUrl,
        company: item.company,
        title: item.title,
        score,
      };
      changed = true;
      return [item, ...prev];
    });

    if (!changed) return false;

    if (markPatch) {
      tailorStatus.markStatus(jobKey, "queued", markPatch);
    } else {
      tailorStatus.markStatus(jobKey, "queued");
    }
    setSyncMessage(urgent ? `Queued urgent: ${job.title || "role"}` : `Queued: ${job.title || "role"}`);
    kickProcess();
    return true;
  }, [tailorStatus, updateQueue, kickProcess]);

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

    const { next, marks } = buildHourlyAdditions(queueRef.current, ranked, batch);
    if (marks.length > 0) {
      commitQueue(next);
      for (const mark of marks) {
        tailorStatus.markStatus(mark.key, "queued", mark.patch);
      }
    }

    const added = marks.length;
    const ts = Date.now();
    setLastHourlySyncAt(ts);
    persistLastSync(uid, ts);
    if (added > 0) {
      setSyncMessage(`Hourly sync added ${added} job${added === 1 ? "" : "s"} to the tailor queue`);
      kickProcess();
    } else if (force) {
      setSyncMessage("Hourly sync: no new jobs to add");
    }
    return added;
  }, [lastHourlySyncAt, tailorStatus, uid, commitQueue, kickProcess]);

  const bumpUrgent = useCallback((jobKey: string) => {
    updateQueue((prev) => prev.map((item) => (
      item.jobKey === jobKey && item.status === "pending"
        ? { ...item, priority: 2000 + item.score, source: "manual" as const }
        : item
    )));
    tailorStatus.markStatus(jobKey, "queued");
    setSyncMessage("Moved to front of queue");
  }, [tailorStatus, updateQueue]);

  const reorderPending = useCallback((orderedKeys: string[]) => {
    updateQueue((prev) => {
      const pending = prev.filter((item) => item.status === "pending");
      const rest = prev.filter((item) => item.status !== "pending");
      const byKey = new Map(pending.map((item) => [item.jobKey, item]));
      const reordered = orderedKeys
        .map((key, index) => {
          const item = byKey.get(key);
          if (!item) return null;
          return { ...item, priority: 3000 - index };
        })
        .filter((item): item is TailorQueueItem => Boolean(item));
      const leftover = pending.filter((item) => !orderedKeys.includes(item.jobKey));
      return [...reordered, ...leftover, ...rest];
    });
    setSyncMessage("Queue order updated");
  }, [updateQueue]);

  const removeFromQueue = useCallback((jobKey: string) => {
    updateQueue((prev) => prev.filter((item) => item.jobKey !== jobKey || item.status === "done"));
    const record = tailorStatus.getRecord(jobKey);
    if (record?.status === "queued") {
      tailorStatus.markStatus(jobKey, "none");
    }
  }, [tailorStatus, updateQueue]);

  const processQueue = useCallback(async () => {
    if (!onProcessJob || processingRef.current) return;
    const nextItem = queueRef.current.find((item) => item.status === "pending");
    if (!nextItem) return;

    processingRef.current = true;
    setProcessing(true);

    const startedAt = new Date().toISOString();
    updateQueue((prev) => prev.map((item) => (
      item.jobKey === nextItem.jobKey
        ? { ...item, status: "running" as const, startedAt }
        : item
    )));
    tailorStatus.markStatus(nextItem.jobKey, "running", {
      jobUrl: nextItem.jobUrl,
      company: nextItem.company,
      title: nextItem.title,
      score: nextItem.score,
      progressPct: 5,
    });
    pushLog(`Started ${nextItem.company} · ${nextItem.title}`);

    const job = jobs.find((j) => jobDismissKey(j) === nextItem.jobKey);
    if (!job) {
      const durationMs = Date.now() - Date.parse(startedAt);
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? {
              ...item,
              status: "skipped" as const,
              error: "Job no longer in feed",
              durationMs,
            }
          : item
      )));
      tailorStatus.markStatus(nextItem.jobKey, "failed", { error: "Job no longer in feed" });
      pushLog(`Skipped ${nextItem.company} · job no longer in feed`, durationMs);
      processingRef.current = false;
      setProcessing(false);
      kickProcess();
      return;
    }

    try {
      const result = await onProcessJob(job);
      const durationMs = Date.now() - Date.parse(startedAt);
      const done = result.ok;
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? {
              ...item,
              status: done ? "done" as const : "failed" as const,
              error: result.error,
              durationMs,
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
          dir: result.dir,
          folder: result.folder,
          progressPct: done ? 100 : undefined,
          tailoredAt: done ? new Date().toISOString() : undefined,
          error: result.error,
        },
      );
      pushLog(
        done
          ? `Finished ${nextItem.company} · ${nextItem.title}${result.ats ? ` · ATS ${result.ats}` : ""}`
          : `Failed ${nextItem.company} · ${result.error || "unknown error"}`,
        durationMs,
      );
    } catch (e) {
      const durationMs = Date.now() - Date.parse(startedAt);
      const error = (e as Error).message || String(e);
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? { ...item, status: "failed" as const, error, durationMs }
          : item
      )));
      tailorStatus.markStatus(nextItem.jobKey, "failed", { error });
      pushLog(`Failed ${nextItem.company} · ${error}`, durationMs);
    } finally {
      processingRef.current = false;
      setProcessing(false);
      kickProcess();
    }
  }, [jobs, onProcessJob, tailorStatus, updateQueue, pushLog, kickProcess]);

  processQueueRef.current = processQueue;

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
  const failedInQueue = useMemo(
    () => queue.filter((item) => item.status === "failed" || item.status === "skipped").length,
    [queue],
  );
  const totalInQueue = useMemo(
    () => queue.filter((item) => item.status !== "skipped").length,
    [queue],
  );
  const queueTiming = useMemo(() => {
    const finished = queue.filter(
      (item) => (item.status === "done" || item.status === "failed" || item.status === "skipped")
        && typeof item.durationMs === "number",
    );
    const durations = finished.map((item) => item.durationMs as number);
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
      : null;
    const totalDurationMs = durations.reduce((sum, ms) => sum + ms, 0);
    const etaMs = avgDurationMs != null
      ? avgDurationMs * (pendingCount + (runningItem ? 1 : 0))
      : null;
    return { avgDurationMs, totalDurationMs, etaMs, finishedCount: durations.length };
  }, [queue, pendingCount, runningItem]);

  const overallProgressPct = useMemo(() => {
    const total = Math.max(1, pendingCount + (runningItem ? 1 : 0) + doneInQueue + failedInQueue);
    const doneWeight = doneInQueue + failedInQueue;
    const runningWeight = runningItem
      ? (tailorStatus.getRecord(runningItem.jobKey)?.progressPct ?? 28) / 100
      : 0;
    return Math.min(100, Math.round(((doneWeight + runningWeight) / total) * 100));
  }, [pendingCount, runningItem, doneInQueue, failedInQueue, tailorStatus]);

  const clearDone = useCallback(() => {
    updateQueue((prev) => prev.filter((item) => item.status !== "done" && item.status !== "failed" && item.status !== "skipped"));
    setSyncMessage("Cleared finished queue items");
  }, [updateQueue]);

  return {
    queue,
    pendingCount,
    runningItem,
    doneInQueue,
    failedInQueue,
    totalInQueue,
    overallProgressPct,
    processLogs,
    queueTiming,
    processing,
    lastHourlySyncAt,
    syncMessage,
    enqueueJob,
    bumpUrgent,
    removeFromQueue,
    runHourlySync,
    processQueue,
    clearDone,
    reorderPending,
  };
}
