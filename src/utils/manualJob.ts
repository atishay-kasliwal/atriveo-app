import type { Job } from "../types";
import { jobDismissKey } from "./jobCopy";

export interface ManualJobInput {
  company: string;
  title: string;
  jobUrl?: string;
  description: string;
}

export interface ManualTailorSession {
  id: string;
  jobKey: string;
  company: string;
  title: string;
  jdPreview: string;
  submittedAt: string;
}

const MANUAL_JOBS_KEY = (uid: string) => `atriveo_manual_jobs_v1_${uid}`;
const SESSIONS_KEY = (uid: string) => `atriveo_manual_tailor_sessions_v1_${uid}`;

export function createManualJob(input: ManualJobInput): Job {
  const description = input.description.trim();
  const url = input.jobUrl?.trim() || `manual://${crypto.randomUUID()}`;
  return {
    title: input.title.trim() || "unknown-role",
    company: input.company.trim() || "unknown1",
    location: "Manual entry",
    level: "",
    min_exp: null,
    max_exp: null,
    job_url: url,
    date_posted: new Date().toISOString(),
    batch_time: new Date().toISOString(),
    score: 80,
    score_pct: 80,
    competition_score: 0,
    site: "manual",
    search_term: "manual",
    summary: description,
  };
}

export function snapshotJobForQueue(job: Job): Job {
  return {
    session_id: job.session_id,
    title: job.title,
    company: job.company,
    location: job.location,
    level: job.level,
    min_exp: job.min_exp,
    max_exp: job.max_exp,
    job_url: job.job_url,
    date_posted: job.date_posted,
    batch_time: job.batch_time,
    score: job.score,
    score_pct: job.score_pct,
    competition_score: job.competition_score,
    pipeline: job.pipeline,
    site: job.site,
    search_term: job.search_term,
    summary: job.summary,
    scraped_date: job.scraped_date,
    ats_score: job.ats_score,
    fit_score: job.fit_score,
  };
}

export function loadManualJobs(uid: string): Job[] {
  try {
    const raw = localStorage.getItem(MANUAL_JOBS_KEY(uid)) ?? localStorage.getItem(MANUAL_JOBS_KEY("anon"));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Job[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistManualJobs(uid: string, jobs: Job[]): void {
  try {
    localStorage.setItem(MANUAL_JOBS_KEY(uid), JSON.stringify(jobs));
  } catch {
    /* ignore */
  }
}

export function upsertManualJob(uid: string, job: Job): Job[] {
  const key = jobDismissKey(job);
  const prev = loadManualJobs(uid);
  const next = [job, ...prev.filter((item) => jobDismissKey(item) !== key)];
  persistManualJobs(uid, next);
  return next;
}

export function loadManualTailorSessions(uid: string): ManualTailorSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY(uid)) ?? localStorage.getItem(SESSIONS_KEY("anon"));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManualTailorSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistManualTailorSessions(uid: string, sessions: ManualTailorSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY(uid), JSON.stringify(sessions.slice(0, 80)));
  } catch {
    /* ignore */
  }
}

export function createManualSession(job: Job, description: string): ManualTailorSession {
  const preview = description.trim().replace(/\s+/g, " ").slice(0, 220);
  return {
    id: crypto.randomUUID(),
    jobKey: jobDismissKey(job),
    company: job.company,
    title: job.title,
    jdPreview: preview.length < description.trim().length ? `${preview}…` : preview,
    submittedAt: new Date().toISOString(),
  };
}
