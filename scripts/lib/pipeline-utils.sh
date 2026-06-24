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

# Pick a usable system python to (re)build a venv with. Prefers a stable,
# widely-supported minor; avoids brand-new releases that deps may lag behind.
resolve_base_python() {
  for candidate in \
    /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 \
    /opt/homebrew/bin/python3.11 /usr/local/bin/python3.11 \
    /opt/homebrew/bin/python3 /usr/local/bin/python3 \
    "$(command -v python3 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "python3"
}

# Ensure the pipeline venv exists AND its interpreter actually runs. A Homebrew
# python upgrade can delete the interpreter the venv was built against, leaving a
# dangling symlink (pip/python fail with "bad interpreter"). When that happens we
# rebuild the venv from scratch and reinstall requirements. Echoes the path to a
# working venv python on stdout; logs to $LOG if set. Returns non-zero only if a
# working venv could not be produced.
ensure_pipeline_venv() {
  local pipeline_dir="${JOB_PIPELINE_DIR:-/Users/atishaykasliwal/job-pipeline}"
  local venv="$pipeline_dir/.venv"
  local py="$venv/bin/python3"
  local log="${LOG:-/dev/null}"

  # Healthy if the interpreter exists and can actually execute.
  if [ -x "$py" ] && "$py" -c "import sys" >/dev/null 2>&1; then
    echo "$py"
    return 0
  fi

  echo "[$(ts)] WARN: pipeline venv missing/dead — rebuilding" >> "$log"
  local base_py
  base_py="$(resolve_base_python)"
  if [ -d "$venv" ]; then
    mv "$venv" "${venv}.broken-$(date +%Y%m%d-%H%M%S)" 2>>"$log" || rm -rf "$venv"
  fi
  if ! "$base_py" -m venv "$venv" >>"$log" 2>&1; then
    echo "[$(ts)] ERROR: venv rebuild failed (base=$base_py)" >> "$log"
    return 1
  fi
  "$py" -m pip install -q --upgrade pip >>"$log" 2>&1 || true
  if [ -f "$pipeline_dir/requirements.txt" ]; then
    "$py" -m pip install -q -r "$pipeline_dir/requirements.txt" >>"$log" 2>&1 || true
  fi

  if [ -x "$py" ] && "$py" -c "import sys" >/dev/null 2>&1; then
    echo "[$(ts)] venv rebuilt OK (base=$base_py)" >> "$log"
    echo "$py"
    return 0
  fi
  echo "[$(ts)] ERROR: venv still unusable after rebuild" >> "$log"
  echo "$py"
  return 1
}

resolve_pipeline_python() {
  local pipeline_dir="${JOB_PIPELINE_DIR:-/Users/atishaykasliwal/job-pipeline}"
  local py="$pipeline_dir/.venv/bin/python3"
  # Only treat as usable if the interpreter actually executes (not a dangling
  # symlink to a removed Homebrew python).
  if [ -x "$py" ] && "$py" -c "import sys" >/dev/null 2>&1; then
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
