import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../types";
import type { TailorProcessLogEntry, TailorQueueItem } from "../types/tailorQueue";
import { HOURLY_QUEUE_SIZE, HOURLY_SYNC_MS } from "../types/tailorQueue";
import { careerOpsRating } from "../utils/jobPresentation";
import { jobDismissKey } from "../utils/jobCopy";
import {
  cancelCompileJob,
  enqueueCompileJob,
  enqueueCompileTop,
  fetchCompileQueue,
  isMongoCompileAvailable,
  subscribeCompileQueueStream,
  type CompileQueueJob,
} from "../utils/compileQueueApi";
import { buildQueueFromMongo, mergeCompileJobChange, syncRecordsFromMongo } from "../utils/mongoCompileMap";
import type { useTailorStatus } from "./useTailorStatus";

type TailorStatusApi = Pick<
  ReturnType<typeof useTailorStatus>,
  "getRecord" | "markStatus" | "reconcileWithQueue"
>;

interface Options {
  tailorStatus: TailorStatusApi;
  dismissedKeys?: ReadonlySet<string>;
}

const POLL_FALLBACK_MS = 15_000;

export function useMongoCompileQueue(jobs: Job[], options: Options) {
  const { tailorStatus, dismissedKeys } = options;
  const dismissedRef = useRef<ReadonlySet<string>>(dismissedKeys ?? new Set());
  dismissedRef.current = dismissedKeys ?? dismissedRef.current;

  const [queue, setQueue] = useState<TailorQueueItem[]>([]);
  const [mongoAvailable, setMongoAvailable] = useState<boolean | null>(null);
  const [streamLive, setStreamLive] = useState(false);
  const [lastHourlySyncAt, setLastHourlySyncAt] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const [processLogs, setProcessLogs] = useState<TailorProcessLogEntry[]>([]);
  const [logsPanelCleared, setLogsPanelCleared] = useState(false);
  const jobsRef = useRef(jobs);
  const mongoJobsRef = useRef<CompileQueueJob[]>([]);
  const lastSyncRef = useRef(0);
  const logSeqRef = useRef(0);
  const streamLiveRef = useRef(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const pushLog = useCallback((message: string) => {
    logSeqRef.current += 1;
    const entry: TailorProcessLogEntry = {
      id: `${Date.now()}-${logSeqRef.current}`,
      at: new Date().toISOString(),
      message,
    };
    setProcessLogs((prev) => [entry, ...prev].slice(0, 80));
  }, []);

  const applyMongoJobs = useCallback((mongoJobs: CompileQueueJob[]) => {
    mongoJobsRef.current = mongoJobs;
    const built = buildQueueFromMongo(mongoJobs, jobsRef.current).filter(
      (item) => !dismissedRef.current.has(item.jobKey),
    );
    setQueue(built);
    syncRecordsFromMongo(mongoJobs, jobsRef.current, tailorStatus.markStatus);
    tailorStatus.reconcileWithQueue(built);
    return built;
  }, [tailorStatus]);

  const refreshFromMongo = useCallback(async () => {
    const mongoJobs = await fetchCompileQueue(120);
    setMongoAvailable(true);
    return applyMongoJobs(mongoJobs);
  }, [applyMongoJobs]);

  useEffect(() => {
    void isMongoCompileAvailable().then(setMongoAvailable);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCompileQueueStream({
      limit: 120,
      onSnapshot: (mongoJobs) => {
        setMongoAvailable(true);
        applyMongoJobs(mongoJobs);
      },
      onChange: (job) => {
        applyMongoJobs(mergeCompileJobChange(mongoJobsRef.current, job));
      },
      onConnect: () => {
        streamLiveRef.current = true;
        setStreamLive(true);
      },
      onDisconnect: () => {
        streamLiveRef.current = false;
        setStreamLive(false);
      },
    });
    return unsubscribe;
  }, [applyMongoJobs]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (streamLiveRef.current) return;
      void refreshFromMongo().catch(() => setMongoAvailable(false));
    }, POLL_FALLBACK_MS);
    return () => window.clearInterval(id);
  }, [refreshFromMongo]);

  const enqueueJob = useCallback((job: Job, _source: TailorQueueItem["source"], urgent = false) => {
    const jobKey = jobDismissKey(job);
    if (dismissedRef.current.has(jobKey)) return false;
    if (!job.job_url) return false;

    const existing = tailorStatus.getRecord(jobKey);
    if (existing?.status === "done") {
      setSyncMessage(`${job.company || "Job"} already compiled`);
      return false;
    }

    void enqueueCompileJob({
      job_url: job.job_url,
      company: job.company || undefined,
      title: job.title || undefined,
      score_pct: careerOpsRating(job).score,
      force: urgent,
    }).then((result) => {
      if (result.skipped) {
        const msg = result.reason === "cache_hit"
          ? `Cache hit — PDF already exists for ${job.title || "role"}`
          : `Already queued or running: ${job.title || "role"}`;
        setSyncMessage(msg);
        if (result.reason === "cache_hit") {
          pushLog(`Cache hit ${job.company} · ${job.title}`);
          tailorStatus.markStatus(jobKey, "done", {
            jobUrl: job.job_url,
            company: job.company || "Unknown",
            title: job.title || "Role",
            score: careerOpsRating(job).score,
            pdfPath: result.pdf_path,
            progressPct: 100,
            tailoredAt: new Date().toISOString(),
            outcome: "done",
            serverStatus: "ok",
          });
        }
      } else {
        setSyncMessage(urgent ? `Queued urgent: ${job.title || "role"}` : `Queued: ${job.title || "role"}`);
        pushLog(`Enqueued ${job.company} · ${job.title}`);
        tailorStatus.markStatus(jobKey, "queued", {
          jobUrl: job.job_url,
          company: job.company || "Unknown",
          title: job.title || "Role",
          score: careerOpsRating(job).score,
        });
      }
      if (!streamLiveRef.current) void refreshFromMongo();
    }).catch((e) => {
      setSyncMessage(`Enqueue failed: ${(e as Error).message}`);
    });

    return true;
  }, [tailorStatus, refreshFromMongo, pushLog]);

  const runHourlySync = useCallback((_availableJobs: Job[], force = false) => {
    const now = Date.now();
    if (!force && lastSyncRef.current && now - lastSyncRef.current < HOURLY_SYNC_MS) {
      return 0;
    }

    void enqueueCompileTop(HOURLY_QUEUE_SIZE, 0).then((result) => {
      const added = result.enqueued ?? 0;
      const ts = Date.now();
      lastSyncRef.current = ts;
      setLastHourlySyncAt(ts);
      if (added > 0) {
        setSyncMessage(`Hourly sync queued ${added} job${added === 1 ? "" : "s"} in Mongo`);
        pushLog(`Hourly sync · ${added} jobs queued for worker`);
      } else if (force) {
        setSyncMessage("Hourly sync: no new jobs to queue");
      }
      if (!streamLiveRef.current) void refreshFromMongo();
    }).catch((e) => {
      setSyncMessage(`Hourly sync failed: ${(e as Error).message}`);
    });

    return 0;
  }, [refreshFromMongo, pushLog]);

  useEffect(() => {
    runHourlySync(jobsRef.current);
    const id = window.setInterval(() => runHourlySync(jobsRef.current), HOURLY_SYNC_MS);
    return () => window.clearInterval(id);
  }, [runHourlySync]);

  const bumpUrgent = useCallback((jobKey: string) => {
    const item = queue.find((q) => q.jobKey === jobKey);
    if (!item?.jobUrl) return;
    void enqueueCompileJob({
      job_url: item.jobUrl,
      company: item.company,
      title: item.title,
      score_pct: item.score,
      force: true,
    }).then(() => {
      setSyncMessage("Re-queued with priority");
      if (!streamLiveRef.current) void refreshFromMongo();
    });
  }, [queue, refreshFromMongo]);

  const removeFromQueue = useCallback((jobKey: string) => {
    const item = queue.find((q) => q.jobKey === jobKey);
    if (!item?.jobUrl || item.status !== "pending") return;
    void cancelCompileJob(item.jobUrl).then(() => {
      tailorStatus.markStatus(jobKey, "none");
      if (!streamLiveRef.current) void refreshFromMongo();
    });
  }, [queue, tailorStatus, refreshFromMongo]);

  const reorderPending = useCallback((_orderedKeys: string[]) => {
    setSyncMessage("Queue order is worker-managed by score");
  }, []);

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
  const processing = Boolean(runningItem);

  const overallProgressPct = useMemo(() => {
    const total = Math.max(1, pendingCount + (runningItem ? 1 : 0) + doneInQueue + failedInQueue);
    const doneWeight = doneInQueue + failedInQueue;
    const runningWeight = runningItem
      ? (tailorStatus.getRecord(runningItem.jobKey)?.progressPct ?? 28) / 100
      : 0;
    return Math.min(100, Math.round(((doneWeight + runningWeight) / total) * 100));
  }, [pendingCount, runningItem, doneInQueue, failedInQueue, tailorStatus]);

  const queueTiming = useMemo(() => ({
    avgDurationMs: null as number | null,
    totalDurationMs: 0,
    etaMs: null as number | null,
    finishedCount: doneInQueue + failedInQueue,
  }), [doneInQueue, failedInQueue]);

  const clearDone = useCallback(() => {
    setSyncMessage("Worker queue refreshes live from Mongo");
    void refreshFromMongo();
  }, [refreshFromMongo]);

  const clearTailor = useCallback(() => {
    setProcessLogs([]);
    setLogsPanelCleared(true);
    setSyncMessage("");
  }, []);

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
    processQueue: async () => { /* worker-owned */ },
    clearDone,
    clearTailor,
    logsPanelCleared,
    reorderPending,
    mongoAvailable,
    streamLive,
    refreshFromMongo,
  };
}
