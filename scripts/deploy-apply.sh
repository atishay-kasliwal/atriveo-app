#!/bin/bash
# Deploy apply.atriveo.com (Cloudflare Pages project "atriveo-apply").
#
# Same repo and the same Pages Functions as application.atriveo.com, but:
#   - the frontend is the console only (dist-apply, built from apply.html);
#   - SITE=apply switches on admin-only mode: only ADMIN_EMAILS can sign up, sign in
#     or call any API (functions/_lib/admin.ts).
#
# Pages reads wrangler.toml and functions/ from the directory it deploys from, so this
# stages both in .deploy-apply/ (gitignored) with the apply project's settings.
#
#   npm run deploy:apply            (ADMIN_EMAILS defaults to katishay@gmail.com)
#   ADMIN_EMAILS="a@x.com,b@y.com" npm run deploy:apply
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$APP_DIR/.deploy-apply"
PROJECT="${APPLY_PAGES_PROJECT:-atriveo-apply}"
BRANCH="${APPLY_PAGES_BRANCH:-main}"
ADMINS="${ADMIN_EMAILS:-katishay@gmail.com}"

cd "$APP_DIR"
npm run build:apply

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R functions "$STAGE/functions"
cp -R dist-apply "$STAGE/dist"
# Same D1 user database as the main site (accounts are shared; the allowlist decides who gets in).
D1_ID="$(sed -n 's/^database_id *= *"\(.*\)"/\1/p' wrangler.toml | head -1)"
cat > "$STAGE/wrangler.toml" <<TOML
name = "$PROJECT"
compatibility_date = "2024-01-01"
pages_build_output_dir = "dist"

[vars]
SITE = "apply"
ADMIN_EMAILS = "$ADMINS"

[[d1_databases]]
binding = "atriveo_auth"
database_name = "atriveo-auth"
database_id = "$D1_ID"
TOML

cd "$STAGE"
echo "Deploying $PROJECT (branch $BRANCH), admins: $ADMINS"
npx wrangler pages deploy dist --project-name "$PROJECT" --branch "$BRANCH" --commit-dirty=true
