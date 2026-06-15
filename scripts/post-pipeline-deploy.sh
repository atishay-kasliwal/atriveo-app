#!/bin/bash
# Run both sync jobs in parallel (manual convenience only).
# Prefer: npm run feed:sync  |  npm run resume:sync

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

/bin/bash "$SCRIPT_DIR/sync-job-feed.sh" &
FEED_PID=$!
/bin/bash "$SCRIPT_DIR/sync-resume-queue.sh" &
RESUME_PID=$!

wait "$FEED_PID"
FEED_STATUS=$?
wait "$RESUME_PID"
RESUME_STATUS=$?

exit $(( FEED_STATUS != 0 ? FEED_STATUS : RESUME_STATUS ))
