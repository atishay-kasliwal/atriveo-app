# Shipping to production: `npm run ship`

One command from your Mac. No GitHub Actions. It replaces the manual paste in DEPLOY_FIT_R2.md for everything after the first time.

    npm run ship -- --init        once: records what is live now on Oracle (the Oct 23 images: fit-3f309439c)
    npm run ship -- --dry-run     see the plan: files, expected hashes, commands. Touches nothing.
    npm run ship                  the real thing
    npm run ship -- --rollback    put the previous dashboard and workers back
    options: --skip-tests  --skip-website  --backfill  --yes

What a run does, in order, and stops at the first problem:
1. Checks the tree is committed, runs `tsc` and the Fit/store tests (skip with `--skip-tests`).
2. Lists the files under `scripts/` and `data/ats/` that changed since the commit that is live.
3. **Drift check**: hashes each of those files inside the live dashboard and worker images and compares with that file at the live commit.
   A difference means someone changed it on the server: it stops and names the files. (This is the check that would have caught the
   `tailor-server.mjs` difference on Oct 23.)
4. Asks for confirmation, ships a tarball to `~/atriveo-production/staging/ship-<commit>/`.
5. Builds overlay images on the live ones (`FROM <current image>` + the changed files), writes new start scripts by swapping the tag.
6. Restarts the dashboard and both workers, then checks every container is Up. If one is not, it rolls back by itself.
7. Records the new live commit and the previous one in `~/atriveo-production/ship-state.env` (that is what `--rollback` reads).
8. Deploys the website (`npm run deploy:apply`) only when `src/` or `public/` changed, and only after the backend is up.

Notes
- Restarting a worker interrupts a resume that is compiling at that moment; it is re-queued. Ship when the queue is quiet if that matters.
- Host and key can be overridden: `SHIP_HOST`, `SHIP_KEY`. Rollback does not touch the website; redeploy it from the older commit if needed.
- It does not set the `R2_*` values; those stay in the Oracle env files.
- Terraform is not used: it provisions infrastructure (VMs, buckets, DNS), and nothing here needs that. If you later want the R2 bucket and Pages project
  described as code, that is a separate, small Terraform file; it is not needed to deploy.

## Scraping and alerts on Oracle (replaces the Mac)

`npm run ship -- --scraper` also builds and starts, on Oracle:
- `atriveo-scraper`: `python -m job_pipeline.main --pipeline all` every 60 minutes (a failed cycle retries after 15), from a fresh clone of
  github.com/atishay-kasliwal/job-pipeline (`SCRAPER_REF`, default main). LinkedIn and Indeed through JobSpy: public pages, **no login, no account**.
  Memory-capped at 1.5 GB so it cannot starve Mongo.
- `atriveo-after-scrape`: every 15 minutes, `linkedin-apply-type`, `linkedin-board-match --apply`, then `resume-enqueue` (what ran on the Mac at :55).
- `atriveo-health` (started by every ship): `health-watch.mjs` every 15 minutes. It sends a phone push through ntfy when no new LinkedIn/board jobs
  arrive for 6 h, no staffing jobs for 36 h, 5+ resumes wait over 3 h, or 300+ recent jobs have no Fit. One alert when it starts, one when it recovers,
  a reminder every 12 h. Set `NTFY_TOPIC=<your secret topic>` in `/home/ubuntu/atriveo-muse/private/dashboard.env` (and `NTFY_SERVER` if self-hosted),
  then install the ntfy app and subscribe to that topic.

Check the scraper: `docker logs --tail 20 atriveo-scraper`.  Dry run of the health check: `docker exec atriveo-health node /app/scripts/health-watch.mjs --once --dry`.

Turning the Mac jobs off once Oracle is producing jobs (the broken scrape and linkedin-match first):

    for j in scrape-hourly linkedin-match board-discovery; do launchctl bootout gui/$UID ~/Library/LaunchAgents/com.atriveo.$j.plist; done

(`board-discovery` runs weekly and is not on Oracle yet.) If LinkedIn blocks Oracle's address the scraper logs it, the health watch alerts, and the options are
a lower frequency (`SCRAPE_EVERY_MIN`), a proxy (the pipeline already has optional Tor support in `scraper.py`), or dropping LinkedIn.

## Oracle host: read before rebooting or upgrading the kernel
- The VM's Arm quota is **2 OCPUs / 12 GB** (this account), so that is its maximum size.
- **Do not unpin the kernel.** `mongo:8.0` (container `atriveo-mongodb`) will not start on Linux kernel 6.19 or newer (MongoDB SERVER-121912). The VM is pinned to
  `6.17.0-1018-oracle` (GRUB_DEFAULT in `/etc/default/grub`; packages on `apt-mark hold`). After a reboot, check `uname -r` says 6.17 and `docker ps` shows `atriveo-mongodb` Up.
  Upgrade the kernel only after a MongoDB release that fixes the bug is running (pull it and test first).
- A reboot (resize, updates) takes the database down for a few minutes; all 7 containers restart on their own.
