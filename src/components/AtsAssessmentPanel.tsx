import type { AtsAssessment } from "../types/atsAssessment";

const name = (key: string) => key.replaceAll("_", " ");

export default function AtsAssessmentPanel({ assessment }: { assessment: AtsAssessment | null | undefined }) {
  if (!assessment) return <p className="ats-assessment-note">No saved ATS assessment for this resume yet.</p>;
  const { readiness, job_match: match } = assessment;
  return (
    <section className="ats-assessment" aria-label="ATS assessment">
      <p className="ats-assessment-note">Our parser check and deterministic job comparison. These are not scores from an employer’s ATS. As of {assessment.as_of}; config {assessment.config_hash}.</p>
      <div className="ats-assessment-summary">
        <div><strong>Readiness</strong><span>{readiness.status} · {readiness.parseability}/100</span><small>Can software recover this PDF?</small></div>
        <div><strong>Job Match</strong><span>{match ? `${match.score}/100` : "Manual review"}</span><small>How well does the extracted resume support this posting?</small></div>
      </div>
      {readiness.critical.length > 0 && <p className="ats-assessment-warning">Critical PDF issues: {readiness.critical.join("; ")}</p>}
      {readiness.findings.length > 0 && <details><summary>Readiness findings ({readiness.findings.length})</summary><ul>{readiness.findings.map((f, i) => <li key={i}>{f.severity}: {f.message}</li>)}</ul></details>}
      {!match ? <p className="ats-assessment-warning">{assessment.note || "Job description requirements need manual review before a match score is meaningful."}</p> : <>
        {match.coverage.status !== "complete" && <p className="ats-assessment-warning">Incomplete JD coverage: {match.coverage.unparsed_requirements} qualification lines need review{match.coverage.no_skill_requirements ? "; no explicit skill list was identified" : ""}{match.coverage.missing_job_title ? "; no job title was found" : ""}. Treat the number as provisional.</p>}
        <p className="ats-assessment-note">Required {match.requirement_counts.required.matched}/{match.requirement_counts.required.total} · Preferred {match.requirement_counts.preferred.matched}/{match.requirement_counts.preferred.total}</p>
        <div className="ats-assessment-categories">
          {match.categories.map((category) => <details key={category.key}>
            <summary><span>{name(category.key)}</span><strong>{category.earned}/{category.max}</strong></summary>
            {category.note && <p>{category.note}</p>}
            <ul>{category.items.map((item, i) => <li key={`${item.label}-${i}`}>
              <strong>{item.earned}/{item.max} · {item.label}</strong> {item.classification && <span>({item.classification})</span>}
              {item.source && <small>JD: {item.source}</small>}
              {item.evidence && <small>Resume{item.evidence_entry ? `, ${item.evidence_entry}` : ""}: {item.evidence}{item.evidence_tier ? ` · ${item.evidence_tier}` : ""}</small>}
              {item.warning && <small>{item.warning}</small>}
            </li>)}</ul>
          </details>)}
        </div>
        {match.unparsed_requirements.length > 0 && <details><summary>Qualifications to review ({match.unparsed_requirements.length})</summary><ul>{match.unparsed_requirements.map((r, i) => <li key={i}>{r.classification}: {r.source}</li>)}</ul></details>}
        {match.potential_knockouts.length > 0 && <details><summary>Eligibility and location checks ({match.potential_knockouts.length})</summary><ul>{match.potential_knockouts.map((r, i) => <li key={i}>{r.type}: {r.source}</li>)}</ul></details>}
        {match.recommendations.length > 0 && <details><summary>Evidence to consider ({match.recommendations.length})</summary><ul>{match.recommendations.map((r, i) => <li key={i}>{r.message} (+{r.recoverable_points} possible)</li>)}</ul></details>}
      </>}
    </section>
  );
}
