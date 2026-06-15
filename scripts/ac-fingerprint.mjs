// Compile fingerprint — deterministic identity for cache + artifact dirs.
// SHA256(jd_hash + bank + planner + pipeline + optimizer + renderer + template)

import crypto from "node:crypto";
import { PIPELINE_VERSION } from "./ac-pipeline.mjs";

export const OPTIMIZER_ID = "global-hill-climb-v1";
export const RENDERER_ID = "tectonic";
export const DEFAULT_TEMPLATE_ID = "ac-latex-v51";

/** 12-char JD hash — matches ac-snapshot.mjs */
export function hashJd(jd) {
  return crypto.createHash("sha256").update(String(jd || "")).digest("hex").slice(0, 12);
}

export function computeFingerprint({
  jd,
  bankVersion,
  planner = "v2",
  pipelineVersion = PIPELINE_VERSION,
  optimizerId = OPTIMIZER_ID,
  rendererId = RENDERER_ID,
  templateId = process.env.TAILOR_TEMPLATE_ID?.trim() || DEFAULT_TEMPLATE_ID,
}) {
  const jdHash = hashJd(jd);
  const payload = [
    jdHash,
    String(bankVersion ?? ""),
    planner,
    pipelineVersion,
    optimizerId,
    rendererId,
    templateId,
  ].join("|");
  const fingerprint = crypto.createHash("sha256").update(payload).digest("hex");
  return {
    fingerprint,
    jd_hash: jdHash,
    bank_version: bankVersion ?? null,
    planner,
    pipeline_version: pipelineVersion,
    optimizer_id: optimizerId,
    renderer_id: rendererId,
    template_id: templateId,
  };
}

export function fingerprintInputsFromJob(job, { planner, bankVersion, pipelineVersion } = {}) {
  return computeFingerprint({
    jd: job.jd || "",
    bankVersion,
    planner: planner || job.planner || "v2",
    pipelineVersion,
  });
}
