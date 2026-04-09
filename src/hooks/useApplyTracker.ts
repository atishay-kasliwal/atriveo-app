import { useState, useCallback } from "react";

const STORAGE_KEY = "atriveo_apply_stats_v1";

export type TrackerStatus = "applied" | "rejected" | null;

export interface ApplyRecord {
  clicks: number;
  lastAppliedAt: string;
  title: string | null;
  company: string | null;
  trackerStatus: TrackerStatus;
}

interface ApplyStats {
  count: number;
  lastClickAt: string | null;
  lastJobTitle: string | null;
  lastCompany: string | null;
  appliedJobs: Record<string, ApplyRecord>;
}

function load(): ApplyStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw);
    return {
      count: Number(p.count) || 0,
      lastClickAt: p.lastClickAt || null,
      lastJobTitle: p.lastJobTitle || null,
      lastCompany: p.lastCompany || null,
      appliedJobs: normalizeJobs(p.appliedJobs),
    };
  } catch {
    return empty();
  }
}

function empty(): ApplyStats {
  return { count: 0, lastClickAt: null, lastJobTitle: null, lastCompany: null, appliedJobs: {} };
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
    result[url] = { clicks, lastAppliedAt, title: String(r.title || ""), company: String(r.company || ""), trackerStatus: ts };
  }
  return result;
}

function save(stats: ApplyStats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}

export function useApplyTracker() {
  const [stats, setStats] = useState<ApplyStats>(load);

  const recordClick = useCallback((jobUrl: string, title: string, company: string) => {
    setStats((prev) => {
      const nowIso = new Date().toISOString();
      const existing = prev.appliedJobs[jobUrl];
      const next: ApplyStats = {
        count: prev.count + 1,
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
            trackerStatus: existing?.trackerStatus ?? null,
          },
        },
      };
      save(next);
      return next;
    });
  }, []);

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
      save(next);
      return next;
    });
  }, []);

  return { stats, recordClick, getRecord, setTrackerStatus };
}
