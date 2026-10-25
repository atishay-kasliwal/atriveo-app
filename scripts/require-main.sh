#!/usr/bin/env bash
# Production is main, always: only the commit at origin/main, with nothing changed locally, can be deployed.
# A change reaches production by a PR that is merged into main, then a deploy from a clean checkout of main.
# Sourced by ship.sh (real ships) and deploy-apply.sh. Nothing here changes the checkout.
require_main() {
  git fetch -q origin main || { echo "Can't reach GitHub to check origin/main; not deploying." >&2; exit 1; }
  local head main dirty
  head="$(git rev-parse HEAD)"; main="$(git rev-parse origin/main)"
  # Tracked files only: untracked scratch files don't ship. public/ is copied into the site, so it counts.
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ "$head" != "$main" ] || [ -n "$dirty" ]; then
    {
      echo "Production is main only: this checkout isn't exactly origin/main."
      [ "$head" != "$main" ] && echo "  here: $(git log -1 --format='%h %s' HEAD)" && echo "  main: $(git log -1 --format='%h %s' origin/main)"
      [ -n "$dirty" ] && echo "  changed files: $(printf '%s\n' "$dirty" | wc -l | tr -d ' ') (e.g. $(printf '%s\n' "$dirty" | head -1 | cut -c4-))"
      echo "Open a PR, merge it into main, then deploy from a clean checkout of main:"
      echo "  git worktree add --detach ~/atriveo-app-deploy origin/main   (once; later: git -C ~/atriveo-app-deploy checkout --detach origin/main)"
    } >&2
    exit 1
  fi
}
