#!/bin/bash
# LinkedIn from this Mac. LinkedIn blocks Oracle's datacenter address (HTTP 429), so the job text never arrives from there; a home
# connection is fine. This scrapes LinkedIn only (the boards stay on Oracle) and writes the jobs and their descriptions into Oracle's
# database through a private ssh tunnel. Oracle's after-scrape loop then builds the resumes.
#
#   bash scripts/mac-linkedin-scrape.sh --install   one time: set up the scraper here and schedule it every 2 hours (LinkedIn throttles harder)
#   bash scripts/mac-linkedin-scrape.sh             run one scrape now (what the hourly schedule runs)
#   bash scripts/mac-linkedin-scrape.sh --uninstall stop the hourly schedule
#
# The database login is read from ~/atriveo-app/.env (MONGO_URI) and never printed. Everything lives in ~/.atriveo/linkedin.
set -u
HOME_DIR="$HOME/.atriveo/linkedin"
JP="$HOME_DIR/job-pipeline"
SELF="$HOME_DIR/mac-linkedin-scrape.sh"
LABEL="com.atriveo.linkedin-scrape"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENV_FILE="${ATRIVEO_ENV:-$HOME/atriveo-app/.env}"
KEY="${ORACLE_KEY:-$HOME/.ssh/atriveo_oracle}"
HOST="${ORACLE_HOST:-ubuntu@129.213.92.151}"
PORT=27029
SOCK="$HOME_DIR/tunnel.sock"
REPO="https://github.com/atishay-kasliwal/job-pipeline"
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

setup() {
  mkdir -p "$HOME_DIR"
  [ -d "$JP/.git" ] || git clone -q --depth 1 "$REPO" "$JP" || { log "clone failed"; exit 1; }
  git -C "$JP" pull -q --ff-only 2>/dev/null || true
  [ -x "$JP/.venv/bin/python" ] || python3 -m venv "$JP/.venv" || { log "venv failed"; exit 1; }
  "$JP/.venv/bin/pip" install -q -r "$JP/requirements.txt" || { log "pip install failed"; exit 1; }
  # The same build-time patch Oracle applies: JobSpy dates are stored as ISO strings (Mongo cannot encode datetime.date).
  cp "$HERE/../deploy/scraper/patch_storage.py" "$HOME_DIR/patch_storage.py" 2>/dev/null || true
  (cd "$JP" && "$JP/.venv/bin/python" "$HOME_DIR/patch_storage.py") || { log "storage patch failed"; exit 1; }
  cp "$HERE/mac-linkedin-descriptions.py" "$HOME_DIR/linkedin_descriptions.py" 2>/dev/null || true
  cp "$0" "$SELF" && chmod +x "$SELF"
}

case "${1:-}" in
  --install)
    setup
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SELF</string></array>
  <key>StartCalendarInterval</key><array>$(for h in 0 2 4 6 8 10 12 14 16 18 20 22; do printf "<dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>20</integer></dict>" $h; done)</array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/atriveo-linkedin-scrape.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/atriveo-linkedin-scrape.log</string>
</dict></plist>
PL
    launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null
    launchctl bootstrap "gui/$UID" "$PLIST" && log "scheduled: every 2 hours at :20 (log: ~/Library/Logs/atriveo-linkedin-scrape.log)"
    log "run one now with: bash $SELF"
    exit 0;;
  --uninstall)
    launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null; rm -f "$PLIST"; log "hourly schedule removed"; exit 0;;
esac

[ -x "$JP/.venv/bin/python" ] || setup
# Only one at a time (a slow scrape must not overlap the next hour's).
LOCK="$HOME_DIR/run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK"; else log "another run is in progress; skipping"; exit 0; fi
fi
trap 'ssh -S "$SOCK" -O exit "$HOST" >/dev/null 2>&1; rm -rf "$LOCK"' EXIT

# The database login: the line from the app's .env, with the tunnel's port swapped in. Never printed.
URI="$(sed -n 's/^MONGO_URI=//p' "$ENV_FILE" | head -1 | sed -E "s#@127\.0\.0\.1:[0-9]+#@127.0.0.1:$PORT#")"
[ -n "$URI" ] || { log "no MONGO_URI in $ENV_FILE"; exit 1; }

ssh -i "$KEY" -M -S "$SOCK" -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ConnectTimeout=20 \
  -L "127.0.0.1:$PORT:127.0.0.1:27017" "$HOST" || { log "could not open the tunnel to Oracle"; exit 1; }
log "LinkedIn scrape start"
cd "$JP" || exit 1
# The scraper's own description backfill loads 100+ full pages per run and gets 429 on all of them, which keeps the address throttled:
# it is switched off here, and the gentle fetcher below fills the gaps instead (a few jobs, slowly, stopping at the first 429).
MONGO_URI="$URI" ATS_GREENHOUSE=0 ATS_LEVER=0 ATS_ASHBY=0 PYTHONUNBUFFERED=1 "$JP/.venv/bin/python" -c "
import runpy, sys
import job_pipeline.backfill_descriptions as b
b.backfill_missing = lambda *a, **k: 0
sys.argv = ['job_pipeline.main', '--pipeline', 'all']
runpy.run_module('job_pipeline.main', run_name='__main__')"
code=$?
[ -f "$HOME_DIR/linkedin_descriptions.py" ] && MONGO_URI="$URI" "$JP/.venv/bin/python" "$HOME_DIR/linkedin_descriptions.py"
log "LinkedIn scrape done (exit $code)"
exit $code
