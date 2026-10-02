# ATS Readiness: Phase 1 review

**Snapshot:** 2026-10-01. **Config:** `79a8b8edb8e687f3`, Readiness v1.0.1.

This phase checks whether text and structure can be recovered from a resume PDF. It does not compare the resume with a job description and is not an employer's ATS score. Job Match, pipeline integration and dashboard changes belong to later phases.

## What changed

- `scripts/ats/extract.mjs` reads PDFs with Poppler in layout, normal reading and content-stream order. It also reads pages, fonts, images and link targets.
- `scripts/ats/resume-parse.mjs` recovers contact details, sections, positions, education, projects and skills from extracted text. Missing fields stay missing.
- `scripts/ats/readiness.mjs` reports findings with evidence and config-driven penalties. Critical findings produce `FAIL`; any warning produces `WARN`; `PASS` requires no critical or warning finding and a score at or above the configured threshold. Readiness and Job Match remain separate.
- The LaTeX template keeps each school's city and date with that school, puts only the job title on title lines, and prints the addresses of profile links. These are the three PDF extraction problems approved for repair. Resume bullets and skills are unchanged by the template edit.
- `ats:readiness` checks a PDF or run folder. `ats:compare` rebuilds saved runs with the new template and can save both PDFs and extracted views for inspection. Run-folder selection prefers the resume PDF and excludes cover letters.

## Before and after: 1Password example

The saved PDF and the rebuilt PDF each have **one page**. The parser found **3 of 3 positions, 2 of 2 schools and 2 of 2 projects** in both. The old PDF gave it the wrong reading order and cluttered job titles:

| Extracted field | Saved PDF | Rebuilt PDF |
| --- | --- | --- |
| Education reading order | Both school names and degrees, then both locations and dates | Each school followed immediately by its location, degree and dates |
| Stony Brook title | `Software Engineer \| FastAPI, Python, AWS, RAG, LangChain` | `Software Engineer` |
| Profile links | `Linkedin`, `Github`, `Portfolio` labels | `linkedin.com/in/atishay-kasliwal`, `github.com/atishay-kasliwal`, `atishaykasliwal.com` |

The rebuilt parser structure is:

| Section | Parsed entries |
| --- | --- |
| Experience | Stony Brook University — Software Engineer — Nov 2024 to May 2026; Wake Forest CAIR — Software Engineer — May to Aug 2025; Accolite Digital — Senior Software Engineer — Aug 2021 to Aug 2024 |
| Education | Stony Brook University — MS Data Science — Aug 2024 to May 2026; Symbiosis University — BTech Computer Science and IT — Aug 2018 to May 2022 |
| Projects | Atriveo — Sep 2025 to Present; Insurance Microservices Platform — Jun to Aug 2025 |
| Skills | Five labeled groups recovered |

The saved PDF's Readiness calculation was **100 − 8 education reading order − 9 title clutter − 6 hidden URLs = 77, WARN**. The rebuilt PDF has none of those findings: **100, PASS**.

## Seven representative saved runs

Each row compares a saved PDF with a new PDF built from that run's saved composition and contact header. All seven saved PDFs and rebuilt PDFs have one page. The rebuilt versions parse 3 positions, 2 schools and 2 projects.

| Run | Saved | Rebuilt |
| --- | ---: | ---: |
| 1Password, Full Stack/iOS | WARN 77 | PASS 100 |
| FDM Group, AI Engineer | WARN 77 | PASS 100 |
| Amazon, Data Scientist II | WARN 77 | PASS 100 |
| 9th Way Insignia, Cybersecurity Data Analyst | WARN 77 | PASS 100 |
| Baidu USA, Forward Deployed Engineer Intern | WARN 77 | PASS 100 |
| Brivo, Backend Engineer | WARN 77 | PASS 100 |
| Abnormal, Software Engineer II (fallback resume) | WARN 77 | PASS 100 |

For those seven, rebuilding the old template reproduced the saved PDF's extracted reading text exactly. The new template shifted body text down by 0.7–7.3 pt, with no horizontal movement; all seven remained one page.

## Corpus audit

The prior session rebuilt **1,454 saved runs with `report.json`** in a snapshot taken on October 1. Two run folders also contained cover letters; the first baseline pass selected those by filename. Their corrected resume-PDF baselines are both `WARN 77`. The counts below include that correction. Newer runs created after the snapshot are outside this audit.

| Measure | Saved PDFs | Rebuilt PDFs |
| --- | ---: | ---: |
| One page | 1,454 | 1,454 |
| PASS | 0 | 1,384 |
| WARN | 1,454 | 70 |
| FAIL | 0 | 0 |
| Median Parseability | 77 | 100 |
| Parsed 3/3 positions, 2/2 schools, 2/2 projects | 1,454 | 1,454 |

Every saved PDF had the education-order, title-line and hidden-link findings. The rebuilt PDFs have **none** of those three. The 70 remaining warnings are **69 missing or unrecognizable contact locations** (97/100) and **one location plus one ligature glyph** (93/100). Some source headers give a state alone or a placeholder such as “Office Location”; this phase does not invent a city to make the score pass. Under the final status rule, these remain `WARN` even though their numeric scores exceed 85.

The corpus harness rebuilt each PDF from the saved composition and skills, the current profile, and the location extracted from its saved TeX. The seven representative comparisons also reconstructed contact fields from each saved TeX, avoiding drift from later profile edits. Corpus statuses after the final warning-rule correction were recalculated from the stored PDF findings; the PDF extraction and numeric penalties did not change.

## Reproduce

```sh
npm run test:ats
npm run ats:readiness -- '/path/to/a/resume.pdf'
npm run ats:readiness -- '/path/to/a/tailoring-run' --views
npm run ats:readiness -- --baseline --root "$HOME/Documents/tailored-resumes"
npm run ats:compare -- '/path/to/a/tailoring-run' --out /tmp/ats-phase1-review
```

The test suite includes a compiled PDF regression for each template fix. It also checks that cover letters cannot be mistaken for resumes, that findings add up to the displayed score, and that warnings cannot be averaged into `PASS`.
