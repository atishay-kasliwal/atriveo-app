# ATS assessment in the resume pipeline

The AC compiler scores each completed resume PDF and saves `ats-score.json` beside it. A cache hit is scored against the reused PDF too. This happens after PDF compilation and does not block a valid resume if scoring fails. The file contains separate PDF **Readiness** and **Job Match** results, parsed JD evidence, unparsed qualification lines, input hashes, configuration hash, scorer code hash, and an as-of date. It does not represent an employer's ATS score.

The Mac sidecar reads the saved result. `GET /list-tailored` includes compact `atsReadiness`, `jobMatch`, and `atsNote` fields for Compile history. `GET /resume-artifacts?dir=...` includes the full `atsAssessment`; the existing path guard limits reads to the tailored-resumes root. `GET /applications/detail` includes the compact scores under `resumeReport`. These routes never score PDFs during a request.

Compile history shows separate badges and an **ATS** panel. The panel exposes each category, the source JD line, resume evidence and its location, unparsed lines, and potential eligibility or location checks. When JD coverage is incomplete, the score is labeled provisional. Runs whose JD has no recognizable requirements have Readiness only and say **Manual review**.

## Backfill

```sh
npm run ats:backfill -- --dry-run
npm run ats:backfill -- --as-of 2026-10-01
```

The command visits older `date/run` and current `date/company/run` folders. It skips a run when the PDF, JD, configuration, scorer code, and as-of date match the saved assessment. Re-running it is safe. It reports scanned, written, current, unscorable, and error counts. `--root` and `--limit` can narrow a run. The score file is written atomically; source PDFs and JDs are untouched.

## Interpretation

- Readiness checks extraction and page structure. A saved PDF generated before the Phase 1 template change can still show WARN, even after the new code is deployed. Rebuilding that PDF is required to change the PDF itself.
- Job Match compares evidence in the parsed PDF with the saved JD. Missing requirements, qualification lines the parser could not classify, and broad descriptions remain visible for review.
- The existing Resume Confidence Score measures the composition pipeline. It remains separate from both ATS fields.
- No ATS number is used as an automatic application or rejection decision.

## Saved-run audit (October 1 as-of date)

The backfill wrote **1,784** assessments with **zero processing errors**. **1,759** received a Job Match score; **25** had no reliably classified JD requirements and retain Readiness only. Among the scored runs, **65** have complete JD coverage and **1,694** are explicitly marked incomplete. Of the latter, 1,624 have at least one unparsed qualification and 257 have no explicit skill requirements; these groups overlap. The scores range from 19.4 to 99.1, with a median of 53.5. All 1,784 saved PDFs show Readiness WARN because they predate the Phase 1 template fix. This is a snapshot; the live compiler continues to add runs.

The large incomplete group is a real limit of deterministic JD interpretation. Expanding heading recognition recovered most previously unscorable descriptions, but it did not turn prose qualifications into verified evidence. Review unparsed lines and the PDF before using a number for a decision.
