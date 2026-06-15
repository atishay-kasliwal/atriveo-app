#!/usr/bin/env node
/**
 * Engineering JD relevance gate — skip or flag compose on non-software JDs.
 */
const ENGINEERING_SIGNALS = [
  { re: /\b(software engineer|ai engineer|ml engineer|backend engineer|data engineer|full.?stack engineer)\b/i, w: 0.22 },
  { re: /\b(engineer|developer|programmer|architect)\b/i, w: 0.12 },
  { re: /\b(python|java|javascript|typescript|c\+\+|golang|rust|kotlin)\b/i, w: 0.1 },
  { re: /\b(api|microservice|distributed|kafka|kubernetes|aws|gcp|azure)\b/i, w: 0.08 },
  { re: /\b(machine learning|llm|rag|agent|nlp|deep learning)\b/i, w: 0.1 },
  { re: /\b(git|ci\/cd|docker|sql|database|pipeline)\b/i, w: 0.06 },
];

const NON_ENGINEERING_SIGNALS = [
  { re: /\b(registered nurse|rn\b|nursing|caregiver|clinical residency|patient care)\b/i, w: 0.35 },
  { re: /\b(licensed practical nurse|lpn\b|medical unit|hospital floor)\b/i, w: 0.25 },
  { re: /\b(phlebotom|dental hygien|physical therapist|occupational therapist)\b/i, w: 0.3 },
  { re: /\b(retail sales|cashier|barista|warehouse associate)\b/i, w: 0.2 },
];

export const SUPPORTED_THRESHOLD = 0.55;
export const BORDERLINE_THRESHOLD = 0.45;
const THRESHOLD = SUPPORTED_THRESHOLD;

export function engineeringConfidence(jd) {
  const text = String(jd || "").toLowerCase();
  let eng = 0;
  let nonEng = 0;
  const hits = { engineering: [], non_engineering: [] };

  for (const { re, w } of ENGINEERING_SIGNALS) {
    if (re.test(text)) {
      eng += w;
      hits.engineering.push(re.source.slice(0, 40));
    }
  }
  for (const { re, w } of NON_ENGINEERING_SIGNALS) {
    if (re.test(text)) {
      nonEng += w;
      hits.non_engineering.push(re.source.slice(0, 40));
    }
  }

  const raw = Math.max(0, Math.min(1, eng * 1.15 - nonEng + 0.12));
  return {
    confidence: Number(raw.toFixed(3)),
    supported: raw >= THRESHOLD,
    threshold: THRESHOLD,
    hits,
  };
}

export function assessJdRelevance(jd) {
  const result = engineeringConfidence(jd);
  const borderline = !result.supported && result.confidence >= BORDERLINE_THRESHOLD;
  const status = result.supported ? "supported" : borderline ? "borderline" : "unsupported";
  const message = result.supported
    ? "Engineering JD — compose allowed."
    : borderline
      ? `Borderline JD (confidence ${result.confidence}, ideal ≥ ${SUPPORTED_THRESHOLD}).`
      : `Unsupported JD (engineering confidence ${result.confidence} < ${BORDERLINE_THRESHOLD}). Human review recommended.`;
  return { ...result, status, borderline, message };
}

if (process.argv[1]?.endsWith("ac-jd-relevance.mjs")) {
  const jd = process.argv.slice(2).join(" ") || "";
  const r = assessJdRelevance(jd);
  console.log(JSON.stringify(r, null, 2));
}
