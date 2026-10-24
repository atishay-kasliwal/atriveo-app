#!/usr/bin/env bash
# Turn R2 on for Oracle without the key ever appearing in chat, a file in git, or a process list.
#   npm run set-r2                 asks for the Access Key ID and the Secret Access Key (hidden), tests them against the real bucket,
#                                  writes them to Oracle's dashboard.env (backup kept), and restarts the containers that read it
#   npm run set-r2 -- --check      only test the key, change nothing
# Non-interactive: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY already in the environment are used instead of asking.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
HOST="${SHIP_HOST:-ubuntu@129.213.92.151}"; KEY="${SHIP_KEY:-$HOME/.ssh/atriveo_oracle}"
ENVFILE="${R2_ENVFILE:-/home/ubuntu/atriveo-muse/private/dashboard.env}"
export R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-a4e4f5c1214af712b0f5f48ef7c722ec}" R2_BUCKET="${R2_BUCKET:-atriveo-resume}"
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ -z "${R2_ACCESS_KEY_ID:-}" ]; then read -r -p "R2 Access Key ID: " R2_ACCESS_KEY_ID; fi
if [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then read -r -s -p "R2 Secret Access Key (hidden): " R2_SECRET_ACCESS_KEY; echo; fi
export R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
[ "${#R2_ACCESS_KEY_ID}" -ge 16 ] && [ "${#R2_SECRET_ACCESS_KEY}" -ge 32 ] || { echo "Those look too short to be an R2 key pair. Nothing was changed." >&2; exit 1; }

echo "Testing the key against bucket \"$R2_BUCKET\" ..."
node scripts/r2-check.mjs || { echo "Nothing was changed on Oracle." >&2; exit 1; }
[ "$CHECK_ONLY" = 1 ] && exit 0

echo "Writing the four R2 settings to Oracle (backup: dashboard.env.bak-r2) ..."
printf 'R2_ACCOUNT_ID=%s\nR2_BUCKET=%s\nR2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n' "$R2_ACCOUNT_ID" "$R2_BUCKET" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" |
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "set -e; umask 077; f=$ENVFILE; cat > /tmp/r2.lines; cp -p \$f \$f.bak-r2; grep -v '^R2_' \$f > /tmp/dashboard.env.new || true; cat /tmp/r2.lines >> /tmp/dashboard.env.new; cat /tmp/dashboard.env.new > \$f; rm -f /tmp/r2.lines /tmp/dashboard.env.new; echo \"  dashboard.env now has \$(grep -c '^R2_' \$f) R2 lines (names: \$(grep -o '^R2_[A-Z_]*' \$f | tr '\\n' ' '))\""
if [ "${SET_R2_SKIP_RESTART:-0}" = 1 ]; then echo "(restart skipped)"; else
  echo "Restarting the containers that read it ..."
  bash scripts/ship.sh --restart --yes
fi
echo
echo "R2 is on. Check it after the next resume finishes building:"
echo "  npm run r2-status"
