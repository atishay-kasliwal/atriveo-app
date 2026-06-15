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
PYTHON_BIN="$(resolve_pipeline_python)"
FEED_SYNC_TIMEOUT="${FEED_SYNC_TIMEOUT:-1800}"

if ! acquire_lock "$LOCK"; then
  echo "[$(ts)] feed-sync already running — skip" >> "$LOG"
  exit 0
fi

echo "[$(ts)] === feed-sync start (timeout=${FEED_SYNC_TIMEOUT}s quick=${EXPORT_QUICK:-1}) ===" >> "$LOG"

cd "$PIPELINE_DIR" || { echo "[$(ts)] ERROR: cannot cd $PIPELINE_DIR" >> "$LOG"; exit 1; }

if ! "$PYTHON_BIN" -c "import pandas" 2>/dev/null; then
  echo "[$(ts)] WARN: pandas missing in venv — installing" >> "$LOG"
  "$PIPELINE_DIR/.venv/bin/pip" install -q pandas >> "$LOG" 2>&1 || true
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

if [ "$BUILD_STATUS" -eq 0 ]; then
  npx wrangler pages deploy dist --project-name atriveo-app --commit-dirty=true >> "$LOG" 2>&1
  echo "[$(ts)] pages deploy exit=$?" >> "$LOG"
fi

echo "[$(ts)] === feed-sync done ===" >> "$LOG"
