# Agents working in atriveo-app

## Production is main
Only `main` is production. Every change goes branch → PR → merge into `main`; nothing is deployed from a branch or a worktree with
local changes, and nothing is pushed straight to `main` (except the job-data bot). Deploy with `npm run ship` / `npm run deploy:apply`
from a clean checkout of `origin/main` (docs/SHIP.md); both refuse anything else.

See CLAUDE.md for the resume-engine rules.

## Open source resume bullets
Before changing anything about open source on resumes (data/ac-bank open-source entries, their story packages, SKILL_EVIDENCE.yaml,
OSS_DECISIONS.yaml), read `docs/open-source-rules.md` and follow `.claude/skills/open-source-update/SKILL.md`. In short: only
Atishay approves a bullet (`oss.approved`), every live one scores 9+, and you never merge or deploy without his go-ahead in the
conversation.
