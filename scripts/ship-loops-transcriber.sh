#!/usr/bin/env bash
# Put the Loops transcriber (whisper.cpp in its own container) on the Oracle VM. It is separate from `npm run ship`: it builds a new image,
# starts one extra container, and does not touch the dashboard, the workers or the website.
#
#   npm run ship:transcriber -- --dry-run   print the plan and touch nothing
#   npm run ship:transcriber                build (slow: one build job, low priority) and start it
#   npm run ship:transcriber -- --stop      stop and remove it (recordings keep waiting; nothing is lost)
#
# The container: one CPU, 3 GB, its own network access to Mongo only through the same MONGO_URI the dashboard uses (read from the
# dashboard env file on the VM and passed as one variable; it is never printed). Run from a clean checkout of main (npm run ship rules).
set -euo pipefail
HOST="${SHIP_HOST:-ubuntu@129.213.92.151}"
KEY="${SHIP_KEY:-$HOME/.ssh/atriveo_oracle}"
ROOT_REMOTE="${SHIP_ROOT:-atriveo-production}"
ENV_FILE="${SHIP_DASH_ENV:-/home/ubuntu/atriveo-muse/private/dashboard.env}"
NAME=atriveo-loops-transcriber
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$HOST")
DRY=0; STOP=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --stop) STOP=1;; -h|--help) sed -n '2,10p' "$0"; exit 0;; *) echo "unknown option: $a" >&2; exit 2;; esac; done
cd "$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=require-main.sh
. scripts/require-main.sh
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
run_remote() { if [ "$DRY" = 1 ]; then echo "[dry-run] ssh $HOST: $*"; else "${SSH[@]}" "$@"; fi; }

if [ "$STOP" = 1 ]; then
  say "Stopping the transcriber"
  run_remote "docker rm -f $NAME >/dev/null 2>&1; echo stopped"
  exit 0
fi

require_main
COMMIT="$(git rev-parse --short=9 HEAD)"
STAGE="$ROOT_REMOTE/staging/loops-transcriber-$COMMIT"
IMAGE="atriveo-loops-transcriber:$COMMIT"
FILES=(package.json package-lock.json deploy/loops-transcriber/Dockerfile $(node scripts/import-closure.mjs scripts/loops-transcriber.mjs))
say "Commit $COMMIT: ${#FILES[@]} files"
printf '  %s\n' "${FILES[@]}"

say "Shipping the build context"
if [ "$DRY" = 1 ]; then echo "[dry-run] tar the files above | ssh: extract to $STAGE"; else tar -cf - "${FILES[@]}" | "${SSH[@]}" "mkdir -p $STAGE && tar -xf - -C $STAGE"; fi

say "Building $IMAGE (one job, low priority; this takes a while and that is fine)"
run_remote "cd $STAGE && mkdir -p scripts && nice -n 19 docker build -q -f deploy/loops-transcriber/Dockerfile -t $IMAGE ."

say "Starting it"
run_remote "docker rm -f $NAME >/dev/null 2>&1; MONGO=\$(grep '^MONGO_URI=' $ENV_FILE | cut -d= -f2-) && docker run -d --name $NAME --restart unless-stopped --network atriveo-production --user 1001:1001 --cpus 1 --memory 3g --tmpfs /tmp:rw,size=512m -e MONGO_URI=\"\$MONGO\" $IMAGE >/dev/null && sleep 5 && docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep $NAME && docker logs --tail 5 $NAME"
say "Done: $COMMIT (a recording now waits at most a few minutes for its turn)"
