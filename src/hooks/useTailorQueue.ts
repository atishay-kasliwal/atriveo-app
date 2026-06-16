import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../types";
import type { TailorProcessLogEntry, TailorQueueItem, TailorQueueItemStatus } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE, HOURLY_SYNC_MS } from "../types/tailorQueue";
import { careerOpsRating } from "../utils/jobPresentation";
import { jobDismissKey } from "../utils/jobCopy";
import { snapshotJobForQueue } from "../utils/manualJob";
import { mapResultToRecordStatus, outcomeFromError } from "../utils/tailorOutcome";
import type { SingleTailorResult } from "../utils/tailorRun";
import { isRecoverableTailorFailure, isTailorBusy, requestTailorRecovery } from "../utils/tailorRecover";
import {
  getTailorTabId,
  installProcessLockRelease,
  isAnotherTabProcessing,
  loadProcessLogs,
  persistProcessLogs,
  readProcessLock,
  recoverProcessLock,
  releaseProcessLockIfOwned,
  touchProcessLock,
  tryAcquireProcessLock,
  isProcessLockFresh,
} from "../utils/tailorPersistence";
import { resetTailorLogCapture } from "../utils/tailorLogCapture";
import { abortActiveTailorJob, checkJobOnDisk } from "../utils/tailorRun";
import { useAuth } from "./useAuth";
import type { useTailorStatus } from "./useTailorStatus";

const QUEUE_KEY = (uid: string) => `atriveo_tailor_queue_v1_${uid}`;
const SYNC_KEY = (uid: string) => `atriveo_tailor_last_hourly_sync_v1_${uid}`;
const LOGS_KEY = (uid: string) => `atriveo_tailor_process_logs_v1_${uid}`;
/** Abort a stuck running job if the browser↔Mac stream drops but fetch never settles. */
const RUNNING_STALE_MS = 3 * 60 * 1000;
const RECOVER_RETRY_MS = 8_000;
/** When the Mac reports busy, wait this long before re-checking (a real run takes minutes). */
const BUSY_BACKOFF_MS = 20_000;
/** Pause between queue jobs so logs/results stay readable. */
const INTER_JOB_PAUSE_MS = 2_500;
/** Poll Mac output folder while a job runs — sync PDF to the table before the stream closes. */
const DISK_POLL_MS = 20_000;

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
  dismissedKeys: ReadonlySet<string>,
): { next: TailorQueueItem[]; marks: HourlyMark[] } {
  const existingKeys = new Set(prev.map((item) => item.jobKey));
  const next = [...prev];
  const marks: HourlyMark[] = [];
  for (const { job, score, key } of ranked) {
    if (marks.length >= HOURLY_QUEUE_SIZE) break;
    if (dismissedKeys.has(key)) continue;
    if (existingKeys.has(key)) continue;
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
      jobSnapshot: snapshotJobForQueue(job),
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
    existingKeys.add(key);
  }
  return { next, marks };
}

function resetStaleRunning(items: TailorQueueItem[]): TailorQueueItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.status !== "running") return item;
    changed = true;
    return { ...item, status: "pending" as const, startedAt: undefined };
  });
  return changed ? next : items;
}

function purgeDismissedPending(items: TailorQueueItem[], dismissedKeys: ReadonlySet<string>): TailorQueueItem[] {
  return items.filter((item) => !(item.status === "pending" && dismissedKeys.has(item.jobKey)));
}

type TailorStatusApi = Pick<
  ReturnType<typeof useTailorStatus>,
  "getRecord" | "markStatus" | "reconcileWithQueue" | "clearAllLogs" | "resetPipelineRecords"
>;

interface Options {
  tailorStatus: TailorStatusApi;
  dismissedKeys?: ReadonlySet<string>;
  onProcessJob?: (job: Job) => Promise<SingleTailorResult>;
}

export function useTailorQueue(jobs: Job[], options: Options) {
  const { tailorStatus, dismissedKeys, onProcessJob } = options;
  const dismissedRef = useRef<ReadonlySet<string>>(dismissedKeys ?? new Set());
  dismissedRef.current = dismissedKeys ?? dismissedRef.current;
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [queue, setQueue] = useState<TailorQueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [lastHourlySyncAt, setLastHourlySyncAt] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const [processLogs, setProcessLogs] = useState<TailorProcessLogEntry[]>([]);
  const [logsPanelCleared, setLogsPanelCleared] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const processingRef = useRef(false);
  const logSeqRef = useRef(0);
  const tabIdRef = useRef(getTailorTabId());
  const heartbeatRef = useRef<number | null>(null);
  const recoverTimerRef = useRef<number | null>(null);
  const queueRef = useRef<TailorQueueItem[]>([]);
  const jobsRef = useRef(jobs);
  const lastSyncRef = useRef(0);
  // Guard so the "Recovered queue after refresh" line logs at most once per
  // mount — the load effect can re-run (callback deps change identity) and was
  // spamming the same line every second.
  const recoveredLoggedRef = useRef(false);
  const processQueueRef = useRef<(() => Promise<void>) | null>(null);
  const runHourlySyncRef = useRef<(availableJobs: Job[], force?: boolean) => number>(() => 0);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const pushLog = useCallback((
    message: string,
    durationMs?: number,
    outcome?: import("../types/tailorQueue").TailorOutcomeKind,
  ) => {
    const at = new Date().toISOString();
    logSeqRef.current += 1;
    const entry: TailorProcessLogEntry = {
      id: `${Date.now()}-${logSeqRef.current}`,
      at,
      message,
      durationMs,
      outcome,
    };
    setProcessLogs((prev) => {
      const next = [entry, ...prev].slice(0, 80);
      persistProcessLogs(uid, next);
      return next;
    });
  }, [uid]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const kickProcess = useCallback((delayMs = 0) => {
    window.setTimeout(() => {
      const hasPending = queueRef.current.some(
        (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
      );
      if (hasPending && isAnotherTabProcessing(uid, tabIdRef.current)) {
        const lock = readProcessLock(uid);
        if (lock && !isProcessLockFresh(lock)) {
          recoverProcessLock(uid, tabIdRef.current);
        }
      }
      void processQueueRef.current?.();
    }, delayMs);
  }, [uid]);

  const forceReleaseProcessing = useCallback(() => {
    abortActiveTailorJob();
    if (recoverTimerRef.current) {
      window.clearTimeout(recoverTimerRef.current);
      recoverTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    releaseProcessLockIfOwned(uid, tabIdRef.current);
    processingRef.current = false;
    setProcessing(false);
  }, [uid]);

  useEffect(() => {
    if (loading) return;
    recoverProcessLock(uid, tabIdRef.current);

    let loadedLogs = loadProcessLogs(uid);
    if (uid !== "anon") {
      try {
        const anonLogs = loadProcessLogs("anon");
        if (anonLogs.length) {
          loadedLogs = [...anonLogs, ...loadedLogs].slice(0, 80);
          persistProcessLogs(uid, loadedLogs);
          localStorage.removeItem(LOGS_KEY("anon"));
        }
      } catch {
        /* ignore */
      }
    }
    setProcessLogs(loadedLogs);

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
    const beforeLoad = loaded;
    loaded = resetStaleRunning(loaded);
    if (loaded !== beforeLoad) persistQueue(uid, loaded);
    tailorStatus.reconcileWithQueue(loaded);
    queueRef.current = loaded;
    setQueue(loaded);
    const syncedAt = loadLastSync(uid);
    lastSyncRef.current = syncedAt;
    setLastHourlySyncAt(syncedAt);
    const hasPending = loaded.some((item) => item.status === "pending");
    const hadRunning = beforeLoad.some((item) => item.status === "running");
    if (hasPending || hadRunning) {
      if (hadRunning && !recoveredLoggedRef.current) {
        recoveredLoggedRef.current = true;
        pushLog("Recovered queue after refresh — resuming…");
      }
      kickProcess();
    }
    setQueueLoaded(true);
  }, [loading, uid, kickProcess, tailorStatus, pushLog]);

  useEffect(() => {
    const release = installProcessLockRelease(uid, tabIdRef.current);
    return release;
  }, [uid]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.newValue) return;
      if (event.key === QUEUE_KEY(uid)) {
        try {
          const loaded = JSON.parse(event.newValue) as TailorQueueItem[];
          queueRef.current = loaded;
          setQueue(loaded);
          tailorStatus.reconcileWithQueue(loaded);
        } catch {
          /* ignore */
        }
      }
      if (event.key === LOGS_KEY(uid)) {
        try {
          setProcessLogs(JSON.parse(event.newValue) as TailorProcessLogEntry[]);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [uid, tailorStatus]);

  const commitQueue = useCallback((next: TailorQueueItem[]) => {
    const sorted = sortQueue(next);
    queueRef.current = sorted;
    setQueue(sorted);
    persistQueue(uid, sorted);
    return sorted;
  }, [uid]);

  // Drop pending queue items for dismissed/clicked jobs whenever that set changes.
  useEffect(() => {
    if (!dismissedKeys?.size) return;
    const purged = purgeDismissedPending(queueRef.current, dismissedKeys);
    if (purged.length !== queueRef.current.length) {
      commitQueue(purged);
      kickProcess();
    }
  }, [dismissedKeys, commitQueue, kickProcess]);

  const updateQueue = useCallback((updater: (prev: TailorQueueItem[]) => TailorQueueItem[]) => {
    return commitQueue(updater(queueRef.current));
  }, [commitQueue]);

  const handleRecoverableFailure = useCallback((
    jobKey: string,
    error: string,
    outcome?: import("../types/tailorQueue").TailorOutcomeKind,
  ) => {
    if (!isRecoverableTailorFailure(error, outcome)) return;
    void requestTailorRecovery(error).then((started) => {
      if (started) {
        pushLog("Auto-recovery triggered on Mac — fixing Ollama / tunnel…");
      }
      if (recoverTimerRef.current) window.clearTimeout(recoverTimerRef.current);
      recoverTimerRef.current = window.setTimeout(() => {
        const item = queueRef.current.find((i) => i.jobKey === jobKey);
        if (!item || (item.status !== "failed" && item.status !== "running")) return;
        forceReleaseProcessing();
        updateQueue((prev) => prev.map((entry) => (
          entry.jobKey === jobKey && (entry.status === "failed" || entry.status === "running")
            ? {
                ...entry,
                status: "pending" as const,
                error: undefined,
                startedAt: undefined,
                durationMs: undefined,
              }
            : entry
        )));
        pushLog("Re-queued failed job after auto-recovery — retrying…");
        kickProcess();
      }, RECOVER_RETRY_MS);
    });
  }, [pushLog, updateQueue, kickProcess, forceReleaseProcessing]);

  const enqueueJob = useCallback((job: Job, source: TailorQueueItem["source"], urgent = false) => {
    const jobKey = jobDismissKey(job);
    if (dismissedRef.current.has(jobKey)) return false;
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
        jobSnapshot: snapshotJobForQueue(job),
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
    recoverProcessLock(uid, tabIdRef.current);
    kickProcess(0);
    window.setTimeout(() => void processQueueRef.current?.(), 120);
    return true;
  }, [tailorStatus, updateQueue, kickProcess, uid]);

  const runHourlySync = useCallback((availableJobs: Job[], force = false) => {
    const now = Date.now();
    if (!force && lastSyncRef.current && now - lastSyncRef.current < HOURLY_SYNC_MS) {
      return 0;
    }

    const batch = hourBatchKey();
    const ranked = [...availableJobs]
      .map((job) => ({ job, score: careerOpsRating(job).score, key: jobDismissKey(job) }))
      .filter(({ key, job }) => {
        if (!job.job_url) return false;
        if (dismissedRef.current.has(key)) return false;
        const status = tailorStatus.getRecord(key)?.status;
        if (status === "done" || status === "running" || status === "no-go") return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);

    const { next, marks } = buildHourlyAdditions(
      queueRef.current,
      ranked,
      batch,
      dismissedRef.current,
    );
    if (marks.length > 0) {
      commitQueue(next);
      for (const mark of marks) {
        tailorStatus.markStatus(mark.key, "queued", mark.patch);
      }
    }

    const added = marks.length;
    const ts = Date.now();
    lastSyncRef.current = ts;
    setLastHourlySyncAt(ts);
    persistLastSync(uid, ts);

    const hasPending = queueRef.current.some((item) => item.status === "pending");
    if (added > 0) {
      setSyncMessage(`Hourly sync added ${added} job${added === 1 ? "" : "s"} to the tailor queue`);
    } else if (force) {
      setSyncMessage("Hourly sync: no new jobs to add");
    }

    // Resume processing whenever sync runs and work is waiting — not only when new jobs were added.
    if (added > 0 || hasPending) {
      kickProcess();
    }
    return added;
  }, [tailorStatus, uid, commitQueue, kickProcess]);

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
    let removedActive = false;
    updateQueue((prev) => prev.filter((item) => {
      if (item.jobKey !== jobKey) return true;
      if (item.status === "done" || item.status === "failed") return true;
      removedActive = true;
      return false;
    }));
    const record = tailorStatus.getRecord(jobKey);
    if (record?.status === "queued" || record?.status === "running") {
      tailorStatus.markStatus(jobKey, "none");
    }
    if (removedActive) kickProcess();
  }, [tailorStatus, updateQueue, kickProcess]);

  const processQueue = useCallback(async () => {
    if (!onProcessJob || processingRef.current) return;
    if (isAnotherTabProcessing(uid, tabIdRef.current)) return;

    const cleaned = purgeDismissedPending(queueRef.current, dismissedRef.current);
    if (cleaned.length !== queueRef.current.length) {
      commitQueue(cleaned);
    }

    const nextItem = queueRef.current.find(
      (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
    );
    if (!nextItem) return;

    if (!tryAcquireProcessLock(uid, tabIdRef.current, nextItem.jobKey)) return;

    if (recoverTimerRef.current) {
      window.clearTimeout(recoverTimerRef.current);
      recoverTimerRef.current = null;
    }

    processingRef.current = true;
    setProcessing(true);

    if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    heartbeatRef.current = window.setInterval(() => {
      touchProcessLock(uid, tabIdRef.current, nextItem.jobKey);
    }, 15_000);

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
    resetTailorLogCapture();

    const job = jobsRef.current.find((j) => jobDismissKey(j) === nextItem.jobKey) ?? nextItem.jobSnapshot ?? null;
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
      if (!dismissedRef.current.has(nextItem.jobKey)) {
        tailorStatus.markStatus(nextItem.jobKey, "failed", {
          error: "Job no longer in feed",
          outcome: "missing",
        });
      } else {
        tailorStatus.markStatus(nextItem.jobKey, "none");
      }
      pushLog(`Skipped ${nextItem.company} · job no longer in feed`, durationMs, "missing");
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      releaseProcessLockIfOwned(uid, tabIdRef.current);
      processingRef.current = false;
      setProcessing(false);
      kickProcess();
      return;
    }

    let diskPollId: number | null = null;
    const pollDiskForPdf = () => {
      void checkJobOnDisk(job).then((check) => {
        if (!check.found || !check.pdfPath) return;
        tailorStatus.markStatus(nextItem.jobKey, "done", {
          jobUrl: nextItem.jobUrl,
          company: nextItem.company,
          title: nextItem.title,
          score: nextItem.score,
          ats: check.ats,
          pdfPath: check.pdfPath,
          dir: check.dir,
          folder: check.folder,
          progressPct: 100,
          tailoredAt: new Date().toISOString(),
          outcome: "done",
          serverStatus: "ok",
        });
      });
    };
    pollDiskForPdf();
    diskPollId = window.setInterval(pollDiskForPdf, DISK_POLL_MS);

    try {
      const result = await onProcessJob(job);
      const durationMs = Date.now() - Date.parse(startedAt);

      // Server busy = another job is legitimately running on the Mac (e.g. after
      // a refresh left the prior run going). Do NOT mark failed or recover — that
      // creates a hammer loop. Put this job back to pending, release our lock,
      // and let the watchdog retry after a backoff once the Mac frees up.
      if (!result.ok && isTailorBusy(result.error)) {
        updateQueue((prev) => prev.map((item) => (
          item.jobKey === nextItem.jobKey
            ? { ...item, status: "pending" as const, startedAt: undefined }
            : item
        )));
        tailorStatus.markStatus(nextItem.jobKey, "queued", {
          jobUrl: nextItem.jobUrl,
          company: nextItem.company,
          title: nextItem.title,
          score: nextItem.score,
        });
        pushLog(`Waiting · ${nextItem.company} — Mac still finishing another resume`);
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        releaseProcessLockIfOwned(uid, tabIdRef.current);
        processingRef.current = false;
        setProcessing(false);
        window.setTimeout(() => kickProcess(), BUSY_BACKOFF_MS);
        return;
      }

      const done = result.ok;
      const dismissed = dismissedRef.current.has(nextItem.jobKey);
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
      if (dismissed) {
        tailorStatus.markStatus(nextItem.jobKey, "none");
      } else {
        const mapped = mapResultToRecordStatus(done, result.serverStatus, result.error, result.borderline);
        tailorStatus.markStatus(
          nextItem.jobKey,
          mapped.status,
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
            logs: result.logs,
            durationMs,
            outcome: result.outcome ?? mapped.outcome,
            serverStatus: result.serverStatus,
            explain: result.explain,
            borderline: result.borderline,
          },
        );
      }
      const finishOutcome = done
        ? "done" as const
        : (result.outcome ?? outcomeFromError(result.error));
      pushLog(
        done
          ? `Finished ${nextItem.company} · ${nextItem.title}${result.ats ? ` · ATS ${result.ats}` : ""}`
          : `Failed ${nextItem.company} · ${result.error || "unknown error"}`,
        durationMs,
        finishOutcome,
      );
      if (!done) {
        handleRecoverableFailure(
          nextItem.jobKey,
          result.error || "unknown error",
          result.outcome ?? outcomeFromError(result.error),
        );
      }
    } catch (e) {
      const durationMs = Date.now() - Date.parse(startedAt);
      const error = (e as Error).message || String(e);
      const failureOutcome = outcomeFromError(error);
      updateQueue((prev) => prev.map((item) => (
        item.jobKey === nextItem.jobKey
          ? { ...item, status: "failed" as const, error, durationMs }
          : item
      )));
      tailorStatus.markStatus(nextItem.jobKey, "failed", {
        error,
        durationMs,
        outcome: failureOutcome,
      });
      pushLog(`Failed ${nextItem.company} · ${error}`, durationMs, failureOutcome);
      handleRecoverableFailure(nextItem.jobKey, error, failureOutcome);
    } finally {
      if (diskPollId !== null) window.clearInterval(diskPollId);
      if (recoverTimerRef.current) {
        window.clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = null;
      }
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      releaseProcessLockIfOwned(uid, tabIdRef.current);
      processingRef.current = false;
      setProcessing(false);
      const hasMorePending = queueRef.current.some(
        (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
      );
      kickProcess(hasMorePending ? INTER_JOB_PAUSE_MS : 0);
    }
  }, [onProcessJob, tailorStatus, updateQueue, pushLog, kickProcess, commitQueue, uid, handleRecoverableFailure]);

  processQueueRef.current = processQueue;
  runHourlySyncRef.current = runHourlySync;

  useEffect(() => {
    if (processing || !onProcessJob) return;
    const hasPending = queue.some(
      (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
    );
    if (!hasPending) return;
    void processQueue();
  }, [queue, processing, onProcessJob, processQueue]);

  // Stable hourly timer — do NOT depend on `jobs` or it resets every dismiss/filter change.
  useEffect(() => {
    if (loading) return;

    const tick = (force = false) => {
      runHourlySyncRef.current(jobsRef.current, force);
    };

    tick();
    const id = window.setInterval(() => tick(), HOURLY_SYNC_MS);
    return () => window.clearInterval(id);
  }, [loading, uid]);

  // Nudge idle queues + catch up after tab sleep/background throttling.
  useEffect(() => {
    const nudge = () => {
      if (isAnotherTabProcessing(uid, tabIdRef.current)) return;
      const hasPending = queueRef.current.some(
        (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
      );
      if (!hasPending) return;
      if (!processingRef.current) kickProcess();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      runHourlySyncRef.current(jobsRef.current);
      nudge();
    };

    const watchdogId = window.setInterval(nudge, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(watchdogId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kickProcess, uid]);

  // If the relay stream drops, fetch can hang until we abort — unstick the queue.
  useEffect(() => {
    const id = window.setInterval(() => {
      const running = queueRef.current.find((item) => item.status === "running");
      const hasPending = queueRef.current.some(
        (item) => item.status === "pending" && !dismissedRef.current.has(item.jobKey),
      );

      // Deadlock: UI shows Processing but job was re-queued to pending.
      if (processingRef.current && !running) {
        pushLog("Resetting stuck processor — retrying queue…");
        forceReleaseProcessing();
        if (hasPending) kickProcess();
        return;
      }

      if (!processingRef.current || !running?.startedAt) return;
      const elapsed = Date.now() - Date.parse(running.startedAt);
      if (elapsed < RUNNING_STALE_MS) return;
      pushLog(`Aborting stale run after ${Math.round(elapsed / 60_000)}m — relay stream may have dropped`);
      abortActiveTailorJob();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [pushLog, forceReleaseProcessing, kickProcess]);

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

  const clearTailor = useCallback(() => {
    forceReleaseProcessing();
    updateQueue(() => []);
    setProcessLogs([]);
    persistProcessLogs(uid, []);
    tailorStatus.clearAllLogs();
    tailorStatus.resetPipelineRecords();
    setLogsPanelCleared(true);
    setSyncMessage("");
  }, [forceReleaseProcessing, updateQueue, uid, tailorStatus]);

  /** Re-add jobs marked queued in status but missing from the pending/running queue. */
  const healOrphanedQueuedJobs = useCallback((availableJobs: Job[]) => {
    let healed = 0;
    for (const job of availableJobs) {
      const jobKey = jobDismissKey(job);
      if (dismissedRef.current.has(jobKey)) continue;
      const record = tailorStatus.getRecord(jobKey);
      if (record?.status !== "queued") continue;
      const item = queueRef.current.find((entry) => entry.jobKey === jobKey);
      if (item?.status === "pending" || item?.status === "running") continue;
      const score = careerOpsRating(job).score;
      updateQueue((prev) => {
        const withoutStale = prev.filter((entry) => entry.jobKey !== jobKey || (entry.status !== "done" && entry.status !== "failed" && entry.status !== "skipped"));
        return [{
          jobKey,
          jobUrl: job.job_url || "",
          title: job.title || "Untitled role",
          company: job.company || "Unknown",
          score,
          priority: 1500 + score,
          enqueuedAt: new Date().toISOString(),
          hourBatch: hourBatchKey(),
          source: "manual" as const,
          status: "pending" as const,
          jobSnapshot: snapshotJobForQueue(job),
        }, ...withoutStale];
      });
      healed += 1;
    }
    if (healed > 0) {
      setSyncMessage(`Re-queued ${healed} job${healed === 1 ? "" : "s"} — sending to Mac…`);
      recoverProcessLock(uid, tabIdRef.current);
      kickProcess();
    }
    return healed;
  }, [tailorStatus, updateQueue, kickProcess, uid]);

  /** Force a single job back into the pending queue and start processing. */
  const requeueJob = useCallback((job: Job) => {
    const jobKey = jobDismissKey(job);
    if (dismissedRef.current.has(jobKey)) return false;
    const score = careerOpsRating(job).score;
    updateQueue((prev) => {
      const withoutStale = prev.filter((entry) => entry.jobKey !== jobKey || (entry.status !== "done" && entry.status !== "failed" && entry.status !== "skipped"));
      return [{
        jobKey,
        jobUrl: job.job_url || "",
        title: job.title || "Untitled role",
        company: job.company || "Unknown",
        score,
        priority: 2500 + score,
        enqueuedAt: new Date().toISOString(),
        hourBatch: hourBatchKey(),
        source: "manual" as const,
        status: "pending" as const,
        jobSnapshot: snapshotJobForQueue(job),
      }, ...withoutStale];
    });
    tailorStatus.markStatus(jobKey, "queued", {
      jobUrl: job.job_url || "",
      company: job.company || "Unknown",
      title: job.title || "Untitled role",
      score,
      error: undefined,
      progressPct: 5,
    });
    setSyncMessage(`Re-queued ${job.company || "job"} — sending to Mac…`);
    recoverProcessLock(uid, tabIdRef.current);
    forceReleaseProcessing();
    kickProcess(0);
    window.setTimeout(() => void processQueueRef.current?.(), 120);
    return true;
  }, [tailorStatus, updateQueue, kickProcess, uid, forceReleaseProcessing]);

  useEffect(() => {
    if (processing || pendingCount > 0) {
      setLogsPanelCleared(false);
    }
  }, [processing, pendingCount]);

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
    queueLoaded,
    enqueueJob,
    bumpUrgent,
    removeFromQueue,
    runHourlySync,
    processQueue,
    clearDone,
    clearTailor,
    logsPanelCleared,
    reorderPending,
    healOrphanedQueuedJobs,
    requeueJob,
  };
}
