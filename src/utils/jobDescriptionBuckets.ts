import type { Job } from "../types";

const BUCKET_CACHE = new Map<string, Promise<Record<string, string>>>();

export function jobDescriptionBucket(jobUrl: string): string {
  let hash = 0;
  for (let index = 0; index < jobUrl.length; index += 1) {
    hash = ((hash * 31) + jobUrl.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

async function loadBucket(bucket: string): Promise<Record<string, string>> {
  if (!BUCKET_CACHE.has(bucket)) {
    BUCKET_CACHE.set(bucket, fetch(`/api/job-description-bucket?bucket=${encodeURIComponent(bucket)}`).then(async (response) => {
      if (!response.ok) return {};
      const data = await response.json();
      return data && typeof data === "object" ? data as Record<string, string> : {};
    }).catch(() => ({})));
  }
  return BUCKET_CACHE.get(bucket)!;
}

export async function loadJobDescriptions(jobs: Job[]): Promise<Record<string, string>> {
  const urls = [...new Set(jobs.map((job) => job.job_url).filter(Boolean))];
  const buckets = [...new Set(urls.map(jobDescriptionBucket))];
  const bucketRows = await Promise.all(buckets.map(async (bucket) => [bucket, await loadBucket(bucket)] as const));
  const bucketData = new Map(bucketRows);
  const descriptions: Record<string, string> = {};

  for (const url of urls) {
    const bucket = jobDescriptionBucket(url);
    const data = bucketData.get(bucket);
    const description = data?.[url];
    if (typeof description === "string" && description.trim()) {
      descriptions[url] = description;
    }
  }

  return descriptions;
}
