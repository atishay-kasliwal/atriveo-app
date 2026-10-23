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
