# ATS Job Match: Phase 2 review

**Snapshot:** 2026-10-01. Phase 2 is a command line tool only. It reads the resume PDF through the Phase 1 parser and reads the job description from `jd.txt` in a saved run or from `--jd`. It does not write to tailoring runs, change bullet selection, update the app, or submit applications.

## What the report means

Readiness and Job Match appear side by side and remain separate. Readiness asks whether a parser can recover the PDF. Job Match compares recovered resume evidence with requirements in the JD. Neither is an employer's ATS score. The number is our own deterministic estimate with a version, config hash, and fixed as-of date. A job description line the parser cannot classify appears under **Unparsed requirements** and makes coverage **INCOMPLETE**. Review those lines before relying on the number.

Job Match uses the approved 100 point allocation: required skills 30; experience alignment 25; role alignment 10; preferred skills 10; seniority 10; education/certifications 5; achievement evidence 5; domain terminology 5. An absent skill category redistributes its weight to active categories. No stated seniority or education requirement earns that category's points with the reason shown. A warning or critical Readiness finding is never averaged into Job Match.

Each scored requirement records its source JD line, exact/equivalent/related/missing classification, resume section and bullet, evidence tier, earned points, and lost points. An “A/B/C” or Oxford “A, B, or C” requirement is one item. A technology unknown to the editable dictionary can still become a requirement when it is named in a skill phrase, such as “Experience with Databricks and Cassandra.” Missing skills do not disappear because the resume bank lacks them. Required and preferred counts include exact or equivalent mentions anywhere in the parsed resume; related concepts earn partial points but do not count as found. The item score distinguishes Skills-only mentions from use in a work bullet.

Evidence weights are configured: measured job bullet 1.0, job bullet 0.9, project bullet 0.75, Skills section only 0.5. Equivalent wording multiplies by 0.95; a related concept multiplies by 0.5. Each requirement earns points from its best evidence; up to three distinct bullets are shown as support, and repetition adds no points. Suspicious repetition is reported. Its optional point penalty is configured but off by default. All amounts use integer tenths internally, and each item, category, and total is checked to add up exactly.

Recommendations sort by points potentially recoverable. Where the bank already has relevant evidence, the report names a bank ID for manual review. It never invents a claim. Authorization, location, and export control references are listed as **potential knockouts** for manual review, never as an automatic rejection. Candidate authorization and location are unknown when no explicit candidate settings are supplied.

## Ten saved runs reviewed

All rows read their saved PDF and saved JD. These PDFs still use the old template, so their Readiness remains `WARN 77`; Phase 1's rebuilt template improvements are in PR #20 and are not live. The examples cover a Full Stack role, a broad graduate program, Data Science, security analytics, an internship, backend, fraud, AI agents, payments, and photonics. Every example has unparsed qualifications and therefore needs manual review.

| Saved run | Job Match | Required found | Preferred found | Unparsed lines | Important reading |
| --- | ---: | ---: | ---: | ---: | --- |
| 1Password, Full Stack/iOS | 54.2 | 1/1 | 1/2 | 6 | Go/Rust/TypeScript is one required item; TypeScript appears in Skills only; Swift is absent |
| FDM Group, AI Engineer program | 49.0 | 0/0 | 0/0 | 5 | Broad posting has no parsed technical must-have or mapped responsibilities; manual review needed |
| Amazon, Data Scientist II | 43.1 | 3/3 | 2/3 | 4 | Required terms appear, while responsibility and other evidence are weaker |
| 9th Way Insignia, Data Analyst | 50.8 | 1/1 | 0/0 | 3 | SQL appears, but its evidence tier and the other gaps remain visible |
| Baidu USA, FDE Intern | 63.7 | 4/4 | 3/3 | 7 | Any-of languages grouped; location needs manual review |
| Brivo, Backend Engineer | 77.2 | 2/2 | 1/1 | 3 | Required Python/API and preferred PostgreSQL found; on-site location flagged |
| Abnormal, Software Engineer II | 52.3 | 0/0 | 2/3 | 9 | General must-haves remain unparsed; preferred Go/Python/ML scored |
| Benchling, Software Engineer Agents | 69.6 | 3/3 | 0/0 | 4 | Four unparsed qualification lines lower the experience category |
| Coinbase, Payments Backend | 71.7 | 2/3 | 0/0 | 2 | Go/Python/Java are one alternative requirement |
| Lightmatter, Photonics Intern | 31.5 | 1/3 | 0/1 | 7 | Photonics and silicon gaps; export control flagged for manual review |

For 1Password, the required “Go/Rust/TypeScript” item earns **15/30**: TypeScript is printed in the Skills section, so its evidence tier is 0.5. The report identifies the source JD line and the Skills entry, shows Swift as missing from the preferred list, and prints six qualification lines for manual review. Readiness remains `WARN 77` on its saved PDF; Job Match is **54.2/100** and is explicitly marked incomplete.

The low and high scores are findings, not targets. FDM has no mapped experience requirements, so it gets no assumed experience points. Unparsed work qualifications also receive zero credit within experience alignment. A JD without recognizable requirements or responsibilities is marked unscorable rather than given a numerical Job Match. The report prints every unparsed line instead of treating it as satisfied.

## Full saved-run audit

On the October 1 snapshot, the CLI checked **1,627** saved run folders: **1,443 scored**, **184 unscorable** because the JD had no recognizable requirements or responsibilities, and **zero processing errors**. Among scored runs, the minimum was **19.4**, p25 **45.5**, median **55.0**, p75 **65.0**, and maximum **99.1**. The snapshot used as-of `2026-10-01` and config hash `1dcc2723c6b59de0`. The live pipeline was creating new folders during these audits, so earlier audit attempts had different folder counts.

High scores can arise from broad postings with no explicit skill list. The report marks these as **incomplete JD coverage** and shows `Required 0/0`; they are not evidence that a particular employer would accept the resume. The unscorable group has no Job Match number, while Readiness remains available.

## Reproduce

```sh
npm run test:ats
npm run ats:match -- '/path/to/saved-run' --as-of 2026-10-01
npm run ats:match -- '/path/to/resume.pdf' --jd '/path/to/job.txt' --title 'Job title' --json > /tmp/match.json
npm run ats:match -- --baseline --as-of 2026-10-01
npm run ats:diff -- /tmp/before.json /tmp/after.json
```

The score configuration and dictionaries are in `data/ats/{scoring,skills,responsibilities,domains}.yaml`. New code is in `scripts/ats/{jd-parse,evidence,match,score,match-cli,diff-cli}.mjs`. The test suite covers classification, section exclusions, any-of choices, unknown technologies, evidence tiers, repetition, equivalent/related matches, date handling, deterministic config hashing, accounting, and the existing Phase 1 PDF checks.

## Scope and remaining limits

- General qualifications written as prose can remain unparsed. The CLI labels coverage incomplete and prints each line. Unparsed work qualifications receive no assumed experience credit; other statements need manual review.
- Specialized licenses and credentials that do not use recognizable degree or certification wording may remain unparsed and need manual review.
- The technology, responsibility, and domain dictionaries are editable but finite. Named unknown technologies are captured only in explicit skill phrases to avoid scoring ordinary capitalized prose.
- Years are derived from non-overlapping parsed position dates. The JD parser uses the largest numeric years requirement; a line such as “5 years of SQL” may describe skill depth rather than total career tenure and needs manual review.
- Saved PDFs retain Phase 1 template warnings until Phase 1 is merged and new resumes are generated.
- Writing `ats-score.json`, rescoring saved runs, and exposing scores through the sidecar belong to Phase 3. Dashboard display belongs to Phase 4.
