---
name: open-source-update
description: Weekly update of Atishay's open source resume bullets. Use when he asks to update, check or audit open source, add newly merged pull requests to the resume, or points at this skill. Audits GitHub against the bank, drafts 9+ bullets for his approval, and opens one PR. Never merges or deploys on its own.
---

# Open source update

Read `docs/open-source-rules.md` first. It is the authority; this is the procedure.

## 1. Start clean
- Work in a fresh branch from `origin/main` (`git fetch && git checkout -b claude/oss-update-<date> origin/main`), never in
  a worktree another session is using.
- Check what production runs: `npm run ship -- --dry-run` from `~/atriveo-app-deploy`, and look at `live now:`. If it isn't
  `origin/main`, say so before anything else.

## 2. What he did on the page
He may have approved bullets or skipped pull requests on /open-source this week. Bring them into git first:
- `npm run bank:export -- --dry-run`, then `npm run bank:export`: approved bullets become `AC-U<n>.yaml`, and their story
  package and tier A go into `scripts/planner/v2.json` and `TIERS.yaml`. Re-rank `display_order`, update the open source
  test counts, and check the PR's diff. After it merges, `npm run bank:export -- --prune` clears the overlay copies.
- `npm run oss:export`: his skips and their reasons go into `OSS_DECISIONS.yaml`.
These are his approvals already: don't reword them. If one breaks a rule, tell him instead of fixing it silently.

## 3. Audit
`npm run oss:audit -- --out /tmp/oss-audit.md`. It reads GitHub (`gh auth token`) and the bank, and changes nothing. It
lists, in order:
1. **Fix in the bank:** closed PRs cited, status drift, missing approval dates, scores under 9, rule breaks, star claims above
   the real count.
2. **Retired bullets that can come back** (their PR merged since).
3. **Merged PRs with no bullet and no decision.**
4. **Earlier decisions whose PR changed status.**
5. **Open PRs with no bullet.**

## 4. Check each candidate against its PR
For every PR you may write about, read its description, diff and comments (`gh pr view`, `gh pr diff`). Count test cases
as rule 4 says, check commit authors, and note the measured result if there is one. Write down the facts you'll use and
where each one came from.

## 5. Draft
- One bullet per PR, or per small set of PRs in the same project. Each must honestly score 9+ (rule 3); otherwise propose
  a `no-bullet` decision with the reason.
- Check every draft with the bank lint before showing it.
- If the new work belongs to a company project (rule 9), draft it as an alternate in that company's pool and say whether
  it should replace one of the 2 printed bullets. If a project now has enough depth for its own company project, propose the
  heading, skills and description line.
- Put each draft on the page too (`mine.text` on its pull request), so he can approve it there. Show Atishay a table: the bullet, its PRs, its score with the reason, its resumes (`fits`), the facts and where they
  came from. Show the proposed decisions and the fixes from section 1 the same way. **Stop and wait for his approval.**

## 6. After he approves
- Add the approved bullets (`AC-<next>.yaml`, the next free id after `ls data/ac-bank`) with `oss.approved: "<today>"`,
  `oss.status`, `oss.prs`, `fits`/`tracks`, score, and `display_order`. Re-rank every live bullet.
- Pair each new bullet in a story package (a company bullet with another bullet of the same company). Update `ac_ids`, PROJECTS.yaml `ac_id_ranges` and `bullets`, OPEN-SOURCE.yaml,
  BANK_VERSION.yaml (a new version with a one-line note), TIERS.yaml for merged ones, and the decisions file.
- Run everything in rule 7 and build the five masters to a scratch folder. Report any master that changes.
- Open one PR with a body that says what changed, why, and the test results against `main`. **Do not merge it**, unless
  he asked you to in this conversation. Never deploy without his go-ahead.

## 7. After he merges: the resumes already built (rule 8)
1. **Masters:** `node scripts/rebuild-stale-bullets.mjs --masters` names the stale ones. Rebuild those from a clean `main` into a
   scratch `TAILOR_OUT_ROOT` (link `data/resume-profile.json` into a worktree first). Check one page, ATS 100, the contact
   line, and a text diff showing only the intended change. Then install them with a backup. A master edited in the builder is
   his to review.
2. **Pasted resumes:** report the stale ones to him. Never rebuild them.
3. **Deploy:** only with his go-ahead (`cd ~/atriveo-app-deploy && git checkout --detach origin/main && npm run ship`).
4. **Job resumes:** after the deploy, run `node scripts/rebuild-stale-bullets.mjs` in the dashboard container on Oracle and show
   him the report. With his go-ahead, run it again with `--apply`. Applied jobs and builder edits are never rebuilt.

## 8. Afterwards
Tell him, in a short message: the PR link, which masters changed, what is live in production, the job resumes report, and
anything still waiting on him.
