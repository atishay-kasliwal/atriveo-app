# Current resume rules

Updated October 4, 2026. This describes the deterministic AC resume path (`ac-tex.mjs`, `ac-skills.mjs`, `ac-role-meta.mjs`, and `skills-library.mjs`). Older PDFs and separate legacy generators can differ.

## Layout and header

- US Letter, 11-point article body; one-page output is checked by PDF regressions. The preview fits the actual PDF page; it does not convert it to A4.
- Centered name. One contact row contains title, phone, email, LinkedIn, GitHub, and location, centered at 9 points and scaled down only when needed to fit the page width. No personal portfolio link in the header.
- LinkedIn and GitHub display their URLs, rather than only labels.
- Current location behavior follows the job location when usable, otherwise the profile location. This existing behavior remains a factual-consistency concern from the audit; the formatting changes do not resolve it.
- Education: school on the left, dates on the right; degree on the left, location on the right. Both recorded degrees remain included.
- Experience: employer left, dates right; role title left, location right. No technology list appended to an experience title.

## Experience titles and ordering

- Wake Forest – CAIR: always **AI/ML Engineer**.
- Stony Brook University: uses the same normalized application title as the resume header.
- Other employers retain their existing role metadata titles.
- Application title normalization keeps short titles, maps longer titles to supported archetypes, then uses narrative/JD signals and profile fallback when needed. It does not blindly copy a long job title.
- Experience ordering uses role metadata order; dates come from the bank's role YAML when available, then metadata fallback.
- Empty experience/project sections are excluded. Project order follows project recency metadata.

## Projects and skills

- Project headings show technologies recognized in selected bullet text plus the existing project-specific stack defaults, deduplicated.
- The previous five-tool project-heading cutoff is removed. This does not add unknown technologies or guarantee every technology in the entire bank appears on each resume.
- Technical Skills uses supplied composition skills when available; otherwise it builds evidence-backed skills from selected experience/projects and the configured AC corpus.
- Skill categories are ranked for the JD, with a default maximum of five categories. Skills are ranked by relevance/evidence, deduplicated, and fitted to one physical line per category. Lower-ranked skills can still be omitted by that width limit.
- Exact content, bullet counts, and project selection come from the composition/selection pipeline, not this template. Existing evidence/provenance checks remain required; formatting approval does not certify an older factual claim.

## Files and safety

- New generation uses these rules. Existing selected PDFs are not silently replaced.
- Header-only bulk refresh was stopped after template concerns were raised. Its versioned copies are not substitutes for a full regeneration under these rules.
- Replacing an application's selected resume requires reconciling its file path/hash and revalidating attachment/final-form evidence. Prior certification cannot be reused for a different PDF.
- Resume generation does not approve answers or submit applications.
