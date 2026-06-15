import { useCallback, useEffect, useMemo, useState } from "react";
import type { TailorQueueItem } from "../types/tailorQueue";
import type { useTailorStatus } from "../hooks/useTailorStatus";
import { buildJobResumeView } from "../utils/jobResumeView";
import { assertTailorServerReady } from "../utils/tailorRun";
import { fetchCompileWorkers, type CompileWorker } from "../utils/compileQueueApi";
import TrustReportPanel from "./TrustReportPanel";

interface BucketManifest {
  generated_at?: string;
  descriptions_found?: number;
}

interface Props {
  queue: TailorQueueItem[];
  processing: boolean;
  runningItem: TailorQueueItem | null;
  doneToday: number;
  failedToday: number;
  tailorStatus: ReturnType<typeof useTailorStatus>;
  workerMode?: boolean;
  streamLive?: boolean;
  syncMessage?: string;
}

function fmtAge(iso?: string): string {
  if (!iso) return "unknown";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export default function CompilerStatusStrip({
  queue,
  processing,
  runningItem,
  doneToday,
  failedToday,
  tailorStatus,
  workerMode = true,
  streamLive = false,
  syncMessage,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [bucketAge, setBucketAge] = useState<string>("…");
  const [bucketStale, setBucketStale] = useState(false);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [workers, setWorkers] = useState<CompileWorker[]>([]);

  useEffect(() => {
    fetch("/job_descriptions/manifest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((m: BucketManifest) => {
        const age = fmtAge(m.generated_at);
        setBucketAge(age);
        const hours = m.generated_at ? (Date.now() - Date.parse(m.generated_at)) / 3_600_000 : 999;
        setBucketStale(hours > 2);
      })
      .catch(() => {
        setBucketAge("?");
        setBucketStale(true);
      });
  }, []);

  useEffect(() => {
    assertTailorServerReady()
      .then(() => setSidecarOk(true))
      .catch(() => setSidecarOk(false));
  }, [processing, runningItem?.jobKey]);

  useEffect(() => {
    if (!workerMode) return;
    const refresh = () => {
      void fetchCompileWorkers().then(setWorkers).catch(() => setWorkers([]));
    };
    refresh();
    const id = window.setInterval(refresh, 45_000);
    return () => window.clearInterval(id);
  }, [workerMode]);

  const workerSummary = useMemo(() => {
    if (!workers.length) return null;
    const busy = workers.filter((w) => w.status === "busy").length;
    return { total: workers.length, busy };
  }, [workers]);

  const compilingCount = useMemo(() => {
    const fromQueue = queue.filter((q) => q.status === "running" || q.status === "pending").length;
    const fromRecords = Object.values(tailorStatus.records).filter(
      (r) => r.status === "running" || r.status === "queued",
    ).length;
    return Math.max(fromQueue, fromRecords, processing ? 1 : 0);
  }, [queue, tailorStatus.records, processing]);

  const activeView = useMemo(() => {
    if (!runningItem) return null;
    const rec = tailorStatus.getRecord(runningItem.jobKey);
    return { view: buildJobResumeView(rec, runningItem), record: rec };
  }, [runningItem, tailorStatus]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const queuePreview = useMemo(() => {
    return queue
      .filter((q) => q.status === "pending" || q.status === "running")
      .slice(0, 8);
  }, [queue]);

  return (
    <section className="compiler-strip" aria-label="Compiler status">
      <button type="button" className="compiler-strip-bar" onClick={toggle} aria-expanded={expanded}>
        <span className="compiler-strip-title">Compiler</span>
        <span className={`compiler-strip-chip${bucketStale ? " is-warn" : ""}`}>
          {bucketStale ? "⚠" : "✓"} Buckets {bucketStale ? "stale" : "fresh"} ({bucketAge})
        </span>
        {sidecarOk === false ? (
          <span className="compiler-strip-chip is-error">Sidecar offline</span>
        ) : compilingCount > 0 ? (
          <span className="compiler-strip-chip is-running">● Compiling ({compilingCount})</span>
        ) : sidecarOk ? (
          <span className="compiler-strip-chip">✓ Sidecar</span>
        ) : null}
        {workerMode ? (
          <>
            <span className="compiler-strip-chip">{streamLive ? "● Live queue" : "Worker queue"}</span>
            {workerSummary ? (
              <span className="compiler-strip-chip">
                {workerSummary.busy > 0 ? `● ${workerSummary.busy} busy` : "○ idle"} · {workerSummary.total} worker{workerSummary.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </>
        ) : (
          <span className="compiler-strip-chip is-warn">Browser queue</span>
        )}
        <span className="compiler-strip-chip">✓ Today {doneToday}</span>
        {failedToday > 0 ? (
          <span className="compiler-strip-chip is-warn">⚠ Failed {failedToday}</span>
        ) : null}
        <span className="compiler-strip-chevron">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="compiler-strip-drawer">
          {runningItem && activeView ? (
            <div className="compiler-strip-active">
              <strong>{runningItem.company}</strong>
              <span>{activeView.view.subLine || activeView.view.statusLine}</span>
              {activeView.view.identityPrimary ? (
                <span className="compiler-strip-identity">{activeView.view.identityPrimary}</span>
              ) : null}
              {activeView.view.explain ? (
                <TrustReportPanel
                  explain={activeView.view.explain}
                  dir={activeView.record?.dir || activeView.record?.folder}
                  compact
                />
              ) : null}
            </div>
          ) : (
            <p className="compiler-strip-idle">
              {workerMode
                ? "Worker idle — hourly pipeline enqueues top jobs; compiles run without this tab open."
                : "Queue idle — hourly sync adds top jobs while this tab is open."}
              {syncMessage ? ` ${syncMessage}` : ""}
            </p>
          )}
          {workerMode && workers.length > 0 ? (
            <ul className="compiler-worker-list">
              {workers.map((w) => (
                <li key={w.worker_id} className={`compiler-worker-row is-${w.status || "idle"}`}>
                  <span className="compiler-worker-id">{w.hostname || w.worker_id}</span>
                  <span className="compiler-worker-status">{w.status === "busy" ? "compiling" : w.drive_mounted === false ? "no drive" : "idle"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {workerMode && queuePreview.length > 0 ? (
            <ul className="compiler-queue-preview" aria-label="Compile queue">
              {queuePreview.map((item) => (
                <li key={item.jobKey} className={`compiler-queue-row is-${item.status}`}>
                  <span className="compiler-queue-company">{item.company}</span>
                  <span className="compiler-queue-title">{item.title}</span>
                  <span className="compiler-queue-state">{item.status === "running" ? "● running" : "queued"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
