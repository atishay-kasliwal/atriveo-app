import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";

const KEY = (uid: string) => `atriveo_apply_stats_v1_${uid}`;

export type TrackerStatus = "applied" | "rejected" | null;
export type OfferStatus = "pending" | "accepted" | "declined" | null;

export interface ApplyMetadata {
  location?: string | null;
  jobApplicationId?: string | null;
}

export type ApplySyncStatus = "idle" | "syncing" | "synced" | "queued" | "error";
export type ApplySyncScope = "latest" | "today";
export type JobTrackerSyncStatus = "pending" | "synced" | "duplicate" | "error" | "not_configured" | "skipped" | null;

export interface ApplySyncState {
  status: ApplySyncStatus;
  scope: ApplySyncScope;
  message: string;
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
}

export interface ApplyRecord {
  clicks: number;
  lastAppliedAt: string;
  title: string | null;
  company: string | null;
  location: string | null;
  jobApplicationId: string | null;
  trackerStatus: TrackerStatus;
  trackerSyncStatus: JobTrackerSyncStatus;
  trackerSyncMessage: string | null;
  trackerSyncedAt: string | null;
  interviewAt: string | null;
  offerStatus: OfferStatus;
}

interface ApplyStats {
  count: number;
  todayCount: number;  // resets at midnight EST
  todayDate: string;   // YYYY-MM-DD in America/New_York — used to detect rollover
  lastClickAt: string | null;
  lastJobTitle: string | null;
  lastCompany: string | null;
  appliedJobs: Record<string, ApplyRecord>;
}

function todayEst(): string {
  // Returns "YYYY-MM-DD" in America/New_York — handles both EST and EDT automatically
  return new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
}

function empty(): ApplyStats {
  return { count: 0, todayCount: 0, todayDate: todayEst(), lastClickAt: null, lastJobTitle: null, lastCompany: null, appliedJobs: {} };
}

function normalizeJobs(raw: unknown): Record<string, ApplyRecord> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, ApplyRecord> = {};
  for (const [url, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (!url || !rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const lastAppliedAt = String(r.lastAppliedAt || r.appliedAt || "");
    const rawClicks = Number(r.clicks);
    const clicks = Number.isFinite(rawClicks) && rawClicks > 0 ? Math.floor(rawClicks) : lastAppliedAt ? 1 : 0;
    if (!clicks || !lastAppliedAt) continue;
    const ts = r.trackerStatus === "applied" || r.trackerStatus === "rejected" ? r.trackerStatus : null;
    const offerRaw = r.offerStatus;
    const offerStatus: OfferStatus = offerRaw === "pending" || offerRaw === "accepted" || offerRaw === "declined"
      ? offerRaw
      : null;
    result[url] = {
      clicks,
      lastAppliedAt,
      title: String(r.title || ""),
      company: String(r.company || ""),
      location: r.location ? String(r.location) : null,
      jobApplicationId: r.jobApplicationId || r.job_application_id ? String(r.jobApplicationId || r.job_application_id) : null,
      trackerStatus: ts,
      trackerSyncStatus: normalizeTrackerSyncStatus(r.trackerSyncStatus),
      trackerSyncMessage: r.trackerSyncMessage ? String(r.trackerSyncMessage) : null,
      trackerSyncedAt: r.trackerSyncedAt ? String(r.trackerSyncedAt) : null,
      interviewAt: r.interviewAt ? String(r.interviewAt) : null,
      offerStatus,
    };
  }
  return result;
}

function normalizeTrackerSyncStatus(raw: unknown): JobTrackerSyncStatus {
  return raw === "pending" ||
    raw === "synced" ||
    raw === "duplicate" ||
    raw === "error" ||
    raw === "not_configured" ||
    raw === "skipped"
    ? raw
    : null;
}

function normalize(raw: unknown): ApplyStats {
  if (!raw || typeof raw !== "object") return empty();
  const p = raw as Record<string, unknown>;
  const storedDate = p.todayDate ? String(p.todayDate) : "";
  const currentDate = todayEst();
  // Reset daily counter if stored date is from a previous day
  const todayCount = storedDate === currentDate ? (Number(p.todayCount) || 0) : 0;
  return {
    count: Number(p.count) || 0,
    todayCount,
    todayDate: currentDate,
    lastClickAt: p.lastClickAt ? String(p.lastClickAt) : null,
    lastJobTitle: p.lastJobTitle ? String(p.lastJobTitle) : null,
    lastCompany: p.lastCompany ? String(p.lastCompany) : null,
    appliedJobs: normalizeJobs(p.appliedJobs),
  };
}

function load(uid: string): ApplyStats {
  try {
    // Try user-scoped key, fall back to anon key, then legacy key for migration
    const raw = localStorage.getItem(KEY(uid)) ?? localStorage.getItem(KEY("anon")) ?? localStorage.getItem("atriveo_apply_stats_v1");
    return raw ? normalize(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

function persist(uid: string, stats: ApplyStats) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(stats)); } catch { /* ignore */ }
}

function latestJobUrl(stats: ApplyStats): string | null {
  let latest: { url: string; time: number } | null = null;
  for (const [url, record] of Object.entries(stats.appliedJobs)) {
    const time = Date.parse(record.lastAppliedAt || "");
    if (!Number.isFinite(time)) continue;
    if (!latest || time > latest.time) latest = { url, time };
  }
  return latest?.url ?? null;
}

function syncToServer(stats: ApplyStats, scope: ApplySyncScope = "latest") {
  const suffix = scope === "today" ? "?sync=today" : "";
  return fetch(`/api/tracker${suffix}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stats),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Unable to sync tracker");
    return data;
  });
}

type TrackerSyncDescription = {
  status: ApplySyncStatus;
  message: string;
  lastSynced: boolean;
  jobUpdates: Array<{
    jobUrl: string;
    trackerSyncStatus: JobTrackerSyncStatus;
    trackerSyncMessage: string;
    trackerSyncedAt?: string;
  }>;
};

function trackerResultToJobUpdate(result: Record<string, unknown>, nowIso: string): TrackerSyncDescription["jobUpdates"][number] | null {
  const jobUrl = typeof result.jobUrl === "string" ? result.jobUrl : "";
  if (!jobUrl) return null;
  if (result.synced === true) {
    const duplicate = result.duplicate === true;
    return {
      jobUrl,
      trackerSyncStatus: duplicate ? "duplicate" : "synced",
      trackerSyncMessage: duplicate ? "Already exists in Atriveo tracker." : "Added to Atriveo tracker.",
      trackerSyncedAt: nowIso,
    };
  }
  if (typeof result.skipped === "string") {
    return {
      jobUrl,
      trackerSyncStatus: "skipped",
      trackerSyncMessage: `Tracker skipped: ${result.skipped}`,
    };
  }
  const status = Number(result.status || 0);
  return {
    jobUrl,
    trackerSyncStatus: "error",
    trackerSyncMessage: status ? `Atriveo tracker returned HTTP ${status}.` : "Atriveo tracker sync failed.",
  };
}

function describeTrackerSync(data: unknown, scope: ApplySyncScope, nowIso: string): TrackerSyncDescription {
  const envelope = data && typeof data === "object" ? data as { trackerSync?: Record<string, unknown> } : {};
  const trackerSync = envelope.trackerSync;
  if (!trackerSync) {
    return { status: "error", message: "Saved locally, but tracker response was missing.", lastSynced: false, jobUpdates: [] };
  }

  if (trackerSync.configured === false) {
    const missing = Array.isArray(trackerSync.missing)
      ? trackerSync.missing.filter((item) => typeof item === "string").join(", ")
      : "TRACKER_API_URL/TRACKER_API_TOKEN";
    const jobUrl = typeof trackerSync.jobUrl === "string" ? trackerSync.jobUrl : "";
    return {
      status: "queued",
      message: `Saved locally. Missing Cloudflare secret/env: ${missing}.`,
      lastSynced: false,
      jobUpdates: jobUrl ? [{
        jobUrl,
        trackerSyncStatus: "not_configured",
        trackerSyncMessage: `Missing Cloudflare secret/env: ${missing}.`,
      }] : [],
    };
  }

  const failed = Number(trackerSync.failed || 0);
  const total = Number(trackerSync.total || 0);
  const duplicates = Number(trackerSync.duplicates || 0);
  if (scope === "today" && total > 0) {
    const results = Array.isArray(trackerSync.results) ? trackerSync.results : [];
    const jobUpdates = results
      .map((result) => result && typeof result === "object" ? trackerResultToJobUpdate(result as Record<string, unknown>, nowIso) : null)
      .filter((update): update is NonNullable<typeof update> => Boolean(update));
    if (failed > 0) {
      return {
        status: "error",
        message: `${failed} Atriveo tracker sync issue${failed === 1 ? "" : "s"} — local progress is safe.`,
        lastSynced: false,
        jobUpdates,
      };
    }
    const duplicateText = duplicates > 0 ? ` · ${duplicates} already there` : "";
    return {
      status: "synced",
      message: `End-day sync checked ${total} application${total === 1 ? "" : "s"}${duplicateText}.`,
      lastSynced: true,
      jobUpdates,
    };
  }

  if (trackerSync.synced === true) {
    const duplicate = trackerSync.duplicate === true;
    return {
      status: "synced",
      message: duplicate ? "Already exists in Atriveo tracker." : "Added to Atriveo tracker.",
      lastSynced: true,
      jobUpdates: trackerSync.jobUrl ? [trackerResultToJobUpdate(trackerSync, nowIso)].filter((update): update is NonNullable<typeof update> => Boolean(update)) : [],
    };
  }

  if (typeof trackerSync.skipped === "string") {
    return {
      status: "queued",
      message: `Saved locally. Tracker skipped ${trackerSync.skipped}.`,
      lastSynced: false,
      jobUpdates: trackerSync.jobUrl ? [trackerResultToJobUpdate(trackerSync, nowIso)].filter((update): update is NonNullable<typeof update> => Boolean(update)) : [],
    };
  }

  if (trackerSync.synced === false || trackerSync.error) {
    const status = Number(trackerSync.status || 0);
    const detail = typeof trackerSync.error === "string" && trackerSync.error
      ? ` ${trackerSync.error.slice(0, 120)}`
      : "";
    return {
      status: "error",
      message: status ? `Atriveo tracker returned HTTP ${status}.${detail}` : `Tracker sync needs retry — local progress is safe.${detail}`,
      lastSynced: false,
      jobUpdates: trackerSync.jobUrl ? [trackerResultToJobUpdate(trackerSync, nowIso)].filter((update): update is NonNullable<typeof update> => Boolean(update)) : [],
    };
  }

  return { status: "error", message: "Saved locally, but tracker sync result was unclear.", lastSynced: false, jobUpdates: [] };
}

export function useApplyTracker() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.email ?? "anon";

  const [stats, setStats] = useState<ApplyStats>(empty);
  const [syncState, setSyncState] = useState<ApplySyncState>({
    status: "idle",
    scope: "latest",
    message: "Ready to sync applications.",
    lastAttemptAt: null,
    lastSyncedAt: null,
  });

  const syncSnapshot = useCallback((snapshot: ApplyStats, scope: ApplySyncScope = "latest") => {
    const lastAttemptAt = new Date().toISOString();
    if (uid === "anon") {
      setSyncState((prev) => ({
        ...prev,
        status: "queued",
        scope,
        message: "Sign in to sync this progress.",
        lastAttemptAt,
      }));
      return Promise.resolve(false);
    }

    setSyncState((prev) => ({
      ...prev,
      status: "syncing",
      scope,
      message: scope === "today" ? "Running end-day sync…" : "Syncing latest application…",
      lastAttemptAt,
    }));

    return syncToServer(snapshot, scope)
      .then((data) => {
        const nowIso = new Date().toISOString();
        const result = describeTrackerSync(data, scope, nowIso);
        setSyncState((prev) => ({
          ...prev,
          status: result.status,
          scope,
          message: result.message,
          lastAttemptAt,
          lastSyncedAt: result.lastSynced ? nowIso : prev.lastSyncedAt,
        }));
        if (result.jobUpdates.length) {
          setStats((prev) => {
            let changed = false;
            const appliedJobs = { ...prev.appliedJobs };
            result.jobUpdates.forEach((update) => {
              const existing = appliedJobs[update.jobUrl];
              if (!existing) return;
              changed = true;
              appliedJobs[update.jobUrl] = {
                ...existing,
                trackerSyncStatus: update.trackerSyncStatus,
                trackerSyncMessage: update.trackerSyncMessage,
                trackerSyncedAt: update.trackerSyncedAt ?? existing.trackerSyncedAt,
              };
            });
            if (!changed) return prev;
            const next = { ...prev, appliedJobs };
            persist(uid, next);
            return next;
          });
        }
        return result.status === "synced";
      })
      .catch(() => {
        setSyncState((prev) => ({
          ...prev,
          status: "error",
          scope,
          message: "Network hiccup — saved locally, retry sync later.",
          lastAttemptAt,
        }));
        const jobUrl = scope === "latest" ? latestJobUrl(snapshot) : null;
        if (jobUrl) {
          setStats((prev) => {
            const existing = prev.appliedJobs[jobUrl];
            if (!existing) return prev;
            const next = {
              ...prev,
              appliedJobs: {
                ...prev.appliedJobs,
                [jobUrl]: {
                  ...existing,
                  trackerSyncStatus: "error" as const,
                  trackerSyncMessage: "Could not reach app server or Atriveo tracker.",
                },
              },
            };
            persist(uid, next);
            return next;
          });
        }
        return false;
      });
  }, [uid]);

  // On auth resolved: load cache instantly, then pull server state
  useEffect(() => {
    if (authLoading) return;

    // Instant render from localStorage cache (may be migrated from anon)
    const cached = load(uid);
    setStats(cached);

    // Then fetch from server (cross-device source of truth)
    if (uid !== "anon") {
      fetch("/api/tracker")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          const normalized = normalize(data);
          const serverIsEmpty = normalized.count === 0 && Object.keys(normalized.appliedJobs).length === 0;
          // If server empty but we have local/anon data, push it up
          if (serverIsEmpty && cached.count > 0) {
            persist(uid, cached);
            syncSnapshot(cached);
          } else if (!serverIsEmpty) {
            setStats(normalized);
            persist(uid, normalized);
          }
        })
        .catch(() => { /* stick with localStorage on network error */ });
    }
  }, [uid, authLoading, syncSnapshot]);

  const recordClick = useCallback((jobUrl: string, title: string, company: string, metadata: ApplyMetadata = {}) => {
    setStats((prev) => {
      const nowIso = new Date().toISOString();
      const currentDate = todayEst();
      const existing = prev.appliedJobs[jobUrl];
      const isNewJob = !existing;
      // Reset daily counter if we've crossed midnight EST
      const prevTodayCount = prev.todayDate === currentDate ? prev.todayCount : 0;
      const next: ApplyStats = {
        count: prev.count + (isNewJob ? 1 : 0),
        todayCount: prevTodayCount + (isNewJob ? 1 : 0),
        todayDate: currentDate,
        lastClickAt: nowIso,
        lastJobTitle: title,
        lastCompany: company,
        appliedJobs: {
          ...prev.appliedJobs,
          [jobUrl]: {
            clicks: (existing?.clicks || 0) + (isNewJob ? 1 : 0),
            lastAppliedAt: nowIso,
            title,
            company,
            location: metadata.location ?? existing?.location ?? null,
            jobApplicationId: metadata.jobApplicationId ?? existing?.jobApplicationId ?? null,
            trackerStatus: existing?.trackerStatus ?? null,
            trackerSyncStatus: "pending",
            trackerSyncMessage: "Sending to Atriveo tracker…",
            trackerSyncedAt: existing?.trackerSyncedAt ?? null,
            interviewAt: existing?.interviewAt ?? null,
            offerStatus: existing?.offerStatus ?? null,
          },
        },
      };
      persist(uid, next);
      syncSnapshot(next);
      return next;
    });
  }, [syncSnapshot, uid]);

  const getRecord = useCallback((jobUrl: string): ApplyRecord | null => {
    return stats.appliedJobs[jobUrl] ?? null;
  }, [stats]);

  const setTrackerStatus = useCallback((jobUrl: string, status: TrackerStatus) => {
    setStats((prev) => {
      const existing = prev.appliedJobs[jobUrl];
      if (!existing) return prev;
      const next: ApplyStats = {
        ...prev,
        appliedJobs: {
          ...prev.appliedJobs,
          [jobUrl]: { ...existing, trackerStatus: status },
        },
      };
      persist(uid, next);
      syncSnapshot(next);
      return next;
    });
  }, [syncSnapshot, uid]);

  const updatePipelineStage = useCallback((
    jobUrl: string,
    patch: { interviewAt?: string | null; offerStatus?: OfferStatus },
  ) => {
    setStats((prev) => {
      const existing = prev.appliedJobs[jobUrl];
      if (!existing) return prev;
      const next: ApplyStats = {
        ...prev,
        appliedJobs: {
          ...prev.appliedJobs,
          [jobUrl]: {
            ...existing,
            interviewAt: patch.interviewAt !== undefined ? patch.interviewAt : existing.interviewAt,
            offerStatus: patch.offerStatus !== undefined ? patch.offerStatus : existing.offerStatus,
          },
        },
      };
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const syncNow = useCallback((scope: ApplySyncScope = "today") => {
    persist(uid, stats);
    return syncSnapshot(stats, scope);
  }, [stats, syncSnapshot, uid]);

  return { stats, recordClick, getRecord, setTrackerStatus, updatePipelineStage, syncState, syncNow };
}
