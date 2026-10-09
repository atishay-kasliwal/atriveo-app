# AI Match / Resume Optimizer implementation report

Deployed with the user's authorized Mac subscription worker. Analysis and queue records are stored in production; optimized resumes are never silently saved. Save remains the user's final approval.

## Files changed

- scripts/resume-ai-provider.mjs: authenticated Claude Code/Codex subscription adapters, restricted CLI execution and provider selection.
- scripts/resume-ai.mjs: structured model calls, optimization analysis, semantic verification, weighted scoring, persistence and JD-version checks.
- scripts/resume-ai-content.mjs: evidence catalog, schema validation and grounded proposal checks.
- scripts/tailor-server.mjs: ai-match, ai-decision and ai-version under the existing authenticated resume-builder API.
- src/shared/resumeContent.mjs and resumeContent.d.mts: shared, typed content-only application boundary.
- src/apply/ResumeBuilderPage.tsx: AI Match, Review Changes, Optimize Resume, Apply/Apply All, Keep/Edit, stale handling and existing Undo/preview integration.
- src/apply/resume-builder.css: optimizer panel UI only.
- tests/resume-ai/match.test.mjs, content.test.mjs, provider.test.mjs and editor.test.mjs: validation, real composition fixture replay and desktop/mobile editor tests.

The renderer, LaTeX templates, layout configuration and ResumeLivePreview implementation are unchanged.

## Architecture and exact AI inputs

The existing stored job description is resolved server-side from descriptions.description for a job, or builder_resumes.jd for a pasted resume. The full stored JD is used. The current React sections and skills, including unsaved edits, are the resume input. Approved bank variants for the existing experience/project roles supply additional candidate evidence. Skills catalog names and bullet rules are instructions, not evidence of candidate proficiency.

The three primary data inputs are jd, resume and story_bank_or_profile. Current content is identified as current_resume:<role>:<bullet index>. Approved bank content is identified as story_bank:<AC id>:<variant index>. Current skills have current_resume:skills as their reference. Draft, rejected or explicitly ineligible bank records/variants are excluded.

## Content scope and grounding

AI proposes bullet lists only for existing Experience/Projects roles, plus Technical Skills groups. It may recover omitted approved achievements, replace weaker evidence, reorder/remove bullets and regroup/reorder supported skills. Existing bullet capacity and at least one bullet per existing role are preserved. Every proposed bullet uses one cited evidence record from the same employer/project; unrelated metrics cannot be combined. Every added skill cites supporting candidate text and must match a known skill or exact alias.

Applying patches clones the existing sections and replaces only bullets. It replaces only the skills string for a skill patch. Candidate/contact fields, role labels/titles/dates/locations, project names/roster, section order, stack overrides and rendering metadata cannot be propagated from AI output. Unknown model fields are rejected. HTML and LaTeX commands in generated bullet content are rejected.

## Validation and hallucination prevention

Model JSON is checked against a typed schema. Unknown references, cross-employer evidence, unsupported technologies, invented/modified numeric metrics, missing-requirement targets, repeated achievements and invalid bullet wording are rejected. Changed bullets use the existing bank/editor rules. An unchanged current bullet is retained without forcing an unrelated repair.

A second model call reviews proposed content against its cited evidence for unsupported responsibilities, causality, ownership, scale or qualitative outcomes. Only verified proposals are returned. These checks reduce hallucination risk; model-based semantic verification is not a factual guarantee, and user review remains necessary.

## Scoring

JD Match is an estimate, never an actual ATS score. Requirements receive model-assessed high/medium/low importance, weighted 3/2/1. STRONG earns 1, PARTIAL 0.5, MISSING 0. Overall scores are the weighted evidence-coverage percentage. Optimized coverage only changes for requirements addressed by validated proposals. Rejected proposals produce no score gain. Subscores are labeled qualitative AI estimates. Unsupported recognized technologies are forced to MISSING when absent from all candidate evidence.

## Apply, Apply All, Undo and Save

Review shows original/proposed content, rationale, JD requirements and source references. Apply updates one section/skills proposal. Apply All applies the complete reviewed content batch. No copy/paste is needed.

The existing snapshot history records a single pre-application snapshot. React sections/skills update, and the existing live preview rerenders. Undo restores the snapshot. The existing draft renderer and Save validations remain authoritative; neither analysis nor Apply calls Save or changes saved PDFs/the bank.

Analysis and decisions are stored in resume_ai_analysis and resume_ai_decisions with resume/JD hashes. They do not overwrite the saved resume.

## Stale analysis

The editor compares the analyzed snapshot to current sections/title/skills, disables stale Apply, and also checks again after awaiting decision calls to avoid overwriting intervening edits. JD versions are polled while the panel is open. The decision API independently rejects changed JD versions. A changed source invalidates pending analysis. Re-analysis follows accepted content.

## Tests and results

52 existing review tests pass. 25 optimizer tests pass, including desktop/mobile browser tests for Apply All, live preview, Undo, separate Save, immutable metadata, approved omitted evidence, unsupported Databricks, metric changes, cross-employer claims, stale content/JD, forbidden fields/markup and model failure.

Production frontend build passes. Tests use local fixture data, in-memory storage or mocked APIs. Automated model responses are simulated. Both signed-in subscription CLIs also passed a live structured-output connectivity test.

## Local example: approved omitted evidence

This example is a controlled fixture replay, not a live-model result.

- JD requirement: MLflow model operations.
- Original resume bullet: “Constructed an event-driven FastAPI pipeline on AWS over 7 years of FOMC data, cutting analysis from 3 days to under 20 minutes and reaching approximately 68% directional accuracy across 13 sessions.” The selected section omits AC-199.
- Approved evidence: AC-199's FinBERT work on AWS Bedrock A100 GPUs using MLflow, scoring 110+ Fed events yearly since 2019.
- Accepted proposed bullet: “Managed FinBERT sentiment models on AWS Bedrock A100 GPUs with MLflow, scoring 110+ Fed events yearly since 2019 as each press conference goes live.”
- Reason: replace weaker selected evidence with the directly relevant approved achievement and surface MLflow in supported skills.

## Rejected example

- JD requirement: Databricks.
- Evidence: absent from the current fixture and cited approved candidate evidence.
- A proposed Databricks bullet and Databricks skill are both rejected. Neither appears in optimized content. The requirement remains MISSING.

## Remaining limitations

The optimizer now uses signed-in Claude Code and Codex CLIs instead of Ollama. The UI offers Claude, Codex, or Claude writes / Codex checks. Claude is the default; RESUME_AI_PROVIDER can configure the backend default. API-key billing variables are omitted from subprocess environments, and OAuth tokens are never extracted. Both subscription connections were verified. Execution requires the signed-in CLIs on the machine hosting the local dashboard; credentials have not been moved to Oracle. Usage is subject to subscription allowances, and requests have a 180-second deadline.

Project roster selection is intentionally disabled because project names and section ordering are locked. Existing project content is optimized in place. This implementation uses approved bank evidence for current roles; it does not pull unrelated employers or infer proficiency from the skills dictionary.

Manual Edit opens the existing editor rather than saving an AI proposal automatically. AI changes remain subject to the existing one-page/PDF Save checks; no typography or spacing is altered to make content fit.

## Live subscription verification

Claude Code and Codex each returned valid structured JSON using the already signed-in subscription accounts. A full local optimizer run then used Claude for optimization and Codex for evidence verification, with the existing resume/JD fixture and in-memory persistence. It returned two validated changes and rejected four proposals. Estimated JD Match stayed 56 → 56; no score increase was manufactured. The local result is stored at /private/tmp/resume-ai-subscription-example.json. Nothing was saved to the resume or production.

## Production deployment: Mac subscription worker

Deployed at the user's explicit request after the local-only review. The user selected the Mac worker option. The website/dashboard runs on Oracle; subscription inference executes on the user's Mac through its existing Claude Code/Codex logins. No subscription credentials were moved to Oracle.

Authenticated background-job endpoints prevent long model calls from holding a Cloudflare request open. The Mac polls for inference work across a localhost-only SSH tunnel, sends structured results back, and the Oracle backend performs all evidence/content validation. Worker heartbeat and offline errors explain when the Mac is unavailable. Temporary job/request records have TTL indexes.

The Mac worker and SSH relay are user LaunchAgents: com.atriveo.resume-ai-worker and com.atriveo.resume-ai-tunnel. They start at user login and restart after failures. Runtime scripts live in ~/.playatriveo/resume-ai-worker; relay configuration is stored in a mode-0600 file. Phones can use the live website while the Mac remains awake and connected. Normal laptop sleep or shutdown stops inference; the dashboard and existing resumes remain available.

## Floating resume help

The editor now has a fixed AI Help button on desktop and mobile, above the mobile Save bar. Improve resume works with general resumes as well as job-tailored resumes; an optional instruction steers evidence-based rewriting. Without a JD, the panel labels the result as resume improvements rather than a job-match score. Ask a question uses the current draft and approved evidence, returns advisory text, validates cited evidence IDs, and does not change or save resume content. Both paths reuse the subscription worker and background-job polling. General-resume decision checks use a null JD version rather than querying an undefined job URL.

Validation: 28 optimizer/provider/editor tests pass, including a mobile general-resume question flow without decision or Save calls. Backend image: atriveo-dashboard:resume-ai-help-v2.

## Dashboard AI usage

The header displays Codex allowance remaining; its panel includes provider windows and reset times from the official Codex app-server account/rateLimits/read method. The Mac refreshes this read every minute and after inference; the browser refreshes every 30 seconds. Stale/offline values are identified. No OAuth secrets leave the CLI. Claude allowance is not exposed by this connection, so its panel links to claude.ai/settings/usage.

AI Help passes a per-tab session ID. The worker extracts measured token counts from Claude result usage and Codex turn.completed JSON events, separately from structured resume content. Completion records are idempotently upserted by inference ID and expire after 30 days. Claude cache input is included in input totals; Codex cached input is already part of input and is not added again. Session tokens cover measured completed calls after tracking was added, not other apps/devices or the remaining subscription allowance. The panel does not display API dollar estimates for subscription calls.

## Review from job cards

Today and staffing cards now expose Review with AI. The action links to the existing resume editor with ai=review and the same job/application/pasted identity used for editing. After loading current resume content, the editor starts one AI analysis and opens the proposed changes. It does not apply or save them. Staffing jobs without resumes use the existing prepare operation first and then open the returned builder ID; daily cards marked resumeReady=false show the review action disabled until a resume exists. Existing Apply/Apply All, preview, Undo and Save behavior remains authoritative.

Checks include direct deep-link review, existing staffing resume navigation and missing staffing resume preparation before navigation, with no Save calls on entry.

## Request progress and refresh recovery

AI jobs accept a client UUID as requestId. Repeated submissions with the same ID return the existing job rather than starting inference again; unique inserts handle racing requests. Jobs report reading, queued, thinking, checking/verifying, ready or failed based on actual server/worker events. Status includes worker availability. The UI shows provider activity, an animated indicator, elapsed time and reconnection/offline states; it does not expose private model reasoning or fabricate percentage completion.

The browser stores the submitted request per resume for up to 24 hours and reconnects to its existing server job after refresh. Approved draft content and dismissed/applied IDs are retained locally. Stored content is restored only if the underlying saved resume still matches the original baseline; changed content/JDs continue to block stale application. Browser storage clearing or a different browser does not recover this local review. Server results expire after 24 hours.

Results open directly as current/suggested comparisons with per-change Apply and a top Apply All. Applying changes no longer generates another AI analysis. Save remains required for the final PDF. Request settings collapse during work and after suggestions are ready.

Validation: 39 tests pass, including pending-review refresh, stable request IDs, real worker stages, one-click approval with no follow-up generation, approved draft recovery, and no automatic Save.

## Plain-language section review

The review now summarizes Experience, Technical Skills and Projects individually from validated proposals and rejected proposal records. It distinguishes changes ready, changes blocked, current wording kept and already reviewed. No returned changes is explicitly not a correctness guarantee. Blocked evidence-targeting, unsupported-skill and bullet-rule proposals have short explanations. Each suggestion identifies its section type. The overall summary counts clearly supported job requirements; estimated alignment and separate section ratings are folded into details and never presented as an ATS acceptance guarantee.

The inspected 42→48 Codex review had two validated project changes, three blocked Experience proposals (two missing-requirement targets and one conjunction-rule violation), and a blocked unsupported Technical Skills proposal. All three sections were proposed for; validation previously hid the blocked outcomes from the main UI.

New reviews explicitly consider all three sections and split compound requirements into atomic facts. Locked education is included as context for degree requirement assessment; it remains outside the editable content boundary. Existing reviews display the summary immediately but their original scores/requirements are not silently regenerated.

Validation: 43 tests pass, including project-only result explanations, unchanged section disclaimers, reviewed state and all-three-section dashboard presentation.

## Focused changes and saved PDF clarity

AI comparisons now omit exact unchanged bullets/groups, show removed/replaced wording and new wording, and distinguish pure reordering. The full original/proposed section remains expandable; Apply still uses the complete validated patch. The editor explicitly labels unsaved changes, draft checking, validation issues and saved PDFs. Save is enabled only for the compiled draft matching the current edit. Save & download saves that draft and downloads the returned saved PDF path; the mobile menu also offers the previous saved PDF explicitly.

Checks cover unchanged and duplicate bullet handling, reordering, current-draft readiness, returned PDF download path and standard filename. Thirteen targeted editor/diff checks pass.
