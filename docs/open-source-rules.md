# Open source on resumes: the rules

Atishay's pull requests to other people's projects become resume bullets. This file is the rulebook. Every session follows it,
whether Claude, ChatGPT/Codex or anyone else. The weekly procedure is `.claude/skills/open-source-update/SKILL.md`. Background:
the 2026-11-25 audit, where 10 of 29 bullets had drifted from their PRs and an unapproved set of 24 reached production.

## 1. Who decides
- **Only Atishay approves a bullet.** Agents draft; he approves the exact wording. The date goes in `oss.approved` and a test
  refuses any live open source bullet without one. Never write that date without his approval in the conversation.
- **He can approve on the open source page** (since 2026-11-27). Approve checks the bullet rules, needs a resume it fits
  and the bullet it prints with, and writes it to the bank overlay (Mongo `bank_overlay`, an `AC-U` id) with today's date.
  It prints from the next resume build. "Take it back" removes it until it is exported. Agents never call `oss-approve`.
  Skipping a pull request there, with a reason, is his decision "no bullet".
- **Never merge a bank change yourself unless he asked for that merge in this conversation.** Open the PR and stop.
- **Never deploy** (`npm run ship`, `npm run deploy:apply`) without his go-ahead for that deploy. Check what is live first
  (`npm run ship -- --dry-run` prints `live now:`), and say what it is.

## 2. What can become a bullet
- **His own work, from the PR itself:** its diff, description and review. Never the issue's numbers, a maintainer's
  measurement, or a reviewer's test. Check commit authors: when maintainers wrote part of it, claim only his commits and
  set `oss.shared: true`.
- **Open PRs count fully** (2026-11-26, Atishay: the work is done). An open PR scores and ranks like a merged one. It is
  never worded as shipped, released, adopted or used by.
- **A PR closed without merging is never used.** Its bullet is retired.
- **Not a bullet:** docs only, CI or config only, tests only with no user-facing result, mechanical sweeps, renames and
  refactors with unchanged output, drafts, very small projects (under about 100 stars) unless the result is striking, and another
  contributor's fix applied by him. Record each in `data/ac-bank/OSS_DECISIONS.yaml` with the reason, so it doesn't come back.

## 3. The 9+ bar
Every live open source bullet scores at least 9 on the bank rubric: impact 3, specificity 2, credibility 2, clarity 2,
relevance 1. Score honestly and never round up:
- **Impact 3** needs a result: before and after numbers, a failure that no longer happens, or a measured effect.
  An activity ("added a flag") is 1.
- **Credibility:** his own work = 2, open or merged. Shared with a maintainer = 1.
- **Clarity 2:** 35 words at most, at most 2 commas (a comma inside a number counts) and 2 "and"s, readable by a recruiter.
- A bullet that can't reach 9 from real facts is **retired** (`tracks: [retired]` plus a `# Retired <date>: <why>` line), not
  scored up. It can come back when he gives a real number, or a later PR in the same project makes it bigger.
- `strength.recruiter` and the wording's `strength` hold the score; `display_order` ranks the live bullets, best first.

## 4. Counting
- **Tests:** leaf cases, as `go test -v` or pytest would list them. Never count a table's wrapper function as well as its
  rows, and never count assertion helpers such as Playwright `name:` fields. When unsure, take the lower count.
- **Stars:** GitHub's count on the day, rounded down: "15K+", "3.6K+", "190+". The audit flags a claim that rises above it.
- **Numbers from his own runs only.** A number the PR doesn't contain is not used.

## 5. Wording
- Harvard action verb first (`data/ac-bank/HARVARD_ACTION_VERBS.json`). Within one story package two bullets never share an
  opening verb, and an open source verb never repeats an employer or project verb on the same resume (`npm run ac:bullet-lint`).
- No semicolons and no hyphenated words, except product names (cloud-init, PR-Agent, yt-dlp).
- Name the project, and the company when it owns the repository (NVIDIA for dsx-ai-factory, Red Hat for redhat-developer).
  Never imply employment: the heading always says "(Open Source)".
- `signature_technologies` must appear in the text; `ats_keywords` are real terms from the work.
- **Every bullet is quantified:** a test count alone is the floor; a before and after number, a size or a time is better.
- **No PR counts.** "Merged 18 PRs" is logistics. Say what the project is and what he built or fixed in it.
- A bullet in a company project (section 9) may leave out the company name, since the heading carries it.

## 6. Where a bullet can print
- `fits:` names the resumes it suits; `tracks:` limits it to them. Data analytics never prints open source
  (TRACKS.yaml `no_jd_selected`).
- Every live bullet sits in a story package of two in `scripts/planner/v2.json` (`canonical_pools.open-source`), with a
  different opening verb from its partner. Pair work from the same company or project, else a shared technology. A test
  fails if a live bullet is in no package or `ac_ids` differs from the live set.
- Masters print what TRACKS.yaml `general_pinned` names. Changing a master is his decision. Since 2026-11-26: NVIDIA on
  Software Engineer and Forward Deployed, Mezmo on AI Engineer, SciPy + statsmodels + neuralforecast singles on Data
  Science, none on Data Analytics.
- New skills come only from merged or open PR evidence in `SKILL_EVIDENCE.yaml`, never from a draft, then
  `npm run skills:sync`.

## 7. Shipping a change
1. A branch from `origin/main`, one PR. Run `npm run ac:bullet-lint`, `npm run skills:check`, `npm run test:oss` and the
   wider review tests, and compare their failures with `main`.
2. Build the five masters into a scratch folder first (`TAILOR_OUT_ROOT=<tmp>`; a worktree needs a link to
   `data/resume-profile.json` or the contact line is missing) and diff their text against the live ones.
3. Deploy only when he says so (rule 1). Until it is deployed, Oracle keeps building job resumes with the old bank.

## 8. Resumes already built
A bank change doesn't touch resumes that were already built. Each resume's `composition.json` keeps the ids and wording it
printed, and `scripts/rebuild-stale-bullets.mjs` compares them with the bank: a bullet that was retired, removed or reworded
since makes the resume stale.
- **Masters** (the five general resumes): after the merge, `node scripts/rebuild-stale-bullets.mjs --masters` names the stale
  ones. Rebuild only those, from a clean `main`, into a scratch `TAILOR_OUT_ROOT`. Check one page, ATS readiness 100, the
  contact line, and a text diff against the live one showing only the intended change. Then install it (the PDF,
  `composition.json` and `resume.tex`, and `builtAt` in the manifest), keeping a backup of the old one. A master he edited in
  the builder (`builder.json`) is his: show him the change instead.
- **Pasted resumes** (Resumes, built from a posting he pasted) are listed by the same `--masters` run. Never rebuild them; tell
  him which ones carry an old bullet.
- **Job resumes** (Today, Matching, Staffing): after the deploy, run the report on Oracle, where the files are:
  `node scripts/rebuild-stale-bullets.mjs` in the dashboard container. It covers the last 7 days, since older unapplied jobs
  are removed. With his go-ahead, `--apply` re-queues the stale ones below fresh jobs. A job he **applied** to is never
  rebuilt: that resume may be the one he sent, so it is only listed. A resume he edited in the builder is listed too, not
  rebuilt.
- A bank change that alters how bullets are chosen (not just one bullet's wording) bumps `PIPELINE_VERSION` in
  `scripts/ac-pipeline.mjs`, so cached builds are not reused.

## 9. Company projects
Where he has real depth in one company's open source (2026-11-26: NVIDIA, Mezmo, Red Hat, Numaflow), the open source slot
prints it as a project, not as loose bullets:

```
NVIDIA (Open Source) | Go, Kubernetes, Cobra
NVIDIA's GPU Kubernetes stack across 5 repositories, from node image builds to bare metal clusters, in Go.
 • Added 5 Go CLI commands to NVKR, the build system behind NVIDIA's GPU Kubernetes node images, ...
 • Repaired 2 upgrade and drain bugs in NVIDIA's nodewright node operator for Kubernetes so ...
```

- **Where it lives:** `data/ac-bank/OPEN-SOURCE.yaml` `company_projects`: the heading, 2 to 4 skills, the description line,
  `match` (an `oss.org`, or `oss.project` for a project with no company) and the date he approved it.
- **The heading** is "Company (Open Source) | skills". It never implies employment.
- **The description line** says what the project is: its purpose, its stack and one scale number (stars, clouds,
  repositories). At most 20 words. No "Contributed to" (the heading already says it is his open source work), no PR or merge
  counts, no praise. It is a description, not a bullet, so it has no action verb.
- **The bullets** follow every rule above (verb first, quantified, 9+). The block prints exactly 2 of them, a story package
  whose two bullets both belong to the company; the other company bullets are alternates the posting can pick.
- **It prints only when both bullets belong to one company.** Bullets from different projects keep the heading built from
  the bullets ("Kiali, Numaflow (Open Source)").
- **Projects with less depth** (SciPy, statsmodels, neuralforecast and the rest) stay single bullets until there is enough
  work for a project. A new company project needs at least 2 live 9+ bullets and his approval of the heading and line.
- Tests (`npm run test:oss`) check the line, the 2 bullets and the master pins.
