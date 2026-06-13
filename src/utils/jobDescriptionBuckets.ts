import type { Job } from "../types";

// Cache buckets only briefly. A SESSION-LONG cache was the "No JD for all" bug:
// once a bucket was fetched (even empty, or before the hourly data deployed), it
// was never re-fetched, so the feed kept matching jobs against stale/empty
// buckets. A short TTL lets a later poll pick up freshly-published JDs, and an
// empty result is never cached at all (so it retries next time).
const BUCKET_TTL_MS = 5 * 60 * 1000;
interface CachedBucket { at: number; data: Record<string, string>; }
const BUCKET_CACHE = new Map<string, CachedBucket>();
const BUCKET_INFLIGHT = new Map<string, Promise<Record<string, string>>>();

export function jobDescriptionBucket(jobUrl: string): string {
  let hash = 0;
  for (let index = 0; index < jobUrl.length; index += 1) {
    hash = ((hash * 31) + jobUrl.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

async function loadBucket(bucket: string): Promise<Record<string, string>> {
  const cached = BUCKET_CACHE.get(bucket);
  if (cached && Date.now() - cached.at < BUCKET_TTL_MS && Object.keys(cached.data).length > 0) {
    return cached.data;
  }
  // de-dupe concurrent fetches of the same bucket
  const existing = BUCKET_INFLIGHT.get(bucket);
  if (existing) return existing;

  const promise = fetch(
    `/api/job-description-bucket?bucket=${encodeURIComponent(bucket)}&t=${Date.now()}`,
    { cache: "no-store" },
  ).then(async (response) => {
    if (!response.ok) return {};
    const data = await response.json();
    const result = data && typeof data === "object" ? data as Record<string, string> : {};
    // Only cache non-empty results so a transient empty never sticks.
    if (Object.keys(result).length > 0) BUCKET_CACHE.set(bucket, { at: Date.now(), data: result });
    return result;
  }).catch(() => ({})).finally(() => {
    BUCKET_INFLIGHT.delete(bucket);
  });

  BUCKET_INFLIGHT.set(bucket, promise);
  return promise;
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
