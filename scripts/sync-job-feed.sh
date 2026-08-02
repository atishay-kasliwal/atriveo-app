#!/bin/bash
# Job feed sync — Mongo → public/*.json → Cloudflare Pages.
# Hourly :20 (LaunchAgent). EXPORT_QUICK=1 skips slow week re-export.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/pipeline-utils.sh
source "$SCRIPT_DIR/lib/pipeline-utils.sh"

PIPELINE_DIR="${JOB_PIPELINE_DIR:-/Users/atishaykasliwal/job-pipeline}"
APP_DIR="${ATRIVEO_APP_DIR:-/Users/atishaykasliwal/atriveo-app}"
LOG="/tmp/atriveo_feed_sync.log"
LOCK="/tmp/atriveo_feed_sync.lock"
NODE_BIN="$(resolve_node_bin)"
FEED_SYNC_TIMEOUT="${FEED_SYNC_TIMEOUT:-1800}"

if ! acquire_lock "$LOCK"; then
  echo "[$(ts)] feed-sync already running — skip" >> "$LOG"
  exit 0
fi

echo "[$(ts)] === feed-sync start (timeout=${FEED_SYNC_TIMEOUT}s quick=${EXPORT_QUICK:-1}) ===" >> "$LOG"

cd "$PIPELINE_DIR" || { echo "[$(ts)] ERROR: cannot cd $PIPELINE_DIR" >> "$LOG"; exit 1; }

# Heal a dead/missing venv (e.g. after a Homebrew python upgrade removed the
# interpreter the venv was built against), then ensure pandas is present.
PYTHON_BIN="$(ensure_pipeline_venv)"
if ! "$PYTHON_BIN" -c "import pandas" 2>/dev/null; then
  echo "[$(ts)] WARN: pandas missing in venv — installing" >> "$LOG"
  "$PYTHON_BIN" -m pip install -q -r requirements.txt >> "$LOG" 2>&1 || true
fi

export EXPORT_QUICK="${EXPORT_QUICK:-1}"
run_with_timeout "$FEED_SYNC_TIMEOUT" "$PYTHON_BIN" -m job_pipeline.export_static >> "$LOG" 2>&1
EXPORT_STATUS=$?
echo "[$(ts)] export_static exit=$EXPORT_STATUS" >> "$LOG"

if [ "$EXPORT_STATUS" -ne 0 ]; then
  echo "[$(ts)] === feed-sync failed (export) ===" >> "$LOG"
  exit "$EXPORT_STATUS"
fi

mkdir -p "$APP_DIR/public"
for f in jobs.json important_jobs.json today_jobs.json yesterday_jobs.json week_jobs.json run_history.json metadata.json skills_summary.json; do
  if [ -f "$PIPELINE_DIR/docs/$f" ]; then
    cp "$PIPELINE_DIR/docs/$f" "$APP_DIR/public/"
  fi
done
echo "[$(ts)] copied feed JSON to $APP_DIR/public" >> "$LOG"

cd "$APP_DIR" || exit 1
npm run build >> "$LOG" 2>&1
BUILD_STATUS=$?
echo "[$(ts)] build exit=$BUILD_STATUS" >> "$LOG"

if [ "$BUILD_STATUS" -ne 0 ]; then
  echo "[$(ts)] === feed-sync failed (build) ===" >> "$LOG"
  exit "$BUILD_STATUS"
fi

# Wrangler needs credentials, and this script runs from cron-like contexts
# (sidecar spawn, LaunchAgent) that carry none of the shell's environment.
# Without this the deploy dies on "set a CLOUDFLARE_API_TOKEN env variable".
if [ -f "$APP_DIR/.env" ]; then
  while IFS= read -r line; do
    case "$line" in
      CLOUDFLARE_API_TOKEN=*|CLOUDFLARE_ACCOUNT_ID=*) export "${line?}" ;;
    esac
  done < "$APP_DIR/.env"
fi

# Deploy to the Pages *production* branch explicitly. Wrangler otherwise infers
# the branch from the git checkout, so running this from any working branch
# (e.g. macbook-air) silently produces a preview deployment while
# application.atriveo.com keeps serving stale data — a green phase and no change.
CF_BRANCH="${CF_PAGES_BRANCH:-main}"
npx wrangler pages deploy dist --project-name atriveo-app --branch "$CF_BRANCH" --commit-dirty=true >> "$LOG" 2>&1
# Capture BEFORE anything else runs. This used to read `exit=$?` inline inside
# an echo whose "[$(ts)]" prefix ran `date` first — so $? reported date's status,
# not wrangler's, and every failed deploy was logged as exit=0. A broken deploy
# then showed up as a green feed_deploy phase while production stayed stale.
DEPLOY_STATUS=$?
echo "[$(ts)] pages deploy exit=$DEPLOY_STATUS" >> "$LOG"

if [ "$DEPLOY_STATUS" -ne 0 ]; then
  echo "[$(ts)] === feed-sync failed (deploy) ===" >> "$LOG"
  exit "$DEPLOY_STATUS"
fi

echo "[$(ts)] === feed-sync done ===" >> "$LOG"
