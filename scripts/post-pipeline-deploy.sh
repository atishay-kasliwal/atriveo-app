#!/bin/bash
# Background step after hourly scrape + jd:export.
# Exports Mongo → public/*.json, deploys to Cloudflare Pages, enqueues top resumes.
# Must not block the main pipeline script (LaunchAgent fires hourly).

set -uo pipefail

PIPELINE_DIR="${JOB_PIPELINE_DIR:-/Users/atishaykasliwal/job-pipeline}"
APP_DIR="${ATRIVEO_APP_DIR:-/Users/atishaykasliwal/atriveo-app}"
LOG="/tmp/atriveo_post_pipeline.log"
LOCK="/tmp/atriveo_post_pipeline.lock"

NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
[ -n "$NODE_BIN" ] || NODE_BIN="node"

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

run_with_timeout() {
  local secs="$1"
  shift
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
    return $?
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
    return $?
  fi
  "$@" &
  local pid=$!
  (
    sleep "$secs"
    kill "$pid" 2>/dev/null
  ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local status=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $status
}

if [ -f "$LOCK" ]; then
  old_pid="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[$(ts)] post-pipeline already running (pid $old_pid) — skip" >> "$LOG"
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "[$(ts)] === post-pipeline start ===" >> "$LOG"

# 1. Export job feeds from Mongo → job-pipeline/docs/
cd "$PIPELINE_DIR" || { echo "[$(ts)] ERROR: cannot cd $PIPELINE_DIR" >> "$LOG"; exit 1; }
run_with_timeout 900 "$PIPELINE_DIR/.venv/bin/python3" -m job_pipeline.export_static >> "$LOG" 2>&1
EXPORT_STATUS=$?
echo "[$(ts)] export_static exit=$EXPORT_STATUS" >> "$LOG"

if [ "$EXPORT_STATUS" -eq 0 ]; then
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
else
  echo "[$(ts)] WARN: export_static failed — skipping pages deploy" >> "$LOG"
fi

# 2. Enqueue top resumes only (never block for hours on full Mongo scan)
if [ -f "$APP_DIR/.env" ]; then
  run_with_timeout 180 "$NODE_BIN" --env-file="$APP_DIR/.env" "$APP_DIR/scripts/resume-enqueue.mjs" --limit=25 >> "$LOG" 2>&1
  echo "[$(ts)] resume:enqueue exit=$?" >> "$LOG"
fi

echo "[$(ts)] === post-pipeline done ===" >> "$LOG"
