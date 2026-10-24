#!/bin/sh
# What ran after the scrape on the Mac (com.atriveo.linkedin-match, and the resume queue sync), as a loop in the dashboard image:
#   1. linkedin-apply-type: mark each new LinkedIn job Easy Apply or the company's own form (public page, no login)
#   2. linkedin-board-match --apply: match LinkedIn jobs to the company boards
#   2b. fill-descriptions: fetch the job text the scraper missed from the board's public API, and re-open resumes that failed for lack of it
#   3. resume-enqueue: queue the fresh jobs for the resume workers
#   4. repair-resume-paths: repoint applications whose resume file is gone to a finished resume of the same job
# Every step is optional: one failing does not stop the others. Runs every EVERY_MIN minutes (default 15).
EVERY="${EVERY_MIN:-15}"
NODE="${NODE:-node}"
ONCE="${LOOP_ONCE:-0}"
step() { name="$1"; shift; echo "[$(date -u +%FT%TZ)] $name"; "$@"; code=$?; [ "$code" -eq 0 ] || echo "[$(date -u +%FT%TZ)] $name failed (exit $code)"; }
while true; do
  step linkedin-apply-type "$NODE" /app/scripts/linkedin-apply-type.mjs --days=2 --limit=400
  step linkedin-board-match "$NODE" /app/scripts/linkedin-board-match.mjs --apply
  step fill-descriptions "$NODE" /app/scripts/fill-descriptions.mjs --apply
  step resume-enqueue "$NODE" /app/scripts/resume-enqueue.mjs --limit=all
  # An application whose resume file is gone gets pointed at a finished resume of the same job, once one exists (logged, undoable).
  step repair-resume-paths "$NODE" /app/scripts/repair-resume-paths.mjs --apply
  [ "$ONCE" = "1" ] && exit 0
  sleep $((EVERY * 60))
done
