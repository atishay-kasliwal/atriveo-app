import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import type { Job } from "../types";
import { careerOpsRating } from "../utils/jobPresentation";

const KEY = (uid: string) => `atriveo_apply_click_log_v1_${uid}`;

export type SavedJobSource = "apply" | "click" | "add";

export interface ApplyClickRecord {
  jobUrl: string;
  title: string;
  company: string;
  location: string | null;
  site: string | null;
  clickedAt: string;
  clicks: number;
  level: string | null;
  score: number | null;
  source: SavedJobSource;
}

function todayEst(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
}

function estDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 10);
}

function normalize(raw: unknown): ApplyClickRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const jobUrl = String(record.jobUrl || "");
      const clickedAt = String(record.clickedAt || "");
      if (!jobUrl || !clickedAt) return null;
      return {
        jobUrl,
        title: String(record.title || "Untitled role"),
        company: String(record.company || "Unknown company"),
        location: record.location ? String(record.location) : null,
        site: record.site ? String(record.site) : null,
        clickedAt,
        clicks: Math.max(1, Math.floor(Number(record.clicks) || 1)),
        level: record.level ? String(record.level) : null,
        score: record.score == null ? null : Math.round(Number(record.score)),
        source: record.source === "apply" || record.source === "add" ? record.source : "click",
      };
    })
    .filter((record): record is ApplyClickRecord => Boolean(record));
}

function load(uid: string): ApplyClickRecord[] {
  try {
    const raw = localStorage.getItem(KEY(uid)) ?? localStorage.getItem(KEY("anon"));
    return raw ? normalize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function persist(uid: string, records: ApplyClickRecord[]) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(records.slice(0, 250)));
  } catch {
    /* ignore */
  }
}

export function useApplyClickLog() {
  const { user, loading } = useAuth();
  const uid = user?.email ?? "anon";
  const [records, setRecords] = useState<ApplyClickRecord[]>([]);

  useEffect(() => {
    if (loading) return;
    setRecords(load(uid));
  }, [loading, uid]);

  const recordSavedJob = useCallback((job: Job, source: SavedJobSource) => {
    if (!job.job_url) return;
    setRecords((prev) => {
      const nowIso = new Date().toISOString();
      const existing = prev.find((record) => record.jobUrl === job.job_url);
      const nextRecord: ApplyClickRecord = {
        jobUrl: job.job_url,
        title: job.title || "Untitled role",
        company: job.company || "Unknown company",
        location: job.location || null,
        site: job.site || null,
        clickedAt: nowIso,
        clicks: (existing?.clicks || 0) + 1,
        level: job.level || null,
        score: careerOpsRating(job).score,
        source,
      };
      const next = [nextRecord, ...prev.filter((record) => record.jobUrl !== job.job_url)];
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const removeApplyClick = useCallback((jobUrl: string) => {
    if (!jobUrl) return;
    setRecords((prev) => {
      const next = prev.filter((record) => record.jobUrl !== jobUrl);
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const clickedUrlSet = useMemo(
    () => new Set(records.map((record) => record.jobUrl)),
    [records],
  );

  const todayRecords = useMemo(() => {
    const today = todayEst();
    return records.filter((record) => estDateKey(record.clickedAt) === today);
  }, [records]);

  return { records, todayRecords, clickedUrlSet, recordSavedJob, removeApplyClick };
}
