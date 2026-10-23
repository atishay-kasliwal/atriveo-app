#!/usr/bin/env bash
# Helpers for ship.sh, kept apart so they can be tested.

# known_version <path> <sha256>: does this file, with this hash, exist anywhere in git history (any branch)?
# A live file whose hash is some earlier version of the repo's own file is just older: the repo wins and it is replaced.
# A hash found nowhere in history means someone edited the file on the server: stop.
known_version() {
  local path="$1" hash="$2" c
  for c in $(git log --all --format=%H -- "$path"); do
    [ "$(git show "$c:$path" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)" = "$hash" ] && { echo "$c"; return 0; }
  done
  return 1
}

# The scoring bundle: always shipped whole, so the dashboard and the workers never score with different dictionaries or
# configs (a Fit saved by one would look stale to the other).
bundle_files() { git ls-files data/ats scripts/ats | grep -v -e '^scripts/ats/validate' ; }

# remote_hash_script <files...>: the shell snippet run inside the image to hash the files that exist there. A file that is new
# (not in the image yet) is skipped, and the snippet always exits 0: a missing last file must not look like a failure.
remote_hash_script() { printf 'cd /app && for f in %s; do [ -f "$f" ] && sha256sum "$f"; done; true' "$*"; }
