# Atriveo App

**An evidence compiler that turns structured engineering accomplishments + a job description into a one-page, ATS-safe PDF resume.**

This is not a generic resume builder or keyword stuffer. It is a **constraint-driven compiler**: fixed 15-bullet layout, proof-backed accomplishment cards (ACs), global information-gain optimization, and deterministic LaTeX → PDF output.

The web app is the **control plane** (feed, queue, status). The Mac sidecar is the **compiler runtime**. The scraper is the **JD input layer**.

---

## Table of contents

1. [What we started with](#what-we-started-with)
2. [What this project is today](#what-this-project-is-today)
3. [Repository map](#repository-map)
4. [What is done](#what-is-done)
5. [Current architecture](#current-architecture)
6. [Permanent setup (run once)](#permanent-setup-run-once)
7. [Daily operations](#daily-operations)
8. [Resume layout (fixed)](#resume-layout-fixed)
9. [Compiler pipeline (technical)](#compiler-pipeline-technical)
10. [npm scripts reference](#npm-scripts-reference)
11. [Environment variables](#environment-variables)
12. [Troubleshooting](#troubleshooting)
13. [What we are planning](#what-we-are-planning)
14. [Explicitly out of scope](#explicitly-out-of-scope)
15. [Related docs](#related-docs)

---

## What we started with

| Era | Approach | Problem |
|-----|----------|---------|
| **Manual** | Paste JD into `Resume claude` folder; Claude/GPT rewrites bullets by hand | Slow, inconsistent, no scale |
| **Ollama tailor** | `tailor-server.mjs` + Gemma rewrote resume text per JD | Fragile JSON, hallucination risk, ~2 min/job |
| **Keyword tools** | ATS % as the north star | Optimizes strings, not evidence or coherence |
| **Browser queue** | `localStorage` owned job lifecycle | Tab must stay open; state lost on clear/sleep |

The pivot (2026): treat the resume as **compiled output** from a **structured evidence graph** (AC bank), not free-form text generation.

---

## What this project is today

| Layer | Maturity | Notes |
|-------|----------|-------|
| AC banks & story packages | ~99% | 161 ACs, SBU packages, bank v51 |
| Bullet / evidence quality | ~96% | Lint, wow scores, proof levels |
| JD routing & gate | ~93% | Engineering relevance, borderline, unsupported |
| Global optimizer | ~95% | 15-bullet hill climb, capability graph |
| ATS strategy | ~97% | Matrix penalties in selection scoring |
| Resume compiler (PDF) | ~98% | AC pipeline default; legacy Gemma optional |
| End-to-end automation | ~92% | Mongo worker + hourly enqueue; browser optional |
| Product UX / trust | ~88% | Trust report, diff, compile history, activity timeline |

**North star:** LinkedIn JD in → valid PDF / borderline warning / unsupported explanation out — never crash.

---

## Repository map

Three folders matter. Only **one** is the product.

| Path | Role | You work here? |
|------|------|----------------|
| **`~/atriveo-app`** | Web app, AC compiler, tailor sidecar, JD buckets | **Yes — primary** |
| **`~/job-pipeline`** | LinkedIn scrape (JobSpy) → MongoDB | Scraper only |
| **`~/Desktop/June/Resume claude`** | Legacy manual engine + LaTeX template path | Reference / template only |

### Inside `atriveo-app`

| Path | Purpose |
|------|---------|
| `src/` | React Dashboard, feed, tailor queue UI |
| `data/ac-bank/` | Accomplishment cards (YAML), bank version, capability graph |
| `scripts/tailor-ac.mjs` | Production tailor entry (one job → PDF) |
| `scripts/ac-pipeline.mjs` | Compose + optimize + artifacts |
| `scripts/tailor-server.mjs` | Mac HTTP sidecar (`:8787`) |
| `scripts/tailor-worker.mjs` | Mongo compile worker (drains queue) |
| `scripts/ac-artifact-store.mjs` | Fingerprint dirs + manifest checkpoints |
| `scripts/ac-fingerprint-replay.mjs` | Deterministic replay CLI (`ac:replay`) |
| `scripts/resume-enqueue.mjs` | Hourly top-job enqueue to Mongo |
| `public/job_descriptions/` | Hash-bucketed full JDs for the feed |
| `functions/` | Cloudflare Pages API + tailor relay |

---

## What is done

### Compiler core
- **AC evidence pipeline** — beam compose, RCS scoring, slot invariants, 15-bullet fixed layout
- **JD gate** (`ac-jd-gate.mjs`) — compose / borderline / blocked / unsupported; no crash on bad JDs
- **Global optimizer** (`ac-global-optimize.mjs`) — joint 15-bullet hill climb with capability graph
- **Capability graph** — ancestor decay, information gain, rejection audit
- **Story packages** — SBU package order preserved when package wins routing
- **ATS matrix** — penalties wired into selection scoring
- **Golden routing tests** — `npm run ac:routing-golden` (5 SBU fixtures)
- **JD soak test** — `npm run ac:jd-soak` (10 fixtures, no crashes)

### Product / pipeline
- **LinkedIn → Mongo → JD buckets** — hourly via LaunchAgent + `jd:export`
- **Feed UI** — jobs + full JD lookup via hash buckets
- **Mongo compile queue** — `resume:enqueue` hourly + `tailor-worker` LaunchAgent (no browser tab)
- **Dashboard observe mode** — live SSE on `GET /compile-queue/stream` (Mongo change streams); polls only as fallback
- **AC tailor default** — no Ollama required for PDF generation
- **Explain + trust report** — `explain.json`, `TrustReportPanel` (recruiter replay, rejections, JD coverage)
- **Compile history UI** — Resumes tab, diff panel, activity pipeline timeline
- **Stream recovery** — `POST /check-job` finds PDF after relay timeout
- **Health commands** — `tailor:doctor`, `pipeline:status`
- **CI fix** — GitHub Actions uses `jd:export` (not broken `export:descriptions`)
- **Permanent install** — `npm run pipeline:install` (scrape + sidecar + worker LaunchAgents)

### Compiler service (Phase 1–2)
- **Compile fingerprint** — `SHA256(jd_hash + bank + planner + optimizer + renderer + template)`
- **Artifact store** — `/Volumes/Kasliwal v2/artifacts/{fingerprint}/manifest.json` + stage checkpoints
- **Manifest cache skip** — re-enqueue reuses successful compose when fingerprint unchanged (`TAILOR_FORCE_RECOMPILE=1` to bypass)
- **Mongo queue** — `compile_jobs` collection; lease-based worker claiming
- **Sidecar API** — `GET /compile-queue`, `GET /compile-queue/stream`, `POST /compile-enqueue*`, `GET /resume/:fingerprint`, `GET /resume-artifacts`
- **Replay CLI** — `npm run ac:replay -- <fingerprint>` re-runs compose and diffs against stored artifacts

### Per-job output (today’s folder layout)

```
/Volumes/Kasliwal v2/tailored-resumes/YYYY-MM-DD/NN-company-role/
  jd.txt
  meta.json
  eligibility.json
  composition.json
  explain.json
  optimizer.json
  report.json
  snapshot.json
  resume.tex
  Atishay Kasliwal.pdf
```

**Immutable artifact manifest** (parallel to PDF folder):

```
/Volumes/Kasliwal v2/artifacts/{fingerprint}/
  manifest.json          # stage checkpoints (GATED → COMPOSED → … → PDF)
  composition.json       # compact pipeline snapshot (when cached)
  explain.json
  replay/                # ac:replay drift reports
```

---

## Current architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HOURLY (Mac LaunchAgent: com.atriveo.job-pipeline)                     │
│  ~/job-pipeline/run-pipeline-and-export.sh                              │
│    1. JobSpy scrape → MongoDB (jobs + descriptions)                     │
│    2. backfill_descriptions.py (recover ~10% missed JDs)                 │
│    3. trigger GitHub deploy (optional)                                    │
│    4. cd ~/atriveo-app && npm run jd:export                             │
│    5. cd ~/atriveo-app && npm run resume:enqueue  (all eligible → Mongo queue)  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STATIC FEED (Cloudflare Pages or npm run dev)                          │
│  public/*.json              — job lists (today, week, …)                │
│  public/job_descriptions/   — full JD text by URL hash bucket           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BROWSER (Dashboard — observe + manual actions)                           │
│  Feed tab subscribes to GET /compile-queue/stream (live Mongo updates)  │
│  Manual Tailor / batch panel still use browser stream queue (debug lane)│
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MAC WORKER (LaunchAgent: com.atriveo.tailor-worker — permanent)        │
│  scripts/tailor-worker.mjs — claims jobs, runs tailor-ac.mjs            │
│  Fingerprint cache skip · artifact manifests · lease recovery           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MAC SIDECAR (LaunchAgent: com.atriveo.tailor — permanent)              │
│  scripts/tailor-server.mjs :8787                                        │
│  Cloudflare relay: /tailor/* → tailor-relay.atriveo.com                 │
│  compile-queue API · resume-artifacts · stream tailor for Manual Tailor │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
              PDF on external drive + artifacts/{fingerprint}/
```

### What requires the browser (today)
- **Feed auto-compile** — runs via worker; Dashboard only **observes** queue state
- **Manual Tailor / Tailor selected** — still streams through browser (`useTailorQueue`)
- **Infrastructure** (scrape, JD export, worker, sidecar) runs without the browser

---

## Permanent setup (run once)

Prerequisites on the Mac:

- Node 20+
- Python venv at `~/job-pipeline/.venv`
- [Tectonic](https://tectonic-typesetting.github.io/) installed
- External drive **Kasliwal v2** mounted at `/Volumes/Kasliwal v2`
- `MONGO_URI` in `~/atriveo-app/.env`
- `GITHUB_TOKEN` in `~/job-pipeline/.env` (for deploy workflow dispatch)
- `cloudflared` logged in (for production relay): `cloudflared tunnel login`

### One command

```bash
cd ~/atriveo-app
npm install
npm run pipeline:install
```

This installs:

| LaunchAgent | Schedule | What it does |
|-------------|----------|--------------|
| `com.atriveo.job-pipeline` | Every hour (0:00–23:00) | Scrape + `jd:export` + `resume:enqueue` |
| `com.atriveo.tailor` | At login, **KeepAlive** | Sidecar + cloudflared tunnel |
| `com.atriveo.tailor-worker` | At login, **KeepAlive** | Drains Mongo compile queue |

Logs:

```bash
tail -f /tmp/atriveo_pipeline.log                    # scrape + jd:export + enqueue
tail -f ~/Library/Logs/atriveo-tailor.log              # tailor sidecar
tail -f ~/Library/Logs/atriveo-tailor-worker.log       # compile worker
```

Verify:

```bash
npm run pipeline:status    # quick
npm run tailor:doctor    # deep
```

Re-install after path changes:

```bash
JOB_PIPELINE_DIR=~/job-pipeline npm run pipeline:install
```

---

## Daily operations

### Tonight (before apply day)

```bash
cd ~/atriveo-app
npm run pipeline:ready    # sync JDs, enqueue compiles, build UI, restart services
npm run pipeline:status   # all green?
```

Keep Mac awake overnight and **Kasliwal v2** mounted. Hourly scrape → enqueue → worker compiles PDFs without opening the browser.

### Your part (apply day)
1. Open **Dashboard** → filter **Tailored: Done**
2. **PDF** opens the resume on your Mac · **Apply** opens LinkedIn (tracker syncs automatically)
3. Mac sidecar + worker must be running (LaunchAgents handle this after `pipeline:install`)

### Automatic (no action)
- Hourly LinkedIn scrape
- JD bucket refresh after each scrape
- Top jobs enqueued to Mongo after each scrape
- Compile worker drains queue without a browser tab
- Tailor sidecar + worker restart on crash / login

### Manual when needed

```bash
npm run pipeline:status     # anything broken?
npm run pipeline:sync       # force JD refresh from Mongo
npm run resume:enqueue      # force enqueue top jobs now
npm run tailor:worker:once  # drain one queued job (debug)
npm run tailor:restart      # kick tailor LaunchAgent (pick up new routes)
npm run tailor:worker:restart
npm run tailor:recover      # auto-repair Ollama/sidecar/tunnel
npm run ac:replay -- --list # list fingerprint manifests on drive
```

### Cross-machine workers

Multiple Macs can drain the same Mongo queue in parallel. Each machine needs:

1. Same `MONGO_URI` in `.env`
2. External drive **Kasliwal v2** mounted at `/Volumes/Kasliwal v2` (same `TAILOR_OUT_ROOT` + `ARTIFACTS_ROOT`)
3. Tectonic + `npm run tailor:worker:install` (or `pipeline:install`)

Each worker gets a **stable ID** (`~/.atriveo/worker-id` or `WORKER_ID=mac-studio` in `.env`). Workers heartbeat to Mongo (`compile_workers` collection); the Dashboard compiler strip shows fleet status via `GET /compile-workers`.

Jobs are claimed atomically by score. Leases renew every ~2 min during long compiles; expired leases are reclaimed by another worker.

```bash
npm run pipeline:status   # lists active worker fleet from Mongo
npm run tailor:worker:restart   # after code updates
```

### Select jobs manually
Dashboard → select rows → **Tailor selected** (batch panel streams progress).

---

## Resume layout (fixed)

| Section | Bullets |
|---------|---------|
| Stony Brook University | 4 |
| Wake Forest University | 3 |
| Accolite Digital | 4 |
| Atriveo | 2 |
| Insurance platform | 2 |
| **Total** | **15** |

Only **Atriveo** + **insurance-platform** project banks on resume. Alternate project banks archived.

Bank version: `data/ac-bank/BANK_VERSION.yaml` (currently v51).

---

## Compiler pipeline (technical)

For each job, `tailor-ac.mjs` runs:

1. **JD gate** — length, engineering relevance, eligibility (sponsorship, etc.)
2. **Compose** — beam search over AC slots, story packages, ATS matrix
3. **Global optimize** — hill climb on 15 bullets jointly (information gain)
4. **LaTeX render** — `ac-tex.mjs` from composition
5. **PDF compile** — Tectonic

Outcomes:

| Status | Meaning |
|--------|---------|
| `ok` + PDF | Success |
| `ok` + `borderline` | PDF with low-confidence JD warning |
| `unsupported-jd` | Not an engineering role — skipped |
| `no-go` | Eligibility blocked (sponsorship, etc.) |
| `tex-failed` | LaTeX/Tectonic error |

Legacy path: set `TAILOR_LEGACY=1` for Gemma bullet rewrites (not recommended).

---

## npm scripts reference

### Pipeline & ops

| Script | Purpose |
|--------|---------|
| `pipeline:install` | Install scrape + sidecar + worker LaunchAgents |
| `pipeline:ready` | Tonight prep: sync + enqueue + build + restart services |
| `pipeline:status` | Scrape log, JD freshness, sidecar health |
| `pipeline:sync` | Mongo → `public/job_descriptions/` |
| `jd:export` | Same as `pipeline:sync` |
| `resume:enqueue` | Enqueue all eligible jobs to Mongo compile queue (optional `--limit=N`) |
| `tailor:doctor` | Full chain health check |
| `tailor:install` | Tailor LaunchAgent only |
| `tailor:prod` | Foreground sidecar + tunnel |
| `tailor` | Local sidecar only (`:8787`) |
| `tailor:worker` | Run compile worker (foreground loop) |
| `tailor:worker:once` | Process one queued job and exit |
| `tailor:worker:install` | Worker LaunchAgent only |
| `tailor:worker:restart` | Restart worker LaunchAgent |

### Compiler / QA

| Script | Purpose |
|--------|---------|
| `ac:routing-golden` | SBU routing regression (5 tests) |
| `ac:jd-soak` | 10 JD fixtures, no crashes |
| `ac:ci` | Full CI gate: routing golden + JD soak + 1-page PDF |
| `ac:global-optimize` | Run optimizer CLI |
| `ac:rejection-audit` | Why wasn't AC X selected? |
| `ac:replay` | Re-run compose for a fingerprint; diff vs stored manifest |
| `ac:full-batch` | Offline batch PDFs from JD directory |
| `ac:bullet-lint` | Bullet quality lint |

### Compiler / CI (Docker)

Portable compiler image (no external drive, no Mongo):

```bash
docker build -t atriveo-compiler .
docker run --rm atriveo-compiler          # routing + soak + PDF
docker run --rm atriveo-compiler node scripts/ac-ci-verify.mjs --skip-pdf
```

GitHub Actions workflow `.github/workflows/compiler-ci.yml` runs `npm run ac:ci` on every bank/script change.

### App

| Script | Purpose |
|--------|---------|
| `dev` | Vite dev server |
| `build` | Production build |
| `dev:full` | Wrangler Pages local |

---

## Environment variables

### `~/atriveo-app/.env`

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGO_URI` | Yes | MongoDB `job_pipeline` — jd:export, compile queue, worker |

Optional compile cache / paths:

| Variable | Purpose |
|----------|---------|
| `ARTIFACTS_ROOT` | Override default `/Volumes/Kasliwal v2/artifacts` |
| `TAILOR_FORCE_RECOMPILE=1` | Bypass manifest cache on enqueue |
| `TAILOR_SKIP_CACHE=0` | Re-enable cache after force (default: cache on) |
| `WORKER_ID` | Stable compile worker name (default: `~/.atriveo/worker-id`) |
| `TAILOR_OUT_ROOT` | PDF output root — must match on machines sharing a drive |
| `WORKER_LEASE_SEC` | Job lease duration (default 900); renewed during compile |
| `WORKER_REQUIRE_DRIVE=0` | Allow claiming without external drive (not recommended) |

### `~/atriveo-app/.env.tailor`

| Variable | Purpose |
|----------|---------|
| `TAILOR_TOKEN` | Auth for sidecar + Cloudflare relay |
| `MONGO_URI` | Sidecar compile-queue routes (merged with `.env` at startup) |

### Cloudflare Pages (production)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Session signing |
| `TAILOR_ORIGIN` | Mac relay URL |
| `TAILOR_TOKEN` | Must match `.env.tailor` |
| `TRACKER_API_URL` / `TRACKER_API_TOKEN` | Optional application tracker sync |

### `~/job-pipeline/.env`

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | Scraper storage |
| `GITHUB_TOKEN` | Trigger `update-pages.yml` deploy |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| **No JD** / instant fail | Stale JD buckets | `npm run pipeline:sync` |
| **Offline** | Sidecar down | `npm run tailor:restart` |
| **Drive not mounted** | External disk | Plug in Kasliwal v2 |
| **Timeout** but PDF exists | Relay stream drop | App auto-checks disk; or `POST /check-job` |
| Queue not moving | Worker down or empty queue | `tail -f ~/Library/Logs/atriveo-tailor-worker.log`; `npm run resume:enqueue` |
| `/health` shows mongo not configured | Sidecar missing `MONGO_URI` | Add to `.env` or `.env.tailor`; `npm run tailor:restart` |
| Compile queue empty in UI | No manifests yet / worker idle | Wait for hourly enqueue or run `resume:enqueue` |
| Scrape not running | LaunchAgent unloaded | `npm run pipeline:install` |
| CI buckets stale | Was `export:descriptions` bug | Fixed — uses `jd:export` now |

Always start with:

```bash
npm run pipeline:status && npm run tailor:doctor
```

---

## What we are planning

Side-by-side with the working pipeline — **not replacing scrape or compiler**.

### Done (Phase 1–3 core)
- **Mongo compile queue** + persistent worker (`tailor-worker.mjs`)
- **Fingerprint identity** + immutable artifact dirs + `manifest.json` checkpoints
- **Manifest cache skip** on re-enqueue when fingerprint succeeded
- **Stateless Dashboard observe** — `GET /compile-queue`, `GET /compile-queue/stream`, `GET /compile-workers`
- **`ac replay <fingerprint>`** — deterministic reproduction + drift report
- **Trust report UI** — recruiter replay, rejections, JD coverage map
- **Docker CI** — `Dockerfile` + `npm run ac:ci` + GitHub Actions
- **Cross-machine workers** — fleet heartbeats, lease renewal, stable worker IDs

### Later polish
- Embed `resume { status, stage, fingerprint }` on job docs (single source of truth beyond queue subdoc)
- Retire browser-owned queue for Manual Tailor (optional debug lane only)

---

## Explicitly out of scope

Do **not** build these — diminishing returns vs trust/ops work:

| Out of scope | Why |
|--------------|-----|
| More AC bullets / alternate project banks | Bank is mature; scope locked to Atriveo + Insurance |
| More scoring heuristics / beam variants | Compiler ~98%; gains are product surface |
| ATS % as primary metric | Misleading; identity + information gain matter more |
| Manual Tailor polish | Debug lane only; feed automation is the product |
| Keyword-stuffing / Jobscan-style tailoring | Wrong mental model |
| LLM bullet rewrites (default path) | Evidence compiler replaces Gemma rewrites |
| Browser-owned queue (long term) | Feed queue migrated to Mongo worker; Manual Tailor still browser-streamed |
| Chrome extension for JD→PDF | Extension is for application tracking, not this pipeline |
| Outcome-driven learning loop | Logged only; no adaptation yet |
| Recruiter simulation as separate product | Subsumed by trust report / replay |

---

## Related docs

| Doc | Contents |
|-----|----------|
| [docs/TAILOR_RUNBOOK.md](docs/TAILOR_RUNBOOK.md) | Failure decoder, incident notes |
| [docs/END_TO_END.md](docs/END_TO_END.md) | Legacy flow (partially outdated — pre-AC default) |
| [CLAUDE.md](CLAUDE.md) | Pointer to legacy Resume claude engine |

---

## License

MIT
