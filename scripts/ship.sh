#!/usr/bin/env bash
# One command from your Mac to put the current commit into production: no GitHub Actions, no manual paste.
#
#   npm run ship                 test, ship changed files, check the live image has not drifted, build the dashboard and worker
#                                overlays on Oracle, restart them, check they are Up, then deploy the website
#   npm run ship -- --dry-run    print the plan (files, expected hashes, commands) and touch nothing
#   npm run ship -- --rollback   put the previous dashboard and workers back
#   npm run ship -- --init       once: record what is live now (see INIT_* below)
#   Options: --skip-tests  --skip-website  --backfill  --yes (do not stop at the confirmation)
#            --only-scraper  rebuild just the scraper containers (no overlay, no dashboard or worker restart)
#            --restart  recreate the running containers from the current images (picks up changed settings in dashboard.env); ships nothing
#            --check-only  read the live state and run the drift check, then stop (changes nothing)
#            --scraper  (re)build and start the scraper containers from github.com/atishay-kasliwal/job-pipeline (SCRAPER_REF=main)
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

DRY=0; ROLLBACK=0; INIT=0; TESTS=1; WEBSITE=1; BACKFILL=0; YES=0; SCRAPER=0; CHECK_ONLY=0; ONLY_SCRAPER=0; RESTART=0
SCRAPER_REPO="${SCRAPER_REPO:-https://github.com/atishay-kasliwal/job-pipeline}"; SCRAPER_REF="${SCRAPER_REF:-main}"
for a in "$@"; do case "$a" in
  --dry-run) DRY=1;; --rollback) ROLLBACK=1;; --init) INIT=1;; --skip-tests) TESTS=0;; --skip-website) WEBSITE=0;;
  --backfill) BACKFILL=1;; --scraper) SCRAPER=1;; --check-only) CHECK_ONLY=1;; --restart) RESTART=1;; --only-scraper) ONLY_SCRAPER=1; SCRAPER=1; WEBSITE=0; TESTS=0;; --yes) YES=1;; -h|--help) sed -n '2,14p' "$0"; exit 0;;
  *) echo "unknown option: $a" >&2; exit 2;; esac; done

cd "$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=ship-lib.sh
. scripts/ship-lib.sh
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

if [ "$RESTART" = 1 ]; then
  say "Restarting the containers from the current images (settings in dashboard.env are read again)"
  S="$(state)"; eval "$S"
  [ "$YES" = 1 ] || { read -r -p "Restart the dashboard, workers, health watch and after-scrape loop? [y/N] " r; [ "$r" = y ] || exit 1; }
  run_remote "cd ~/$ROOT_REMOTE && ./$DASH_START && for s in $WORK_STARTS; do ./\$s; done; \
    (docker rm -f atriveo-health >/dev/null 2>&1; docker run -d --name atriveo-health --restart unless-stopped --network atriveo-production --user 1001:1001 --env-file /home/ubuntu/atriveo-muse/private/dashboard.env $DASH_IMAGE node /app/scripts/health-watch.mjs --loop 900 >/dev/null && echo 'health watch restarted'); \
    if docker inspect atriveo-after-scrape >/dev/null 2>&1; then docker rm -f atriveo-after-scrape >/dev/null 2>&1; docker run -d --name atriveo-after-scrape --restart unless-stopped --network atriveo-production --user 1001:1001 -v /home/ubuntu/$ROOT_REMOTE/files:/home/ubuntu/$ROOT_REMOTE/files:ro -v /home/ubuntu/$ROOT_REMOTE/files/resumes:/Users/atishaykasliwal/Documents/tailored-resumes:ro --env-file /home/ubuntu/atriveo-muse/private/dashboard.env $DASH_IMAGE sh /app/deploy/scraper/after-scrape.sh >/dev/null && echo 'after-scrape loop restarted'; fi; \
    sleep 6; docker ps --format '{{.Names}}  {{.Status}}' | sort | sed 's/^/  /'"
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
[ "$ONLY_SCRAPER" = 1 ] || [ "$DEPLOYED" != "$COMMIT" ] || { echo "The live commit is already $COMMIT."; [ "$WEBSITE" = 1 ] || exit 0; }

# Files that change on the server: everything under scripts/ and data/ats that differs between the live commit and this one.
CHANGED="$(git diff --name-only --diff-filter=ACMR "$DEPLOYED" HEAD -- scripts data/ats deploy | grep -v -e '^scripts/ship\.sh$' -e '^scripts/ship-lib\.sh$' -e '^scripts/ats/validate' -e '^scripts/test-' || true)"
SRC_CHANGED="$(git diff --name-only "$DEPLOYED" HEAD -- src public vite.apply.config.ts apply.html | head -1 || true)"
if [ "$ONLY_SCRAPER" = 1 ]; then CHANGED="$(git ls-files deploy)"; fi
# The scraper step copies loop.sh, Dockerfile.loop and patch_storage.py from the shipped set, so --scraper always ships them, changed or not.
# The after-scrape loop's own scripts go with it (the two LinkedIn ones ran only on the Mac before, so they were never in the image).
if [ "$SCRAPER" = 1 ]; then CHANGED="$(printf '%s\n%s\n%s\n' "$CHANGED" "$(git ls-files deploy/scraper)" "$(git ls-files scripts/linkedin-apply-type.mjs scripts/linkedin-board-match.mjs)" | grep -v '^$' | sort -u)"; fi
# The scoring bundle ships whole whenever anything in it (or the Fit code around it) changes.
if echo "$CHANGED" | grep -q -E '^(data/ats|scripts/ats|scripts/(fit-|job-matching|applications-analytics|resume-queue|tailor-worker))'; then
  CHANGED="$(printf '%s\n%s\n' "$CHANGED" "$(bundle_files)" | grep -v '^$' | sort -u)"
fi
say "Files to ship ($(echo "$CHANGED" | grep -c . || true))"
echo "$CHANGED" | sed 's/^/  /'
[ -n "$CHANGED" ] || echo "  (no server files changed)"

if [ "$TESTS" = 1 ]; then
  say "Tests"
  if [ "$DRY" = 1 ]; then echo "[dry-run] tsc + fit/store tests"; else
    npx tsc -p tsconfig.app.json --noEmit
    node --test tests/ats/fit.test.mjs tests/review/fitStore.test.mjs tests/review/resumeStore.test.mjs tests/review/resumeRetention.test.mjs tests/review/pageFill.test.mjs
  fi
fi

if [ -n "$CHANGED" ] && [ "$ONLY_SCRAPER" != 1 ]; then
  say "Drift check: every file we will replace must be a version this repo has had (an older one is fine; one found nowhere in git is a server edit)"
  # shellcheck disable=SC2086
  FILES="$(echo $CHANGED)"
  for IMG in "$DASH_IMAGE" "$WORK_IMAGE"; do
    if [ "$DRY" = 1 ]; then echo "[dry-run] $IMG: hash the $(echo "$CHANGED" | wc -l | tr -d ' ') files that exist there and look each up in git history"; continue; fi
    SNIPPET="$(remote_hash_script $FILES)"
    LIVE="$("${SSH[@]}" "docker run --rm --entrypoint sh $IMG -c '$SNIPPET'")" || { echo "Could not read the files in $IMG over ssh." >&2; exit 1; }
    BAD=0
    while read -r hash path; do
      [ -n "$path" ] || continue
      if c="$(known_version "$path" "$hash")"; then
        [ "$c" = "$(git rev-parse HEAD)" ] || { [ "$(git show "HEAD:$path" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)" = "$hash" ] || echo "  $IMG: $path is an older version (from ${c:0:9}); it will be replaced"; }
      else echo "  $IMG: $path matches NO version in git history: it was edited on the server" >&2; BAD=1; fi
    done <<< "$LIVE"
    [ "$BAD" = 0 ] || { echo; echo "STOP: copy the file(s) above out of $IMG, diff them, fold the changes into git, then run again." >&2; exit 1; }
    echo "  $IMG: ok"
  done
fi

if [ "$CHECK_ONLY" = 1 ]; then say "Check only: nothing was changed"; exit 0; fi

if [ "$YES" != 1 ] && [ "$DRY" != 1 ]; then read -r -p "Ship $COMMIT to Oracle and restart the dashboard and workers? [y/N] " r; [ "$r" = y ] || exit 1; fi

if [ "$ONLY_SCRAPER" = 1 ]; then
  say "Shipping the scraper files"
  if [ "$DRY" = 1 ]; then echo "[dry-run] tar deploy/ | ssh: extract to $ROOT_REMOTE/staging/ship-$COMMIT"; else
    COPYFILE_DISABLE=1 tar czf - deploy | "${SSH[@]}" "mkdir -p $ROOT_REMOTE/staging/ship-$COMMIT && tar xzf - -C $ROOT_REMOTE/staging/ship-$COMMIT 2>/dev/null; find $ROOT_REMOTE/staging/ship-$COMMIT -name '._*' -delete"
  fi
  CHANGED=""
fi
if [ -n "$CHANGED" ]; then
  say "Shipping"
  if [ "$DRY" = 1 ]; then echo "[dry-run] tar the files above | ssh: extract to $ROOT_REMOTE/staging/ship-$COMMIT"; else
    # shellcheck disable=SC2086
    COPYFILE_DISABLE=1 tar czf - $CHANGED | "${SSH[@]}" "mkdir -p $ROOT_REMOTE/staging/ship-$COMMIT && tar xzf - -C $ROOT_REMOTE/staging/ship-$COMMIT 2>/dev/null; find $ROOT_REMOTE/staging/ship-$COMMIT -name '._*' -delete"
  fi
  NEW_DASH_IMAGE="atriveo-dashboard:ship-$COMMIT"; NEW_WORK_IMAGE="atriveo-dashboard:workers-ship-$COMMIT"
  NEW_DASH_START="start-dashboard-ship-$COMMIT.sh"
  NEW_WORK_STARTS=""
  for s in $WORK_STARTS; do
    kind="$(echo "$s" | sed -E -e 's/^start-//' -e 's/-(fit|ship)-[0-9a-f]+\.sh$//' -e 's/-[a-z0-9]+-[0-9a-f]{9}\.sh$//')"
    NEW_WORK_STARTS="$NEW_WORK_STARTS start-$kind-ship-$COMMIT.sh"
  done
  NEW_WORK_STARTS="${NEW_WORK_STARTS# }"

  say "Building overlays and start scripts"
  OVERLAY="cd $ROOT_REMOTE/staging/ship-$COMMIT && mkdir -p scripts data deploy && printf 'FROM %s\nCOPY scripts /app/scripts\nCOPY data /app/data\nCOPY deploy /app/deploy\n' '$DASH_IMAGE' > Dockerfile.dash && docker build -q -f Dockerfile.dash -t $NEW_DASH_IMAGE . \
    && printf 'FROM %s\nCOPY scripts /app/scripts\nCOPY data /app/data\n' '$WORK_IMAGE' > Dockerfile.work && docker build -q -f Dockerfile.work -t $NEW_WORK_IMAGE . \
    && cd ~/$ROOT_REMOTE && sed 's#$DASH_IMAGE#$NEW_DASH_IMAGE#' $DASH_START > $NEW_DASH_START && chmod +x $NEW_DASH_START"
  i=0; for old in $WORK_STARTS; do i=$((i+1)); new="$(echo "$NEW_WORK_STARTS" | cut -d' ' -f$i)"; OVERLAY="$OVERLAY && sed 's#$WORK_IMAGE#$NEW_WORK_IMAGE#' $old > $new && chmod +x $new"; done
  run_remote "$OVERLAY"
  # The overlays only add files; a layer copying only changed files (no data/ac-bank) keeps everything else as it was.

  say "Restarting"
  run_remote "cd ~/$ROOT_REMOTE && ./$NEW_DASH_START && for s in $NEW_WORK_STARTS; do ./\$s; done; sleep 6; docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'dashboard|resume'"
  # The health watch (alerts when scraping or the resume queue stops) runs from the same image, with the dashboard's settings.
  run_remote "docker rm -f atriveo-health >/dev/null 2>&1; docker run -d --name atriveo-health --restart unless-stopped --network atriveo-production --user 1001:1001 --env-file /home/ubuntu/atriveo-muse/private/dashboard.env $NEW_DASH_IMAGE node /app/scripts/health-watch.mjs --loop 900 >/dev/null && echo 'health watch started'"
  say "Health"
  if [ "$DRY" != 1 ]; then
    BAD="$("${SSH[@]}" "docker ps --format '{{.Names}} {{.Status}}' | grep -E 'dashboard|resume|health' | grep -v ' Up ' || true; docker ps -a --filter status=restarting --format '{{.Names}} restarting' | grep -E 'dashboard|resume' || true")"
    if [ -n "$BAD" ]; then echo "$BAD" >&2; echo "A container is not Up. Rolling back." >&2; "$0" --rollback --yes || true; exit 1; fi
    echo "  dashboard and workers are Up."
    "${SSH[@]}" "cd $ROOT_REMOTE && sed -i -e 's/^PREV_COMMIT=.*/PREV_COMMIT=$DEPLOYED/' -e 's/^PREV_DASH_START=.*/PREV_DASH_START=$DASH_START/' -e 's/^PREV_WORK_STARTS=.*/PREV_WORK_STARTS=\"$WORK_STARTS\"/' -e 's/^DEPLOYED_COMMIT=.*/DEPLOYED_COMMIT=$COMMIT/' -e 's#^DASH_IMAGE=.*#DASH_IMAGE=$NEW_DASH_IMAGE#' -e 's/^DASH_START=.*/DASH_START=$NEW_DASH_START/' -e 's#^WORK_IMAGE=.*#WORK_IMAGE=$NEW_WORK_IMAGE#' -e 's/^WORK_STARTS=.*/WORK_STARTS=\"$NEW_WORK_STARTS\"/' ship-state.env && cat ship-state.env"
  fi
fi

if [ "$SCRAPER" = 1 ]; then
  say "Scraper containers (job-pipeline@$SCRAPER_REF, and the after-scrape loop on the new dashboard image)"
  [ -n "${NEW_DASH_IMAGE:-}" ] || NEW_DASH_IMAGE="$DASH_IMAGE"
  STAGE="~/$ROOT_REMOTE/staging"
  run_remote "set -e; cd $STAGE && rm -rf scraper-src && git clone -q --depth 1 --branch $SCRAPER_REF $SCRAPER_REPO scraper-src && cd scraper-src \
    && JPSHA=\$(git rev-parse --short HEAD) && cp $STAGE/ship-$COMMIT/deploy/scraper/loop.sh ./loop.sh && cp $STAGE/ship-$COMMIT/deploy/scraper/Dockerfile.loop ./Dockerfile.loop && cp $STAGE/ship-$COMMIT/deploy/scraper/patch_storage.py ./patch_storage.py \
    && docker build -q -f Dockerfile.loop -t job-pipeline-scraper:\$JPSHA . \
    && (docker rm -f atriveo-scraper >/dev/null 2>&1 || true) \
    && docker run -d --name atriveo-scraper --restart unless-stopped --memory 1500m --cpus 1 --network atriveo-production --env-file /home/ubuntu/atriveo-muse/private/dashboard.env job-pipeline-scraper:\$JPSHA >/dev/null \
    && (docker rm -f atriveo-after-scrape >/dev/null 2>&1 || true) \
    && docker run -d --name atriveo-after-scrape --restart unless-stopped --network atriveo-production --user 1001:1001 -v /home/ubuntu/$ROOT_REMOTE/files:/home/ubuntu/$ROOT_REMOTE/files:ro -v /home/ubuntu/$ROOT_REMOTE/files/resumes:/Users/atishaykasliwal/Documents/tailored-resumes:ro --env-file /home/ubuntu/atriveo-muse/private/dashboard.env $NEW_DASH_IMAGE sh /app/deploy/scraper/after-scrape.sh >/dev/null \
    && sleep 5 && docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'scraper|after-scrape' && docker logs --tail 5 atriveo-scraper"
fi

if [ "$BACKFILL" = 1 ]; then say "Saving Fit on recent jobs"; run_remote "docker exec atriveo-dashboard node /app/scripts/fit-backfill.mjs --days 14 | tail -3"; fi

if [ "$WEBSITE" = 1 ] && { [ -n "$SRC_CHANGED" ] || [ "$DEPLOYED" = "$COMMIT" ]; }; then
  say "Website (after the backend, so the new pages find the fields they read)"
  if [ "$DRY" = 1 ]; then echo "[dry-run] npm run deploy:apply"; else npm run deploy:apply; fi
fi

say "Done: $COMMIT"
