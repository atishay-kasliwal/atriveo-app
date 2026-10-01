import { getJson } from "./engine";

// One application's full record (GET /applications/detail): the resume used, every question
// with its answer, the timeline, and the tailoring run's scores.

export interface Detail {
  ok: boolean; error?: string;
  id: string; company: string; title: string; ats: string | null; status: string; url: string;
  resume: { fileName: string | null; path: string | null; sha256: string | null; bytes: number | null; verifiedAt: string | null; sourceJobUrl: string | null };
  questions: Array<{
    label: string; step: number; required: boolean; type: string; resolution: "answered" | "needs_review" | "skipped"; verified: boolean;
    sensitive: string | null; answer: string | null; answerKind: "value" | "declined" | "withheld" | "blank" | "none"; source: string; detail: string | null;
  }>;
  timeline: Array<{ at: string; from: string | null; to: string; actor: string; reason: string }>;
  attempts: Array<{ n: number; startedAt: string; endedAt: string | null; outcome: string | null }>;
  submission: { by: string | null; submittedAt: string | null; confirmation: string | null };
  failure: { code: string; message: string } | null;
  resumeReport?: ResumeReport | null;
}

export interface ResumeReport {
  pipeline: string | null; tailoredAt: string | null; thesis: string | null; headerTitle: string | null;
  ats: { before: number | null; after: number | null };
  confidence: number | null;
  human: {
    score: number | null; wouldInterview: boolean | null; diagnosis: string | null; because: string[]; concerns: string[];
    parts: { technical: number | null; impact: number | null; execution: number | null; uniqueness: number | null; overclaimRisk: number | null };
  } | null;
  coverage: {
    pct: number | null;
    covered: Array<{ term: string; where: string | null; how: string | null }>;
    gaps: Array<{ term: string; where: string | null; how: string | null; status: string }>;
    missingClaimable: string[]; unclaimable: string[];
  };
  keywords: Array<{ keyword: string; count: number; min: number | null; max: number | null; status: string }>;
  jdNote: string | null;
}

// Each load is a slow trip to Mongo, so a record seen once (at this version) is kept,
// and the Ready page can fetch the next one while you read the current one.
const cache = new Map<string, Promise<Detail>>();

export function loadDetail(id: string, version: string): Promise<Detail> {
  const key = `${id}@${version}`;
  let p = cache.get(key);
  if (!p) {
    p = getJson<Detail>(`/applications/detail?id=${encodeURIComponent(id)}`);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
