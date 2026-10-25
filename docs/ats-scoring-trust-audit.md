# ATS scoring trust audit — October 25, 2026

This audit uses saved local job descriptions and PDF files. Recalculation was read-only; these five historical reports and their PDFs were not overwritten. It does not verify the production deployment or hiring outcomes.

## Kong billing-platform example

The same saved posting with title `Software Engineer` changes from **89.5/high confidence** under the earlier local scorer to **74.7/medium confidence** under v1.1.0. Recognized skill requirements increase from 18 to 32. The updated parser reads the explicit three-year minimum. Remaining unresolved qualification lines are reported, not silently treated as matches. GitHub evidence comes from an actual project bullet rather than `facts/github.md`; software code-quality evidence comes from automated testing rather than clinical review.

The score change is the combined result of extraction, vocabulary, evidence validation and weighting changes. It should not be attributed to any one fix.

## Saved PDF assessments

These are PDF match scores, separate from the bank fit above. All five still have incomplete requirement coverage.

| Saved run | Old score | Recalculated | Required skills with evidence |
| --- | ---: | ---: | --- |
| TalentHop (14thOctober)-8 | 88.9 | 86.8 | 5/6 |
| SandCherry (14thOctober) | 49.1 | 49.1 | 5/8 |
| TalentHop (14thOctober)-6 | 87.5 | 83.6 | 2/3 |
| Deloitte (14thOctober)-4 | 84.2 | 78.4 | 19/23 |
| MoonwalkBiosciences (14thOctober) | 83.4 | 71.4 | 3/3 |

Lower scores are not the objective. The objective is a traceable assessment that distinguishes evidence, unsupported requirements and parsing uncertainty. Missing bank evidence does not establish that the applicant lacks the skill; it means the application needs verified supporting material before making that claim.

## Verification

Regression checks cover source-file/URL false matches, explicit negations, planned work, version-number inflation, clinical-versus-software review, direct versus related evidence depth, qualification headings, unresolved coverage, shared skill weights, and assessment invalidation when rules, files, titles or dates change. Persistence checks compile a real PDF and verify a stale report refreshes. Browser checks cover desktop/phone layout, the company rail, skill review, stale-score display and decisions without automatic submission.

Three pre-existing resume-template failures were reproduced against an isolated archive of unchanged HEAD: experience-stack formatting, expected warning status, and an adaptive versus fixed Stony Brook job title. The regression assertions now reflect the documented clean-title/SWE-track policy and compare decoded LaTeX content, while retaining real PDF extraction checks. No resume template or candidate experience title was changed. The portable compiler image now includes the shared contact formatter it already imports.

No labeled hiring-outcome calibration has been performed. These deterministic safeguards cannot fully resolve context, negation, domain specificity or every unseen posting format. Unresolved items require human review; the score does not predict employer screening or an interview.
