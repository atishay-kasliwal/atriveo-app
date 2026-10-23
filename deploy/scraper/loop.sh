#!/bin/sh
# The hourly scrape, as a loop inside a container (replaces the Mac's com.atriveo.scrape-hourly). Each cycle: prune old rows, then
# scrape every pipeline into Mongo (LinkedIn and Indeed through JobSpy: public pages, no login). A failed cycle waits at least
# RETRY_MIN minutes before trying again, so a block never turns into a tight loop. The health watch alerts when jobs stop arriving.
#   env: SCRAPE_EVERY_MIN (default 60)  RETRY_MIN (default 15)  SCRAPE_ARGS (default "--pipeline all")  PY (default python)
EVERY="${SCRAPE_EVERY_MIN:-60}"
RETRY="${RETRY_MIN:-15}"
ARGS="${SCRAPE_ARGS:---pipeline all}"
PY="${PY:-python}"
ONCE="${LOOP_ONCE:-0}"          # tests: run one cycle and stop

while true; do
  started=$(date +%s)
  echo "[$(date -u +%FT%TZ)] scrape cycle start"
  "$PY" -m job_pipeline.prune || echo "[$(date -u +%FT%TZ)] prune failed (continuing)"
  # shellcheck disable=SC2086
  "$PY" -m job_pipeline.main $ARGS
  code=$?
  now=$(date +%s)
  elapsed=$((now - started))
  if [ "$code" -eq 0 ]; then
    wait=$((EVERY * 60 - elapsed)); [ "$wait" -lt 60 ] && wait=60
    echo "[$(date -u +%FT%TZ)] scrape cycle ok in ${elapsed}s; next in ${wait}s"
  else
    wait=$((RETRY * 60)); echo "[$(date -u +%FT%TZ)] scrape cycle FAILED (exit $code); retry in ${wait}s"
  fi
  [ "$ONCE" = "1" ] && exit "$code"
  sleep "$wait"
done
