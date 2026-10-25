# Agents working in atriveo-app

## Production is main
Only `main` is production. Every change goes branch → PR → merge into `main`; nothing is deployed from a branch or a worktree with
local changes, and nothing is pushed straight to `main` (except the job-data bot). Deploy with `npm run ship` / `npm run deploy:apply`
from a clean checkout of `origin/main` (docs/SHIP.md); both refuse anything else.

See CLAUDE.md for the resume-engine rules.
