import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
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
import { nextManualSlot, parseManualJd, applyManualOverrides } from "../utils/parseManualJd";
import { assertTailorServerReady, openTailorPath, runSingleTailorJob } from "../utils/tailorRun";
import { buildTailorStreamHandler } from "../utils/tailorStreamHandler";
import { jobDismissKey } from "../utils/jobCopy";

const MIN_JD_CHARS = 200;

function displayTitle(title: string): string {
  if (/^unknown-role-\d+$/i.test(title)) return "Role not detected";
  return title;
}

function isUnknownCompany(company: string): boolean {
  return /^unknown\d+$/i.test(company);
}

export default function ManualTailor() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.email ?? "anon";
  const [manualJobs, setManualJobs] = useState<Job[]>([]);
  const [sessions, setSessions] = useState<ManualTailorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [companyOverride, setCompanyOverride] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [formError, setFormError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [macStatus, setMacStatus] = useState<"checking" | "ready" | "offline">("checking");
  const [macStatusDetail, setMacStatusDetail] = useState("");
  const requeueGuardRef = useRef<string | null>(null);

  const resolvedFields = useMemo(() => {
    const jd = description.trim();
    if (jd.length < 20) return null;
    const slot = nextManualSlot(sessions);
    const parsed = parseManualJd(jd, slot);
    return applyManualOverrides(parsed, {
      company: companyOverride,
      title: titleOverride,
    }, slot);
  }, [description, sessions, companyOverride, titleOverride]);


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

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  );

  const findJobForSession = useCallback((session: ManualTailorSession): Job | null => {
    return manualJobs.find((job) => jobDismissKey(job) === session.jobKey) ?? null;
  }, [manualJobs]);

  useEffect(() => {
    if (!hydrated || !tailorQueue.queueLoaded) return;
    const healed = tailorQueue.healOrphanedQueuedJobs(manualJobs);
    if (healed === 0 && tailorQueue.pendingCount > 0 && !tailorQueue.processing) {
      void tailorQueue.processQueue();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- heal once when queue is ready
  }, [hydrated, tailorQueue.queueLoaded, manualJobs.length]);

  // Auto-heal stuck "Queued" cards that never made it to the pending queue.
  useEffect(() => {
    if (!activeSession || !tailorQueue.queueLoaded) return;
    const record = tailorStatus.getRecord(activeSession.jobKey);
    if (record?.status !== "queued") {
      requeueGuardRef.current = null;
      return;
    }
    const queueItem = tailorQueue.queue.find((item) => item.jobKey === activeSession.jobKey);
    if (queueItem?.status === "pending" || queueItem?.status === "running") return;
    if (requeueGuardRef.current === activeSession.jobKey) return;
    const job = findJobForSession(activeSession);
    if (!job) return;
    requeueGuardRef.current = activeSession.jobKey;
    tailorQueue.requeueJob(job);
  }, [activeSession, tailorQueue.queueLoaded, tailorQueue.queue, tailorStatus, findJobForSession, tailorQueue]);

  useEffect(() => {
    let cancelled = false;
    const checkMac = async () => {
      setMacStatus("checking");
      try {
        await assertTailorServerReady();
        if (!cancelled) {
          setMacStatus("ready");
          setMacStatusDetail("Mac tailor is online and drive is mounted.");
        }
      } catch (e) {
        if (!cancelled) {
          setMacStatus("offline");
          setMacStatusDetail((e as Error).message || "Mac tailor unreachable");
        }
      }
    };
    void checkMac();
    const id = window.setInterval(() => void checkMac(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const queuePositionFor = useCallback((jobKey: string) => {
    const pending = tailorQueue.queue.filter((item) => item.status === "pending");
    const idx = pending.findIndex((item) => item.jobKey === jobKey);
    return idx >= 0 ? idx + 1 : null;
  }, [tailorQueue.queue]);

  const resumeSaved = useMemo(() => {
    const text = localStorage.getItem("atriveo_resume") || "";
    return text.trim().length >= 50;
  }, []);

  const canSubmit = description.trim().length >= MIN_JD_CHARS;

  const handleSubmit = () => {
    setFormError("");
    const jd = description.trim();
    if (jd.length < MIN_JD_CHARS) {
      setFormError(`Paste at least ${MIN_JD_CHARS} characters of job description.`);
      return;
    }

    const slot = nextManualSlot(sessions);
    const parsed = parseManualJd(jd, slot);
    const resolved = applyManualOverrides(parsed, {
      company: companyOverride,
      title: titleOverride,
    }, slot);
    const job = createManualJob({
      company: resolved.company,
      title: resolved.title,
      jobUrl: resolved.jobUrl,
      description: resolved.description,
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
    setCompanyOverride("");
    setTitleOverride("");
    requeueGuardRef.current = null;
    void tailorQueue.processQueue();
  };

  const handleRetrySession = useCallback(() => {
    if (!activeSession) return;
    const job = findJobForSession(activeSession);
    if (!job) return;
    requeueGuardRef.current = null;
    tailorQueue.requeueJob(job);
  }, [activeSession, findJobForSession, tailorQueue]);

  const handleOpenFolder = useCallback(async (path: string) => {
    try {
      await openTailorPath(path);
    } catch (e) {
      console.error(e);
    }
  }, []);

  if (!hydrated) {
    return (
      <div className="manual-tailor-root">
        <AppHeader hideLogo />
        <div className="content-loading"><div className="spin" /></div>
      </div>
    );
  }

  const activeRecord = activeSession ? tailorStatus.getRecord(activeSession.jobKey) : null;
  const activeQueueItem = activeSession
    ? tailorQueue.queue.find((item) => item.jobKey === activeSession.jobKey) ?? null
    : null;
  const activeQueuePosition = activeSession ? queuePositionFor(activeSession.jobKey) : null;
  const isStuckQueued = Boolean(
    activeRecord?.status === "queued"
    && activeQueueItem?.status !== "pending"
    && activeQueueItem?.status !== "running"
    && tailorQueue.pendingCount === 0,
  );

  return (
    <div className="manual-tailor-root">
      <AppHeader hideLogo />
      <div className="manual-tailor-viewport">

        {/* Hero card — grid overlay + stats */}
        <section className="mt-hero-card">
          <div className="mt-hero-grid" aria-hidden />
          <div className="mt-hero-content">
            <div className="mt-hero-left">
              <div className="mt-hero-eyebrow">LOADOUT · TAILOR ENGINE</div>
              <h1 className="mt-hero-title">
                Three steps —{" "}
                <span className="mt-hero-accent">paste, diff, export.</span>
              </h1>
              <p className="mt-hero-sub">
                Paste any job posting. We extract company and role, then run the Mac tailor. Review before exporting so you ship a resume you trust.
              </p>
            </div>
            <dl className="mt-metrics">
              <div>
                <dt>Queue</dt>
                <dd>{tailorQueue.pendingCount}</dd>
              </div>
              <div>
                <dt>Done Today</dt>
                <dd>{tailorStatus.resumesCreatedTodayCount}</dd>
              </div>
              <div>
                <dt>Resume</dt>
                <dd className={resumeSaved ? "mt-metric-ok" : "mt-metric-dim"}>
                  {resumeSaved ? "Ready" : "Opt"}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Mac status */}
        <div className={`mt-mac-status mt-mac-status--${macStatus}`} role="status">
          {macStatus === "checking" ? "Checking Mac tailor connection…" : null}
          {macStatus === "ready" ? `Mac connected · ${macStatusDetail}` : null}
          {macStatus === "offline" ? (
            <>Mac not reachable — {macStatusDetail} · Ensure <code>com.atriveo.tailor</code> is running and the Cloudflare tunnel is up.</>
          ) : null}
        </div>

        {/* Body: main + right rail */}
        <div className="mt-body">
          <main className="mt-main">
            {/* Queue bar */}
            <div className="mt-queue-slot">
              <TailorQueueBar
                variant="manual"
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
                runningProgressPct={
                  tailorQueue.runningItem
                    ? tailorStatus.getRecord(tailorQueue.runningItem.jobKey)?.progressPct ?? 12
                    : undefined
                }
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
            </div>

            {/* Active session detail */}
            {activeSession && (
              <section className="mt-detail" aria-label="Selected job">
                <div className="mt-detail-head">
                  <div>
                    <h2>{isUnknownCompany(activeSession.company) ? "Company not detected" : activeSession.company}</h2>
                    <p className="mt-detail-title">{displayTitle(activeSession.title)}</p>
                  </div>
                  <time className="mt-detail-time" dateTime={activeSession.submittedAt}>
                    {new Date(activeSession.submittedAt).toLocaleString()}
                  </time>
                </div>
                <details className="mt-jd-preview">
                  <summary>Pasted job description</summary>
                  <p>{activeSession.jdPreview}</p>
                </details>
                <ManualTailorAssistantCard
                  session={activeSession}
                  record={activeRecord}
                  queueItem={activeQueueItem}
                  queuePosition={activeQueuePosition}
                  onOpenFolder={handleOpenFolder}
                  onRetry={isStuckQueued ? handleRetrySession : undefined}
                  stuckQueued={isStuckQueued}
                />
              </section>
            )}

            {/* Compose card */}
            <section className="mt-compose" aria-label="Paste job description">
              <div className="mt-compose-head">
                <div>
                  <h2>{activeSession ? "Tailor another job" : "Paste the job description"}</h2>
                  <p className="mt-compose-sub">Title, company, URL, full JD — anything. We'll parse what we need.</p>
                </div>
                <span className="mt-compose-hint">⌘/Ctrl + Enter to submit</span>
              </div>
              <div className="mt-compose-fields">
                <label className="mt-field">
                  <span>Company</span>
                  <input
                    type="text"
                    className="mt-field-input"
                    value={companyOverride}
                    onChange={(e) => setCompanyOverride(e.target.value)}
                    placeholder="Heron — auto-detect if blank"
                  />
                </label>
                <label className="mt-field">
                  <span>Role</span>
                  <input
                    type="text"
                    className="mt-field-input"
                    value={titleOverride}
                    onChange={(e) => setTitleOverride(e.target.value)}
                    placeholder="Platform Engineer — auto-detect"
                  />
                </label>
              </div>
              <textarea
                className="mt-jd-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Paste the entire job posting here — title, company, LinkedIn URL, full JD…"
                rows={10}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
              {resolvedFields ? (
                <div className={`mt-parse-preview${isUnknownCompany(resolvedFields.company) || /^unknown-role/i.test(resolvedFields.title) ? " mt-parse-preview--warn" : ""}`}>
                  <span className="mt-parse-label">Will use</span>
                  <span><strong>{resolvedFields.company}</strong>{" · "}{resolvedFields.title}</span>
                  {(isUnknownCompany(resolvedFields.company) || /^unknown-role/i.test(resolvedFields.title)) && !companyOverride && !titleOverride
                    ? <span className="mt-parse-tip">Fill in Company and Role above, or we'll use unknown names.</span>
                    : null}
                </div>
              ) : null}
              {formError ? <p className="mt-error">{formError}</p> : null}
              <div className="mt-compose-foot">
                <span className="mt-char-count">
                  {description.trim().length} chars
                  {description.trim().length > 0 && description.trim().length < MIN_JD_CHARS ? ` · need ${MIN_JD_CHARS}+` : ""}
                </span>
                <button
                  type="button"
                  className="mt-submit"
                  disabled={!canSubmit || tailorQueue.processing}
                  onClick={handleSubmit}
                >
                  Add to queue <span aria-hidden>→</span>
                </button>
              </div>
            </section>
          </main>

          {/* Right rail */}
          <aside className="mt-rail" aria-label="Queue and sessions">
            {/* Sessions */}
            <div className="mt-rail-card">
              <div className="mt-rail-head">
                <span className="mt-rail-label">Sessions</span>
                <span className="mt-rail-count">{sessions.length}</span>
              </div>
              {sessions.length === 0 ? (
                <p className="mt-sessions-empty">No tailor runs yet. Drop a JD to start.</p>
              ) : (
                <ul className="mt-session-list">
                  {sessions.map((session) => {
                    const record = tailorStatus.getRecord(session.jobKey);
                    const tone = record?.status === "done" ? "done"
                      : record?.status === "running" ? "running"
                      : record?.status === "failed" ? "failed"
                      : "queued";
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          className={`mt-session-btn${activeSession?.id === session.id ? " is-active" : ""}`}
                          onClick={() => setActiveSessionId(session.id)}
                        >
                          <span className={`mt-session-dot mt-session-dot--${tone}`} aria-hidden />
                          <span className="mt-session-copy">
                            <strong>{isUnknownCompany(session.company) ? "Company not detected" : session.company}</strong>
                            <span>{displayTitle(session.title)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Shortcuts */}
            <div className="mt-rail-card">
              <div className="mt-rail-head">
                <span className="mt-rail-label">Shortcuts</span>
              </div>
              <ul className="mt-shortcuts">
                <li><span>Submit JD</span><kbd>⌘ ↵</kbd></li>
                <li><span>Clear form</span><kbd>⌘ ⌫</kbd></li>
              </ul>
            </div>

            {/* How it works — shown only when no sessions */}
            {sessions.length === 0 && (
              <div className="mt-rail-card">
                <div className="mt-rail-head">
                  <span className="mt-rail-label">How it works</span>
                </div>
                <ol className="mt-steps">
                  <li>
                    <strong>Paste the full job posting</strong>
                    <span>Include title, company, URL, and the complete description.</span>
                  </li>
                  <li>
                    <strong>We parse company &amp; role</strong>
                    <span>LinkedIn posts work best. Missing fields fall back to unknown names.</span>
                  </li>
                  <li>
                    <strong>Mac tailor runs automatically</strong>
                    <span>PDFs land in your tailored-resumes folder when done.</span>
                  </li>
                </ol>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
