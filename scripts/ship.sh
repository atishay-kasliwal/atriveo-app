#!/usr/bin/env bash
# One command from your Mac to put the current commit into production: no GitHub Actions, no manual paste.
#
#   npm run ship                 test, ship changed files, check the live image has not drifted, build the dashboard and worker
#                                overlays on Oracle, restart them, check they are Up, then deploy the website
#   npm run ship -- --dry-run    print the plan (files, expected hashes, commands) and touch nothing
#   npm run ship -- --rollback   put the previous dashboard and workers back
#   npm run ship -- --init       once: record what is live now (see INIT_* below)
#   Options: --skip-tests  --skip-website  --backfill  --yes (do not stop at the confirmation)
#
# What it protects against: overwriting a file on the server that someone changed there. Before anything is replaced, each file
# it will overwrite is hashed inside the LIVE image and compared with the hash of that file at the last shipped commit. A
# difference stops the run and prints the files. State (what is live, what was live before) is kept on Oracle in ship-state.env.
set -euo pipefail

HOST="${SHIP_HOST:-ubuntu@129.213.92.151}"
KEY="${SHIP_KEY:-$HOME/.ssh/atriveo_oracle}"
ROOT_REMOTE="${SHIP_ROOT:-atriveo-production}"           # relative to the remote home
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$HOST")
# What is live today (the Oct 23 deploy); used only by --init.
INIT_COMMIT="${INIT_COMMIT:-3f309439c}"
INIT_DASH_IMAGE="atriveo-dashboard:fit-3f309439c";    INIT_DASH_START="start-dashboard-fit-3f309439c.sh"
INIT_WORK_IMAGE="atriveo-dashboard:workers-fit-3f309439c"
INIT_WORK_STARTS="start-resume-fast-fit-3f309439c.sh start-compiler-fit-3f309439c.sh"

DRY=0; ROLLBACK=0; INIT=0; TESTS=1; WEBSITE=1; BACKFILL=0; YES=0
for a in "$@"; do case "$a" in
  --dry-run) DRY=1;; --rollback) ROLLBACK=1;; --init) INIT=1;; --skip-tests) TESTS=0;; --skip-website) WEBSITE=0;;
  --backfill) BACKFILL=1;; --yes) YES=1;; -h|--help) sed -n '2,14p' "$0"; exit 0;;
  *) echo "unknown option: $a" >&2; exit 2;; esac; done

cd "$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
run_remote() { if [ "$DRY" = 1 ]; then echo "[dry-run] ssh $HOST: $*"; else "${SSH[@]}" "$@"; fi; }
state() { "${SSH[@]}" "cat $ROOT_REMOTE/ship-state.env"; }

if [ "$INIT" = 1 ]; then
  say "Recording what is live"
  run_remote "cd $ROOT_REMOTE && printf 'DEPLOYED_COMMIT=%s\nDASH_IMAGE=%s\nDASH_START=%s\nWORK_IMAGE=%s\nWORK_STARTS=\"%s\"\nPREV_COMMIT=\nPREV_DASH_START=\nPREV_WORK_STARTS=\"\"\n' '$INIT_COMMIT' '$INIT_DASH_IMAGE' '$INIT_DASH_START' '$INIT_WORK_IMAGE' '$INIT_WORK_STARTS' > ship-state.env && cat ship-state.env"
  exit 0
fi

if [ "$ROLLBACK" = 1 ]; then
  say "Rolling back"
  S="$(state)"; eval "$S"
  [ -n "${PREV_DASH_START:-}" ] || { echo "Nothing to roll back to (no previous deploy recorded)." >&2; exit 1; }
  echo "dashboard -> $PREV_DASH_START   workers -> $PREV_WORK_STARTS"
  [ "$YES" = 1 ] || { read -r -p "Restart the previous dashboard and workers? [y/N] " r; [ "$r" = y ] || exit 1; }
  run_remote "cd $ROOT_REMOTE && ./$PREV_DASH_START && for s in $PREV_WORK_STARTS; do ./\$s; done && sed -i 's/^DEPLOYED_COMMIT=.*/DEPLOYED_COMMIT=$PREV_COMMIT/' ship-state.env && docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'dashboard|resume'"
  echo "Rolled back. If the website was deployed for the newer commit, redeploy it from that older commit too."
  exit 0
fi

COMMIT="$(git rev-parse --short HEAD)"
say "Commit $COMMIT on $(git branch --show-current)"
[ -z "$(git status --porcelain scripts data/ats src)" ] || { echo "Uncommitted changes in scripts/, data/ats or src: commit them first." >&2; git status --short scripts data/ats src | head; exit 1; }
git fetch -q origin 2>/dev/null || true
git branch -r --contains "$COMMIT" 2>/dev/null | grep -q origin || echo "note: $COMMIT is not on origin yet (push it so the code you ship is also saved)."

if [ "$DRY" = 1 ] && ! "${SSH[@]}" true 2>/dev/null; then
  DEPLOYED="${DEPLOYED_COMMIT:-$INIT_COMMIT}"; echo "[dry-run] no ssh: assuming the live commit is $DEPLOYED"
  DASH_IMAGE="$INIT_DASH_IMAGE"; DASH_START="$INIT_DASH_START"; WORK_IMAGE="$INIT_WORK_IMAGE"; WORK_STARTS="$INIT_WORK_STARTS"
else
  S="$(state)" || { echo "No ship-state on the server: run  npm run ship -- --init  once." >&2; exit 1; }
  eval "$S"; DEPLOYED="$DEPLOYED_COMMIT"
fi
git cat-file -e "$DEPLOYED^{commit}" 2>/dev/null || { echo "The live commit $DEPLOYED is not in this repo; fetch it first." >&2; exit 1; }
echo "live now: $DEPLOYED   dashboard $DASH_IMAGE   workers $WORK_IMAGE"
[ "$DEPLOYED" != "$COMMIT" ] || { echo "The live commit is already $COMMIT."; [ "$WEBSITE" = 1 ] || exit 0; }

# Files that change on the server: everything under scripts/ and data/ats that differs between the live commit and this one.
CHANGED="$(git diff --name-only --diff-filter=ACMR "$DEPLOYED" HEAD -- scripts data/ats | grep -v '^scripts/\(validate\|test-\)' || true)"
SRC_CHANGED="$(git diff --name-only "$DEPLOYED" HEAD -- src public vite.apply.config.ts apply.html | head -1 || true)"
say "Files to ship ($(echo "$CHANGED" | grep -c . || true))"
echo "$CHANGED" | sed 's/^/  /'
[ -n "$CHANGED" ] || echo "  (no server files changed)"

if [ "$TESTS" = 1 ]; then
  say "Tests"
  if [ "$DRY" = 1 ]; then echo "[dry-run] tsc + fit/store tests"; else
    npx tsc -p tsconfig.app.json --noEmit
    node --test tests/ats/fit.test.mjs tests/review/fitStore.test.mjs tests/review/resumeStore.test.mjs tests/review/resumeRetention.test.mjs
  fi
fi

if [ -n "$CHANGED" ]; then
  say "Drift check: the live image must still hold what was shipped at $DEPLOYED"
  EXPECT="$(for f in $CHANGED; do git cat-file -e "$DEPLOYED:$f" 2>/dev/null && printf '%s  %s\n' "$(git show "$DEPLOYED:$f" | shasum -a 256 | cut -d' ' -f1)" "$f"; done || true)"
  echo "$EXPECT" | awk 'NF{print "  " substr($1,1,12) "  " $2}'
  for IMG in "$DASH_IMAGE" "$WORK_IMAGE"; do
    if [ "$DRY" = 1 ]; then echo "[dry-run] docker run --rm -i $IMG sha256sum -c   (stdin: the hashes above)"; continue; fi
    if ! printf '%s\n' "$EXPECT" | "${SSH[@]}" "docker run --rm -i --entrypoint sh $IMG -c 'cd /app && sha256sum -c --quiet'" 2>&1; then
      echo; echo "STOP: $IMG has a file that differs from commit $DEPLOYED (listed above)." >&2
      echo "Someone changed it on the server. Copy it out, diff it, fold it into git, then run again." >&2
      exit 1
    fi
    echo "  $IMG: unchanged since $DEPLOYED"
  done
fi

if [ "$YES" != 1 ] && [ "$DRY" != 1 ]; then read -r -p "Ship $COMMIT to Oracle and restart the dashboard and workers? [y/N] " r; [ "$r" = y ] || exit 1; fi

if [ -n "$CHANGED" ]; then
  say "Shipping"
  if [ "$DRY" = 1 ]; then echo "[dry-run] tar the files above | ssh: extract to $ROOT_REMOTE/staging/ship-$COMMIT"; else
    # shellcheck disable=SC2086
    COPYFILE_DISABLE=1 tar czf - $CHANGED | "${SSH[@]}" "mkdir -p $ROOT_REMOTE/staging/ship-$COMMIT && tar xzf - -C $ROOT_REMOTE/staging/ship-$COMMIT 2>/dev/null; find $ROOT_REMOTE/staging/ship-$COMMIT -name '._*' -delete"
  fi
  NEW_DASH_IMAGE="atriveo-dashboard:ship-$COMMIT"; NEW_WORK_IMAGE="atriveo-dashboard:workers-ship-$COMMIT"
  NEW_DASH_START="start-dashboard-ship-$COMMIT.sh"
  NEW_WORK_STARTS=""; for s in $WORK_STARTS; do NEW_WORK_STARTS="$NEW_WORK_STARTS $(echo "$s" | sed -E "s/-(fit|ship)-[0-9a-f]+\.sh$/-ship-$COMMIT.sh/; t; s/-[a-z0-9]+-[0-9a-f]{9}\.sh$/-ship-$COMMIT.sh/")"; done
  NEW_WORK_STARTS="${NEW_WORK_STARTS# }"

  say "Building overlays and start scripts"
  OVERLAY="cd $ROOT_REMOTE/staging/ship-$COMMIT && printf 'FROM %s\nCOPY scripts /app/scripts\nCOPY data /app/data\n' '$DASH_IMAGE' > Dockerfile.dash && docker build -q -f Dockerfile.dash -t $NEW_DASH_IMAGE . \
    && printf 'FROM %s\nCOPY scripts /app/scripts\nCOPY data /app/data\n' '$WORK_IMAGE' > Dockerfile.work && docker build -q -f Dockerfile.work -t $NEW_WORK_IMAGE . \
    && cd ~/$ROOT_REMOTE && sed 's#$DASH_IMAGE#$NEW_DASH_IMAGE#' $DASH_START > $NEW_DASH_START && chmod +x $NEW_DASH_START"
  i=0; for old in $WORK_STARTS; do i=$((i+1)); new="$(echo "$NEW_WORK_STARTS" | cut -d' ' -f$i)"; OVERLAY="$OVERLAY && sed 's#$WORK_IMAGE#$NEW_WORK_IMAGE#' $old > $new && chmod +x $new"; done
  run_remote "$OVERLAY"
  # The overlays only add files; a layer copying only changed files (no data/ac-bank) keeps everything else as it was.

  say "Restarting"
  run_remote "cd ~/$ROOT_REMOTE && ./$NEW_DASH_START && for s in $NEW_WORK_STARTS; do ./\$s; done; sleep 6; docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'dashboard|resume'"
  say "Health"
  if [ "$DRY" != 1 ]; then
    BAD="$("${SSH[@]}" "docker ps --format '{{.Names}} {{.Status}}' | grep -E 'dashboard|resume' | grep -v ' Up ' || true; docker ps -a --filter status=restarting --format '{{.Names}} restarting' | grep -E 'dashboard|resume' || true")"
    if [ -n "$BAD" ]; then echo "$BAD" >&2; echo "A container is not Up. Rolling back." >&2; "$0" --rollback --yes || true; exit 1; fi
    echo "  dashboard and workers are Up."
    "${SSH[@]}" "cd $ROOT_REMOTE && sed -i -e 's/^PREV_COMMIT=.*/PREV_COMMIT=$DEPLOYED/' -e 's/^PREV_DASH_START=.*/PREV_DASH_START=$DASH_START/' -e 's/^PREV_WORK_STARTS=.*/PREV_WORK_STARTS=\"$WORK_STARTS\"/' -e 's/^DEPLOYED_COMMIT=.*/DEPLOYED_COMMIT=$COMMIT/' -e 's#^DASH_IMAGE=.*#DASH_IMAGE=$NEW_DASH_IMAGE#' -e 's/^DASH_START=.*/DASH_START=$NEW_DASH_START/' -e 's#^WORK_IMAGE=.*#WORK_IMAGE=$NEW_WORK_IMAGE#' -e 's/^WORK_STARTS=.*/WORK_STARTS=\"$NEW_WORK_STARTS\"/' ship-state.env && cat ship-state.env"
  fi
fi

if [ "$BACKFILL" = 1 ]; then say "Saving Fit on recent jobs"; run_remote "docker exec atriveo-dashboard node /app/scripts/fit-backfill.mjs --days 14 | tail -3"; fi

if [ "$WEBSITE" = 1 ] && { [ -n "$SRC_CHANGED" ] || [ "$DEPLOYED" = "$COMMIT" ]; }; then
  say "Website (after the backend, so the new pages find the fields they read)"
  if [ "$DRY" = 1 ]; then echo "[dry-run] npm run deploy:apply"; else npm run deploy:apply; fi
fi

say "Done: $COMMIT"
