import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import TailorQueueBar from "../components/TailorQueueBar";
import ManualTailorAssistantCard from "../components/ManualTailorAssistantCard";
import { useAuth } from "../hooks/useAuth";
import { useTailorQueue } from "../hooks/useTailorQueue";
import { useTailorStatus } from "../hooks/useTailorStatus";
import type { Job } from "../types";
import {
  createManualJob,
  createManualSession,
  loadManualJobs,
  loadManualTailorSessions,
  persistManualTailorSessions,
  upsertManualJob,
  type ManualTailorSession,
} from "../utils/manualJob";
import { nextManualSlot, parseManualJd } from "../utils/parseManualJd";
import { openTailorPath, runSingleTailorJob } from "../utils/tailorRun";
import { buildTailorStreamHandler } from "../utils/tailorStreamHandler";

export default function ManualTailor() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.email ?? "anon";
  const [manualJobs, setManualJobs] = useState<Job[]>([]);
  const [sessions, setSessions] = useState<ManualTailorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [parsedPreview, setParsedPreview] = useState<{ company: string; title: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authLoading) return;
    const jobs = loadManualJobs(uid);
    const loadedSessions = loadManualTailorSessions(uid);
    setManualJobs(jobs);
    setSessions(loadedSessions);
    setActiveSessionId(loadedSessions[0]?.id ?? null);
    setHydrated(true);
  }, [authLoading, uid]);

  const tailorStatus = useTailorStatus();

  const processQueueJob = useCallback(async (job: Job) => {
    const onEvent = buildTailorStreamHandler(tailorStatus, job);
    return runSingleTailorJob(job, onEvent);
  }, [tailorStatus]);

  const tailorQueue = useTailorQueue(manualJobs, {
    tailorStatus,
    onProcessJob: processQueueJob,
  });

  const tailorQueueLogContext = useMemo(() => {
    const runningKey = tailorQueue.runningItem?.jobKey;
    const runningRecord = runningKey ? tailorStatus.getRecord(runningKey) : null;
    const runningLogs = runningRecord?.logs ?? [];

    let lastFinishedLogs: typeof runningLogs = [];
    let lastFinishedLabel: string | undefined;
    let bestAt = 0;

    for (const item of tailorQueue.queue) {
      if (item.status !== "done" && item.status !== "failed") continue;
      if (item.jobKey === runningKey) continue;
      const record = tailorStatus.getRecord(item.jobKey);
      if (!record?.logs?.length) continue;
      const at = Date.parse(record.tailoredAt || item.startedAt || "0");
      if (at >= bestAt) {
        bestAt = at;
        lastFinishedLogs = record.logs;
        lastFinishedLabel = `${record.company} · ${record.title}`;
      }
    }

    return { runningLogs, lastFinishedLogs, lastFinishedLabel };
  }, [
    tailorQueue.runningItem,
    tailorQueue.queue,
    tailorStatus.records,
    tailorStatus.getRecord,
  ]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  );

  const queuePositionFor = useCallback((jobKey: string) => {
    const pending = tailorQueue.queue.filter((item) => item.status === "pending");
    const idx = pending.findIndex((item) => item.jobKey === jobKey);
    return idx >= 0 ? idx + 1 : null;
  }, [tailorQueue.queue]);

  const resumeSaved = useMemo(() => {
    const text = localStorage.getItem("atriveo_resume") || "";
    return text.trim().length >= 50;
  }, []);

  const canSubmit = description.trim().length >= 50 && resumeSaved;

  useEffect(() => {
    const jd = description.trim();
    if (jd.length < 20) {
      setParsedPreview(null);
      return;
    }
    const slot = nextManualSlot(sessions);
    const parsed = parseManualJd(jd, slot);
    setParsedPreview({ company: parsed.company, title: parsed.title });
  }, [description, sessions]);

  const handleSubmit = () => {
    setFormError("");
    const jd = description.trim();
    if (jd.length < 50) {
      setFormError("Paste at least 50 characters of job description.");
      return;
    }
    if (!resumeSaved) {
      setFormError("Save your resume in Settings before tailoring.");
      return;
    }

    const slot = nextManualSlot(sessions);
    const parsed = parseManualJd(jd, slot);
    const job = createManualJob({
      company: parsed.company,
      title: parsed.title,
      jobUrl: parsed.jobUrl,
      description: parsed.description,
    });
    const nextJobs = upsertManualJob(uid, job);
    setManualJobs(nextJobs);

    const queued = tailorQueue.enqueueJob(job, "manual", true);
    if (!queued) {
      setFormError("Could not add to queue — this job may already be tailored or in progress.");
      return;
    }

    const session = createManualSession(job, jd);
    const nextSessions = [session, ...sessions];
    setSessions(nextSessions);
    persistManualTailorSessions(uid, nextSessions);
    setActiveSessionId(session.id);
    setDescription("");
    setParsedPreview(null);
    window.setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  const handleOpenFolder = useCallback(async (path: string) => {
    try {
      await openTailorPath(path);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions.length, tailorStatus.records]);

  if (!hydrated) {
    return (
      <div>
        <AppHeader />
        <div className="content-loading"><div className="spin" /></div>
      </div>
    );
  }

  return (
    <div className="manual-tailor-page">
      <AppHeader />
      <div className="wrapper page-shell page-shell-wide manual-tailor-shell">
        <PageIntro
          compact
          kicker="Tailor lab"
          title="Manual Tailor"
          description="Paste a full job description — company, role, and URL are extracted automatically. Same shared tailor queue as Live Feed."
          stats={[
            { label: "Queue", value: tailorQueue.pendingCount, tone: "orange" },
            { label: "Done today", value: tailorStatus.resumesCreatedTodayCount, tone: "green" },
            { label: "Resume", value: resumeSaved ? "Ready" : "Missing", tone: resumeSaved ? "green" : "red" },
          ]}
        />

        {(tailorQueue.totalInQueue > 0 || tailorQueue.processing) ? (
          <TailorQueueBar
            queue={tailorQueue.queue}
            pendingCount={tailorQueue.pendingCount}
            doneInQueue={tailorQueue.doneInQueue}
            failedInQueue={tailorQueue.failedInQueue}
            totalInQueue={tailorQueue.totalInQueue}
            overallProgressPct={tailorQueue.overallProgressPct}
            processLogs={tailorQueue.processLogs}
            queueTiming={tailorQueue.queueTiming}
            processing={tailorQueue.processing}
            runningItem={tailorQueue.runningItem}
            runningLogs={tailorQueueLogContext.runningLogs}
            lastFinishedLogs={tailorQueueLogContext.lastFinishedLogs}
            lastFinishedLabel={tailorQueueLogContext.lastFinishedLabel}
            lastHourlySyncAt={tailorQueue.lastHourlySyncAt}
            syncMessage={tailorQueue.syncMessage}
            onSyncNow={() => tailorQueue.runHourlySync(manualJobs, true)}
            onProcessNow={() => void tailorQueue.processQueue()}
            onClearDone={() => tailorQueue.clearDone()}
            onClearTailor={() => tailorQueue.clearTailor()}
            logsPanelCleared={tailorQueue.logsPanelCleared}
            onBumpUrgent={tailorQueue.bumpUrgent}
            onRemoveFromQueue={tailorQueue.removeFromQueue}
            onReorderPending={tailorQueue.reorderPending}
          />
        ) : null}

        <div className="manual-tailor-layout">
          <aside className="manual-tailor-sidebar" aria-label="Past manual jobs">
            <div className="manual-tailor-sidebar-head">
              <h2>Sessions</h2>
              <span>{sessions.length}</span>
            </div>
            {sessions.length === 0 ? (
              <p className="manual-tailor-sidebar-empty">No manual jobs yet. Paste a JD below to start.</p>
            ) : (
              <ul className="manual-tailor-session-list">
                {sessions.map((session) => {
                  const record = tailorStatus.getRecord(session.jobKey);
                  const tone = record?.status === "done"
                    ? "done"
                    : record?.status === "running"
                      ? "running"
                      : record?.status === "failed"
                        ? "failed"
                        : "queued";
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        className={`manual-tailor-session-btn${activeSession?.id === session.id ? " is-active" : ""}`}
                        onClick={() => setActiveSessionId(session.id)}
                      >
                        <span className={`manual-tailor-session-dot manual-tailor-session-dot--${tone}`} aria-hidden />
                        <span className="manual-tailor-session-copy">
                          <strong>{session.company}</strong>
                          <span>{session.title}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="manual-tailor-chat" aria-label="Tailor conversation">
            <div className="manual-tailor-messages">
              {sessions.length === 0 ? (
                <div className="manual-tailor-empty-state">
                  <h3>Paste a job description to tailor</h3>
                  <p>
                    Paste the full JD below. Company, role, and URL are picked up automatically
                    (falls back to unknown1, unknown2, … when missing).
                  </p>
                </div>
              ) : (
                [...sessions].reverse().map((session) => {
                  const record = tailorStatus.getRecord(session.jobKey);
                  const queueItem = tailorQueue.queue.find((item) => item.jobKey === session.jobKey) ?? null;
                  const queuePosition = queuePositionFor(session.jobKey);
                  const isActive = activeSession?.id === session.id;

                  return (
                    <div
                      key={session.id}
                      className={`manual-tailor-thread${isActive ? " is-active" : ""}`}
                      onClick={() => setActiveSessionId(session.id)}
                    >
                      <div className="manual-tailor-user-bubble">
                        <div className="manual-tailor-bubble-label">You</div>
                        <p className="manual-tailor-user-title">
                          Tailor <strong>{session.company}</strong> · {session.title}
                        </p>
                        <p className="manual-tailor-user-jd">{session.jdPreview}</p>
                        <time className="manual-tailor-time" dateTime={session.submittedAt}>
                          {new Date(session.submittedAt).toLocaleString()}
                        </time>
                      </div>

                      <div className="manual-tailor-assistant-wrap">
                        <div className="manual-tailor-bubble-label">Tailor</div>
                        <ManualTailorAssistantCard
                          session={session}
                          record={record}
                          queueItem={queueItem}
                          queuePosition={queuePosition}
                          onOpenFolder={handleOpenFolder}
                        />
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="manual-tailor-composer">
              <label className="manual-tailor-field manual-tailor-field--jd">
                <span>Job description</span>
                <textarea
                  className="manual-tailor-jd"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={"Paste the entire job posting here — title, company, LinkedIn URL, full JD…"}
                  rows={10}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
              </label>

              {parsedPreview ? (
                <p className="manual-tailor-parse-preview">
                  Detected: <strong>{parsedPreview.company}</strong> · {parsedPreview.title}
                </p>
              ) : null}

              {formError ? <p className="manual-tailor-error">{formError}</p> : null}
              {!resumeSaved ? (
                <p className="manual-tailor-hint">
                  Add your resume in <a href="/settings">Settings</a> before tailoring.
                </p>
              ) : null}

              <div className="manual-tailor-composer-actions">
                <span className="manual-tailor-char-count">
                  {description.trim().length} chars
                  {description.trim().length > 0 && description.trim().length < 50 ? " · need 50+" : ""}
                </span>
                <button
                  type="button"
                  className="manual-tailor-submit"
                  disabled={!canSubmit || tailorQueue.processing}
                  onClick={handleSubmit}
                >
                  Add to queue
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
