# Deploying Fit, Resume Ready and R2 resumes

Order matters: **backend first, website last.** The new Matching, Today and Staffing pages read `fit` and `readyState` from the
backend; if the website goes first they show "–" until the backend catches up. (Rolling the backend first is harmless: the old
website ignores the new fields.)

## 0. R2 settings (only for R2; Fit needs none)
Put these in the Oracle dashboard env (`/home/ubuntu/atriveo-muse/private/dashboard.env`) and in the env file of the resume worker
container(s) (the `--env-file` named in `start-resume-fast-*.sh` and `start-compiler-*.sh`):

    R2_ACCOUNT_ID=a4e4f5c1214af712b0f5f48ef7c722ec
    R2_BUCKET=atriveo-resume
    R2_ACCESS_KEY_ID=<new read-write token>
    R2_SECRET_ACCESS_KEY=<new read-write token>

On the Mac apply side, a read-only token in `~/.playatriveo/r2.env` (same four names). Rotate the token that was pasted in chat first.

## 1. Ship the files (Mac)
    cd ~/atriveo-app-job-matching && git switch claude/fit-score && git pull --ff-only
    COMMIT=$(git rev-parse --short HEAD)
    tar czf - scripts/ac-tex.mjs scripts/applications-analytics.mjs scripts/ats/config.mjs scripts/ats/evidence.mjs scripts/ats/fit.mjs \
      scripts/ats/knockouts.mjs scripts/ats/master.mjs scripts/ats/match.mjs scripts/ats/ready.mjs scripts/fit-store.mjs scripts/fit-backfill.mjs \
      scripts/job-matching-analysis.mjs scripts/job-matching.mjs scripts/resume-education.mjs scripts/resume-queue.mjs scripts/resume-store.mjs \
      scripts/staffing-workspace.mjs scripts/tailor-server.mjs scripts/tailor-worker.mjs data/ats/candidate.yaml data/ats/scoring.yaml \
      | ssh -i ~/.ssh/atriveo_oracle ubuntu@129.213.92.151 "mkdir -p ~/atriveo-production/staging/fit-$COMMIT && tar xzf - -C ~/atriveo-production/staging/fit-$COMMIT"
    echo $COMMIT

## 2. Check the live files match the commit this was built on (Oracle)
Expected sha256 prefixes of the files before this change (commit a8b338ab2): job-matching `372c9a35`, tailor-server `f8f7f077`, resume-queue `3ceebecb`.

    ssh -i ~/.ssh/atriveo_oracle ubuntu@129.213.92.151
    docker run --rm --entrypoint sh atriveo-dashboard:job-matching-ats-v1 -c 'cd /app/scripts && sha256sum job-matching.mjs tailor-server.mjs resume-queue.mjs | cut -c1-16,65-'

If a hash differs, stop: the live image has changes that are not on `main`.

## 3. Dashboard overlay (Oracle; COMMIT as above)
    cd ~/atriveo-production/staging/fit-$COMMIT
    printf 'FROM atriveo-dashboard:job-matching-ats-v1\nCOPY scripts /app/scripts\nCOPY data/ats /app/data/ats\n' > Dockerfile
    docker build -t atriveo-dashboard:fit-$COMMIT .
    cd ~/atriveo-production
    sed "s/job-matching-ats-v1/fit-$COMMIT/" start-dashboard-job-matching-ats-v1.sh > start-dashboard-fit-$COMMIT.sh && chmod +x start-dashboard-fit-$COMMIT.sh
    ./start-dashboard-fit-$COMMIT.sh
    # roll back: ./start-dashboard-job-matching-ats-v1.sh

## 4. Resume worker overlay (Oracle)
The worker computes and saves Fit when a resume finishes, and uploads the resume to R2. Find its image tags:

    cd ~/atriveo-production
    grep -ho 'atriveo-[a-z-]*:[A-Za-z0-9._-]*' start-resume-fast-toolstitle-a4b5f73b8.sh start-compiler-toolstitle-a4b5f73b8.sh | sort -u

For each tag T printed (and its start script S), build the same overlay on it, tag it `...:fit-$COMMIT`, copy S with the tag swapped, run it.
Roll back with the original start script.

## 5. Save Fit on recent jobs (Oracle, once)
    docker exec atriveo-dashboard node /app/scripts/fit-backfill.mjs --dry --days 14
    docker exec atriveo-dashboard node /app/scripts/fit-backfill.mjs --days 14

Writes only `jobs.fit`. Without it the queue computes up to 40 missing Fits per request and the order settles over a few loads.

## 6. Website (Mac)
    cd ~/atriveo-app-job-matching && npm run deploy:apply

## 7. Check
- Matching shows a Fit number, skills from one list, and "Resume Ready · Ready/Review/Needs Work" over the resume.
- Today and Staffing cards say "Resume Ready" with a status.
- With R2 set: after the next resume compiles, `jobs.resume.object` exists in Mongo and the file is in bucket `atriveo-resume`.

What Fit reads: the AC bank inside the image (`/app/data/ac-bank`) and `data/ats/candidate.yaml`. Edit the candidate file to change
work authorization, location or certifications; `unknown` stays unknown.
