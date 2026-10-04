// Pure Phase 2 orchestration. Phase 3 can call this after extracting a saved resume PDF.
import { parseJobDescription } from "./jd-parse.mjs";
import { scoreJobMatch } from "./match.mjs";

export function scoreAts(readiness, jdText, config, { asOf = new Date().toISOString().slice(0, 10), bank = [], title = null } = {}) {
  if (!String(jdText || "").trim()) return { readiness, job_match: null, note: "No JD supplied; Readiness only" };
  const jd = parseJobDescription(jdText, config);
  if (title) jd.title = title;
  if (!jd.required.length && !jd.preferred.length && !jd.responsibilities.length && !jd.unparsed.length && !jd.degree && !jd.years) {
    return { readiness, jd, job_match: null, note: "JD requirements were not recognized; Job Match needs manual review" };
  }
  return { readiness, jd, job_match: scoreJobMatch(readiness.parsed, jd, config, { asOf, bank }) };
}
