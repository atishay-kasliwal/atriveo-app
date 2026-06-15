# Shared helpers for feed sync + resume sync scripts.

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

resolve_node_bin() {
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "node"
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
  fi
  echo $$ > "$lock_file"
  trap 'rm -f "$lock_file"' EXIT
  return 0
}
