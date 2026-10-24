# Matching decision workspace

The page uses the existing React/Vite console and design tokens. The resume remains the same PDF/image: no generation, layout, typography or bullet changes. Main implementation: `src/apply/JobMatchingPage.tsx`, `src/apply/job-matching.css`, `scripts/job-matching.mjs`, `scripts/matching-workspace.mjs`, `scripts/job-matching-analysis.mjs`.

## Audit and data flow

Mongo `jobs` contains resume status, paths, company, location and persisted Fit. `descriptions` supplies the full posting. `applications` and `job_swipes` determine which jobs remain. The queue deduplicates URLs, computes bounded missing/stale Fit records through `fit-store.mjs`, ranks, then loads only eight full jobs/resume analyses. Company summaries use the same bounded 1,500-row candidate set, not per-company queries. Filters, a direct-job selector and compact exclusion keys support browsing without rendering the catalog.

Fit compares the whole candidate bank (`data/ac-bank`, master resume and candidate config) to the posting. `scripts/ats/fit.mjs`, `match.mjs`, `evidence.mjs` already distinguish direct, equivalent and related evidence, depth, confidence and knockouts. Its scores are unchanged. The independent saved ATS report describes the tailored PDF. UI labels explicitly separate **Bank fit** and **This resume**; unknown scores remain unavailable.

The previous queue omitted `fit` from its projection, repeatedly recalculating the same first forty jobs. It now reads saved Fit. Compact Fit retains partial evidence and original requirement text; shape 3 invalidates the previous stored shape without changing score weights.

## Evidence and trust

Strengths have categorical semantics: strong means an actual work/project bullet; moderate means a tool linked to work; weak means a skills-list mention; partial means related technology; missing means no bank evidence. They are not invented percentages. Your Edge groups requested skills by their actual evidence source; it does not assert rarity or candidate percentiles.

The PDF uses Poppler word boxes. Evidence overlays require an exact normalized sequence of stored evidence words on the first PDF page. Cropped stored excerpts use complete words only. Bank evidence with no exact link is labeled accordingly. Overlays change neither PDF bytes nor generation. Description highlights indicate bank evidence, with that distinction stated in the description view.

Similar roles are actual undecided, resume-ready jobs ordered by Jaccard overlap of recognized requirements and title terms. The existing `ac-embeddings.mjs` implements sparse keyword/capability vectors, not a dense embedding service or vector database. Its features largely duplicate these explicit relationships. Without a labeled retrieval evaluation set there is no demonstrated quality benefit from replacing deterministic retrieval; no external models or new dependency are introduced. Existing Mongo documents represent Job → Requirement → Evidence → Source relationships cleanly, so a graph database would add operational cost without a demonstrated benefit.

## Queue, behavior and controls

Arrows browse; N marks not apply; S saves. A focuses Apply, and Enter/click opens the external form. Nothing submits an application. Previous navigates viewed history, while Undo choice reverses the last persisted decision. Failed decisions stay visible and can be retried. Counts say **opened**, not **applied**, because opening a form is not a completed application.

`matching_events` records viewed, returned, company/similar navigation and decisions with server-derived company/track metadata. A TTL index retains 180 days; ranking uses at most the latest 1,000 events within 60 days. After five distinct decided jobs, optional preference ranking adjusts nearby ordering by at most two points, respecting saved/blocked ordering and never hiding jobs or changing displayed Fit. The checkbox disables preference ranking. Undo removes that job's decision events. Queries are cached for thirty seconds and invalidated by events.

## Verification and operations

Unit checks cover real company counts, related-job provenance, preference bounds/minimum history, and strict PDF evidence boxes. Browser checks cover desktop/phone overflow, evidence selection, full JD, tabs, filtering, related-job switching, arrow safety, A-to-focus, decisions and undo. Existing Fit/store tests preserve scoring invariants. Deployment uses `scripts/ship.sh --yes` and its existing drift checks and rollback state.

Known limits: no dense semantic retrieval benchmark, company enrichment or applicant percentile data exists. Some postings have low-confidence parsing; some bank proof is absent or worded differently in the PDF and therefore receives no exact overlay. The queue retains its existing 1,500 recent successful-resume candidate cap. Preference learning is deliberately small and uses explicit decisions rather than passive views to change ranking.
