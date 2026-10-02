// Reads the scoring artifacts a tailoring run leaves next to the resume PDF (optimizer.json,
// report.json / composition.json) and returns one compact summary for the Applications view:
// ATS score, the hiring-manager ("human") review, and what the resume covers from the JD.
// Read-only. Works with both pipelines: the AC composer writes all of it, the dynamic
// optimizer only writes ATS before/after, and older folders may have nothing.

import fs from "node:fs";
import path from "node:path";
import { readSavedAts } from "./ats/persist.mjs";

const readJson = (dir, name) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { return null; }
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Folder of the resume, only if it sits inside the tailored-resumes root. */
export function resumeDirFor(resumePath, outRoot) {
  if (!resumePath) return null;
  const dir = path.dirname(path.resolve(resumePath));
  const root = path.resolve(outRoot);
  return dir.startsWith(root + path.sep) && fs.existsSync(dir) ? dir : null;
}

export function readResumeReport(dir) {
  const optimizer = readJson(dir, "optimizer.json");
  const report = readJson(dir, "report.json") ?? readJson(dir, "composition.json");
  const meta = readJson(dir, "meta.json");
  const assessment = readSavedAts(dir);
  if (!optimizer && !report && !assessment) return null;

  const hm = report?.hiring_manager_test ?? optimizer?.hiring_manager_test ?? report?.composition?.quality?.hiring_manager_test ?? null;
  const coverage = report?.composition?.coverage ?? report?.coverage ?? null;
  const audit = coverage?.audit ?? {};
  const covered = [];
  const gaps = [];
  for (const [term, a] of Object.entries(audit)) {
    const row = { term, where: a?.location ?? null, how: a?.match_type ?? null };
    if (a?.status === "satisfied") covered.push(row);
    else gaps.push({ ...row, status: a?.status ?? "missing" });
  }
  const matrix = report?.ats_matrix ?? null;
  const pct = num(coverage?.weighted_coverage) != null ? Math.round(coverage.weighted_coverage * 100) : num(report?.oracle?.metrics?.coverage_pct);

  return {
    pipeline: meta?.pipeline ?? optimizer?.pipeline ?? null,
    tailoredAt: meta?.tailored_at ?? null,
    thesis: report?.thesis ?? optimizer?.thesis ?? null,
    headerTitle: report?.header_title ?? optimizer?.header_title ?? null,
    ats: {
      before: num(optimizer?.ats_before),
      after: num(optimizer?.ats_after) ?? num(matrix?.score),
    },
    atsReadiness: assessment?.readiness ? { status: assessment.readiness.status, score: assessment.readiness.parseability } : null,
    jobMatch: assessment?.job_match ? { score: assessment.job_match.score, coverage: assessment.job_match.coverage } : null,
    confidence: round1(num(report?.resume_confidence_score) ?? num(optimizer?.resume_confidence_score)),
    human: hm ? {
      score: num(hm.composite),                       // 0-10
      wouldInterview: typeof hm.would_interview === "boolean" ? hm.would_interview : null,
      diagnosis: hm.diagnosis ?? null,
      because: Array.isArray(hm.because) ? hm.because : [],
      concerns: Array.isArray(hm.concerns) ? hm.concerns : [],
      parts: {
        technical: num(hm.technical_confidence),
        impact: num(hm.business_impact),
        execution: num(hm.execution_confidence),
        uniqueness: num(hm.uniqueness),
        overclaimRisk: num(hm.risk_of_overclaiming),
      },
    } : null,
    coverage: {
      pct,
      covered,
      gaps,
      missingClaimable: Array.isArray(coverage?.missing_claimable) ? coverage.missing_claimable : [],
      unclaimable: Array.isArray(coverage?.unclaimable) ? coverage.unclaimable : [],
    },
    keywords: Array.isArray(matrix?.rows)
      ? matrix.rows.map((r) => ({ keyword: r.keyword, count: r.count ?? 0, min: r.min ?? null, max: r.max ?? null, status: r.status ?? "ok" }))
      : [],
    jdNote: report?.jd_gate?.user_message ?? report?.explain?.jd_gate?.message ?? null,
  };
}
