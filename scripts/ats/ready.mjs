// Resume Ready: is the tailored resume safe to send? A status (Ready / Review / Needs Work), never a score, and
// nothing here feeds Fit. It checks the resume's own text and that it still shows the skills Fit says you have.
import { skillEvidence } from "./evidence.mjs";

export function resumeReady({ readiness, tailored, ledger, config, pages = null }) {
  const cfg = config.scoring.resume_ready;
  const reasons = [];
  let needsWork = false;
  let review = false;

  if (readiness?.status === "FAIL") { needsWork = true; reasons.push(...(readiness.critical || ["A parser cannot read this resume"])); }
  else if (readiness?.status === "WARN") { review = true; reasons.push(`A parser may misread parts of it (${readiness.parseability}/100)`); }
  if (pages != null && pages > cfg.max_pages) { needsWork = true; reasons.push(`${pages} pages; the limit is ${cfg.max_pages}`); }

  // Skills with evidence in the bank must still show on the resume that gets sent. Required ones decide the status; preferred
  // ones are listed too (they are what the posting would like), without changing it.
  const onResume = (s) => { const e = skillEvidence(s.alternatives, tailored, config); return e.kind === "exact" || e.kind === "equivalent"; };
  const have = ledger.skills.filter((s) => s.class === "required" && s.status === "matched");
  const leftOffSkills = have.filter((s) => !onResume(s));
  const leftOff = leftOffSkills.map((s) => s.label);
  const preferredLeftOff = ledger.skills.filter((s) => s.class === "preferred" && s.status === "matched" && !onResume(s));
  if (have.length && leftOff.length) {
    if (leftOff.length / have.length >= cfg.needs_work_left_off_share) needsWork = true; else review = true;
    reasons.push(`${leftOff.length} of ${have.length} required skills you have are not on this resume: ${leftOff.join(", ")}`);
  }
  // For each one: where in your bank it is proven, so you can add that bullet instead of guessing.
  const detail = (s) => ({ label: s.label, class: s.class, entry: s.evidence?.entry ?? null, text: s.evidence?.text ?? null, tier: s.evidence?.tier ?? null,
    as: /_tools$/.test(s.evidence?.tier ?? "") ? "tools" : s.evidence?.tier === "skills_only" ? "skills" : "bullet" });
  return {
    status: needsWork ? "Needs Work" : review ? "Review" : "Ready", reasons,
    checks: { readable: readiness?.status ?? null, pages, skills_on_resume: { present: have.length - leftOff.length, total: have.length, left_off: leftOff, left_off_detail: [...leftOffSkills, ...preferredLeftOff].map(detail) } },
  };
}
