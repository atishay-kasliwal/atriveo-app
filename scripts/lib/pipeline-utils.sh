# Shared helpers for feed sync + resume sync scripts.

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

# Global lock path — trap must reference this (not a function-local variable).
_ATRIVEO_LOCK_PATH=""

release_lock() {
  if [ -n "${_ATRIVEO_LOCK_PATH:-}" ] && [ -f "$_ATRIVEO_LOCK_PATH" ]; then
    rm -f "$_ATRIVEO_LOCK_PATH"
  fi
  _ATRIVEO_LOCK_PATH=""
}

resolve_node_bin() {
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "node"
}

resolve_pipeline_python() {
  local pipeline_dir="${JOB_PIPELINE_DIR:-/Users/atishaykasliwal/job-pipeline}"
  local py="$pipeline_dir/.venv/bin/python3"
  if [ -x "$py" ]; then
    echo "$py"
    return 0
  fi
  echo "python3"
}

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

acquire_lock() {
  local lock_file="$1"
  if [ -f "$lock_file" ]; then
    local old_pid
    old_pid="$(cat "$lock_file" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      return 1
    fi
    rm -f "$lock_file"
  fi
  echo $$ > "$lock_file"
  _ATRIVEO_LOCK_PATH="$lock_file"
  trap release_lock EXIT INT TERM
  return 0
}
