import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";

const KEY = (uid: string) => `atriveo_apply_stats_v1_${uid}`;

export type TrackerStatus = "applied" | "rejected" | null;

export interface ApplyMetadata {
  location?: string | null;
  jobApplicationId?: string | null;
}

export type ApplySyncStatus = "idle" | "syncing" | "synced" | "queued" | "error";
export type ApplySyncScope = "latest" | "today";

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
    result[url] = {
      clicks,
      lastAppliedAt,
      title: String(r.title || ""),
      company: String(r.company || ""),
      location: r.location ? String(r.location) : null,
      jobApplicationId: r.jobApplicationId || r.job_application_id ? String(r.jobApplicationId || r.job_application_id) : null,
      trackerStatus: ts,
    };
  }
  return result;
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

function describeTrackerSync(data: unknown, scope: ApplySyncScope): { failed: boolean; message: string } {
  const envelope = data && typeof data === "object" ? data as { trackerSync?: Record<string, unknown> } : {};
  const trackerSync = envelope.trackerSync;
  if (!trackerSync) return { failed: false, message: "Saved locally and synced to Atriveo." };

  if (trackerSync.configured === false) {
    return { failed: false, message: "Saved locally. Add tracker secrets to enable API sync." };
  }

  const failed = Number(trackerSync.failed || 0);
  const total = Number(trackerSync.total || 0);
  const duplicates = Number(trackerSync.duplicates || 0);
  if (scope === "today" && total > 0) {
    if (failed > 0) {
      return { failed: true, message: `${failed} tracker sync issue${failed === 1 ? "" : "s"} — local progress is safe.` };
    }
    const duplicateText = duplicates > 0 ? ` · ${duplicates} already there` : "";
    return { failed: false, message: `End-day sync checked ${total} application${total === 1 ? "" : "s"}${duplicateText}.` };
  }

  if (trackerSync.synced === true) {
    return { failed: false, message: trackerSync.duplicate ? "Already synced in tracker." : "Synced to tracker." };
  }

  if (typeof trackerSync.skipped === "string") {
    return { failed: false, message: `Saved locally. Tracker skipped ${trackerSync.skipped}.` };
  }

  if (trackerSync.synced === false || trackerSync.error) {
    return { failed: true, message: "Tracker sync needs retry — local progress is safe." };
  }

  return { failed: false, message: "Saved locally and synced to Atriveo." };
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
        const result = describeTrackerSync(data, scope);
        const nowIso = new Date().toISOString();
        setSyncState((prev) => ({
          ...prev,
          status: result.failed ? "error" : "synced",
          scope,
          message: result.message,
          lastAttemptAt,
          lastSyncedAt: result.failed ? prev.lastSyncedAt : nowIso,
        }));
        return !result.failed;
      })
      .catch(() => {
        setSyncState((prev) => ({
          ...prev,
          status: "error",
          scope,
          message: "Network hiccup — saved locally, retry sync later.",
          lastAttemptAt,
        }));
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
      // Reset daily counter if we've crossed midnight EST
      const prevTodayCount = prev.todayDate === currentDate ? prev.todayCount : 0;
      const next: ApplyStats = {
        count: prev.count + 1,
        todayCount: prevTodayCount + 1,
        todayDate: currentDate,
        lastClickAt: nowIso,
        lastJobTitle: title,
        lastCompany: company,
        appliedJobs: {
          ...prev.appliedJobs,
          [jobUrl]: {
            clicks: (existing?.clicks || 0) + 1,
            lastAppliedAt: nowIso,
            title,
            company,
            location: metadata.location ?? existing?.location ?? null,
            jobApplicationId: metadata.jobApplicationId ?? existing?.jobApplicationId ?? null,
            trackerStatus: existing?.trackerStatus ?? null,
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

  const syncNow = useCallback((scope: ApplySyncScope = "today") => {
    persist(uid, stats);
    return syncSnapshot(stats, scope);
  }, [stats, syncSnapshot, uid]);

  return { stats, recordClick, getRecord, setTrackerStatus, syncState, syncNow };
}
