import type { Job } from "../types";
import { careerOpsRating, jobBoardLabel, matchReasons } from "./jobPresentation";
import { loadJobDescriptions } from "./jobDescriptionBuckets";

function value(text?: string | number | null): string {
  if (text === null || text === undefined || text === "") return "—";
  return String(text);
}

function normalizeBody(text?: string | null): string {
  const cleaned = (text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || "No captured JD/summary available for this job.";
}

function isCapturedSummaryLikelyTruncated(text?: string | null): boolean {
  return /…\s*$/.test((text || "").trim());
}

function experienceRange(job: Job): string {
  if (job.min_exp == null && job.max_exp == null) return "—";
  if (job.min_exp != null && job.max_exp != null) return `${job.min_exp} - ${job.max_exp} years`;
  if (job.min_exp != null) return `${job.min_exp}+ years`;
  return `Up to ${job.max_exp} years`;
}

export function jobCopyKey(job: Job): string {
  return job.job_url || `${job.company}::${job.title}::${job.location}::${job.batch_time}`;
}

/** Stable per-posting id for dismiss / restore (never company-wide). */
export function jobDismissKey(job: Job): string {
  return jobCopyKey(job);
}

export function formatJobForClipboard(job: Job, index: number, fullDescription?: string): string {
  const careerOps = careerOpsRating(job);
  const reasons = matchReasons(job, 8);
  const hasFullDescription = Boolean(fullDescription?.trim());
  const descriptionLabel = hasFullDescription
    ? "Full Job Description:"
    : isCapturedSummaryLikelyTruncated(job.summary)
      ? "Captured Summary (full JD unavailable in current export):"
      : "JD / Summary:";
  const rows = [
    `Company: ${value(job.company)}`,
    `Title: ${value(job.title)}`,
    `Location: ${value(job.location)}`,
    `Level: ${value(job.level)}`,
    `Experience: ${experienceRange(job)}`,
    job.pipeline ? `Pipeline: ${job.pipeline}` : null,
    `Board: ${jobBoardLabel(job.site, job.job_url)}`,
    `Search term: ${value(job.search_term)}`,
    `CareerOps: ${careerOps.score}/100 (${careerOps.grade}, ${careerOps.label})`,
    `Raw score: ${value(job.score)}/250`,
    job.ats_score === undefined ? null : `ATS score: ${value(job.ats_score)}%`,
    job.fit_score === undefined ? null : `Fit score: ${value(job.fit_score)}`,
    `Competition score: ${value(job.competition_score)}`,
    `Posted: ${value(job.date_posted)}`,
    `Run/batch time: ${value(job.batch_time)}`,
    job.scraped_date ? `Scraped date: ${job.scraped_date}` : null,
    `Job URL: ${value(job.job_url)}`,
    reasons.length ? `Resume-match tags: ${reasons.join(", ")}` : null,
  ].filter(Boolean);

  return [
    `## ${index}. ${value(job.title)} — ${value(job.company)}`,
    ...rows,
    "",
    descriptionLabel,
    normalizeBody(fullDescription || job.summary),
  ].join("\n");
}

export function formatJobsForClipboard(jobs: Job[], descriptionsByUrl: Record<string, string> = {}): string {
  const copiedAt = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const header = [
    `# Atriveo Selected Jobs (${jobs.length})`,
    `Copied: ${copiedAt} ET`,
  ].join("\n");

  return [
    header,
    ...jobs.map((job, index) => formatJobForClipboard(job, index + 1, descriptionsByUrl[job.job_url])),
  ].join("\n\n---\n\n");
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/** Copy full JD from description buckets, or fall back to scraped summary. */
export async function copyJobDescription(
  job: Job,
): Promise<"full" | "summary" | "missing"> {
  const descriptionsByUrl = await loadJobDescriptions([job]);
  const full = job.job_url ? descriptionsByUrl[job.job_url] : undefined;
  if (full?.trim()) {
    await copyTextToClipboard(normalizeBody(full));
    return "full";
  }
  const summary = (job.summary || "").trim();
  if (summary) {
    await copyTextToClipboard(normalizeBody(summary));
    return "summary";
  }
  return "missing";
}
