# No-jobs dock / dashboard investigation

## Summary

We have likely been hitting two separate but related issues:

1. The app’s Pages API is enforcing auth even in the local dev path, which makes the dashboard look like it cannot load jobs even when the JSON feed exists.
2. The feed and dashboard were built around a live backend pipeline that may not be running on this machine, so the UI can look empty if the backend is not started or if the data source is stale.

This file records the checks we already performed and the likely root causes to fix in order.

## What we already checked

### 1) The job JSON files exist locally

The static feed files are present in the app repository:

- `public/jobs.json`
- `public/today_jobs.json`
- `public/yesterday_jobs.json`
- `public/week_jobs.json`
- `public/run_history.json`

These files contain job entries, so the issue is not that the repository is empty.

### 2) The dashboard fetches via `/api/jobs`

The UI loads jobs using the API route:

- `src/pages/Dashboard.tsx` calls `fetch('/api/jobs?type=...')`

If the API responds with 401, the dashboard silently falls back to an empty list and shows the “Could not load jobs” state.

### 3) The API requires an auth cookie

The Pages function in `functions/api/jobs.ts` insists on a valid `atriveo_token` cookie and rejects the request if it is missing or invalid.

The middleware in `functions/_middleware.ts` also blocks unauthed API calls and redirects unauthenticated users away from the app.

### 4) The app is not running the backend service on this machine

This repo does not contain a local backend service that we can point to for real job ingestion. The repository is the app, not the scraping / ingestion backend. The app expects JSON published assets and optional worker/backend services to exist.

The `README.md` architecture also describes a Mac-side scraper + pipeline + worker stack, which is not obviously running here.

## Likely root causes

### Root cause A: local dev auth gate is too strict

The Pages auth layer is treating localhost as unauthenticated, so the browser gets 401 responses even while testing locally. This explains the “job feed load failed” behavior despite the static `public/*.json` files being there.

Impact:

- dashboard fetches to `/api/jobs` fail
- UI appears empty
- no jobs show in the dock/feed

### Root cause B: backend is a separate service, not just this repo

This app relies on the job pipeline backend (scraper / worker / data publication) to produce or refresh the feed. If the backend is not running on this machine, then the feed stays stale or empty.

Impact:

- no fresh session data
- job data not refreshed into the JSON feed
- UI displays the empty state even though there are jobs in a different source or earlier export

### Root cause C: assumptions in the UI about a single “live feed” model

The UI is written as if a single backend / API is always present. It does not clearly degrade to the static `public/*.json` files when the backend is absent.

That means the app can look totally broken even though the data files are still valid.

## What we changed already

We temporarily adjusted the auth check so that localhost requests bypass the auth gate while keeping the production protection in place.

Files changed:

- `functions/_middleware.ts`
- `functions/api/jobs.ts`

This is a targeted safety fix to stop the local machine from getting a false 401 while we debug the real feed/backend issue.

## What to do next, one by one

### Step 1 — verify the local app works without auth blocking

Run the local app and confirm that `/api/jobs?type=today` responds instead of 401.

### Step 2 — determine whether the backend repo is missing or not started

Check whether the backend repo exists locally and whether the job-pipeline services are running.

Expected actions:

- clone the backend repo if it is not present
- start the scraper / pipeline daemon
- verify the exported JSON feed updates

### Step 3 — check the feed publishing path

Look at the pipeline steps that generate:

- `public/jobs.json`
- `public/today_jobs.json`
- etc.

If those files are stale or empty, we need to trigger the export refresh job.

### Step 4 — fix the UI fallback behavior

If the backend is absent, show a clear “local feed fallback” message instead of a blank “Could not load jobs” state.

### Step 5 — decide whether to create a dedicated jobs section by session or job bucket

The app currently assumes a single daily feed. If the backend delivers per-session batches, we may need a dedicated section or session grouping for all jobs rather than one flat list. This part is likely a product/UX issue rather than a data bug.

## Specific recommendation

The highest-priority path is:

1. Get the backend repo cloned and running on this machine.
2. Confirm the job feed generation pipeline is emitting the JSON files.
3. Fix the auth bypass for localhost dev only.
4. Add a clearer fallback path in the UI for missing backend data.

This should address both the empty dock and the “jobs not loading” symptom without overfitting to a single server-side bug.
