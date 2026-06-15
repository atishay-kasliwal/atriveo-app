#!/bin/bash
# Resume queue sync — enqueue top jobs for the compile worker (Mongo).
# Independent of job feed / dashboard deploy. Safe to run manually: npm run resume:sync

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/pipeline-utils.sh
source "$SCRIPT_DIR/lib/pipeline-utils.sh"

APP_DIR="${ATRIVEO_APP_DIR:-/Users/atishaykasliwal/atriveo-app}"
LOG="/tmp/atriveo_resume_sync.log"
LOCK="/tmp/atriveo_resume_sync.lock"
LIMIT="${RESUME_SYNC_LIMIT:-25}"
NODE_BIN="$(resolve_node_bin)"

if ! acquire_lock "$LOCK"; then
  echo "[$(ts)] resume-sync already running — skip" >> "$LOG"
  exit 0
fi

echo "[$(ts)] === resume-sync start (limit=$LIMIT) ===" >> "$LOG"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "[$(ts)] ERROR: missing $APP_DIR/.env" >> "$LOG"
  exit 1
fi

run_with_timeout 180 "$NODE_BIN" --env-file="$APP_DIR/.env" "$APP_DIR/scripts/resume-enqueue.mjs" --limit="$LIMIT" >> "$LOG" 2>&1
STATUS=$?
echo "[$(ts)] resume:enqueue exit=$STATUS" >> "$LOG"
echo "[$(ts)] === resume-sync done ===" >> "$LOG"
exit "$STATUS"
