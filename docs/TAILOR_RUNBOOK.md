# Tailor Pipeline Runbook

Plain-English guide to keeping the resume-tailoring pipeline healthy and
diagnosing failures. Written so **anyone** can read the logs and pinpoint a
problem — not just the author.

Last updated: 2026-06-13.

---

## First thing to run when something looks wrong

```bash
cd ~/atriveo-app && npm run tailor:doctor
```

This checks the **entire** chain in one shot and prints, in plain English, what
is healthy (✓), what is degraded (⚠), and what is broken (✗) — **with the exact
fix command for each failure.** Run this before anything else.

Exit code: `0` = healthy/warnings only, `1` = at least one hard failure.

---

## The pipeline, end to end

```
SCRAPER (~/job-pipeline, daily 08:00)
  → writes JDs to MongoDB + output/descriptions.json
        │
        ▼
JD EXPORT  (npm run jd:export)   ← MUST run after every scrape
  → pulls JDs from MongoDB into public/job_descriptions/NN.json (256 buckets)
        │
        ▼
WEB APP  (npm run dev)  reads /api/job-description-bucket?bucket=NN
        │
        ▼
TAILOR SIDECAR (npm run tailor)  builds resume with gemma3:12b → compiles PDF
  → /Volumes/Kasliwal v2/tailored-resumes/YYYY-MM-DD/NN-company-role/
```

The single most important rule: **`jd:export` must run after the scraper.**
If it doesn't, the app serves yesterday's JDs and today's jobs fail.

---

## Failure decoder — what each UI status means

The tailor cell / queue log shows a short status. Here's what each one means and
where to look:

| UI status | Meaning | Most likely cause | Fix |
|---|---|---|---|
| **No JD** | App had no full job description for this job | JD buckets stale or job too new | `npm run jd:export`, refresh app, re-run |
| **AI err** | Ollama step failed | Ollama down/stuck, or bad JSON | `npm run tailor:doctor`; restart Ollama |
| **Compile** | Tectonic PDF compile failed | Bad LaTeX from a rewrite | check the job's `resume.tex` + queue log |
| **Skip** | Model marked the job No-Go | sponsorship/clearance bar in JD | expected — not an error |
| **Offline** | Sidecar/relay unreachable | `npm run tailor` not running | `npm run tailor` |
| **Timeout** | Stream dropped mid-run | Cloudflare/network cut the stream | the app now auto-checks the drive for the PDF (see below) |
| **100%** | Done, PDF created | — | — |

### "No full JD captured for this job" (the 2026-06-13 incident)

Symptom: many/all jobs fail **instantly** (43–400ms — too fast to have called
Ollama). Root cause: `public/job_descriptions/` buckets were stale; the scraper
had run but `jd:export` had not.

Diagnose:
```bash
npm run tailor:doctor          # JD section shows STALE in red
cat public/job_descriptions/manifest.json   # check generated_at age
```
Fix:
```bash
npm run jd:export              # regenerate buckets from MongoDB
# refresh the app, then re-run the failed jobs from the queue
```

### "Timeout / Connection dropped" but the PDF exists

The Cloudflare relay has a streaming idle limit. If the stream drops mid-run but
the Mac actually finished, the app now calls the sidecar's `POST /check-job`
endpoint, finds the PDF on the drive, and **promotes the job to success**. So a
transient drop should no longer show as a permanent failure. If it still does,
the PDF genuinely wasn't created — check Ollama health.

---

## Known guards already in place (so you don't re-debug them)

- **Short JDs** (< 400 chars) are blocked *before* Ollama and returned as
  `no-jd` — they used to silently produce broken output (`ai-failed`).
- **Run folder numbering** counts any `NN-` prefix (`/^\d+-/`), so runs past 99
  no longer reset to `100-`.
- **Stream-drop recovery** via `/check-job` (above).
- **Recovery** (`npm run tailor:recover`) now unloads *all* loaded Ollama models
  (via `/api/ps`), not just the configured default — clears a stuck model.

See memory: `tailor-status-fail-fixes`, `gemma3-reliable-for-optimizer`.

---

## Model

Default is **gemma3:12b** (set in `tailor-server.mjs` + `tailor-recover.mjs`,
and the default in the Resume Optimizer dropdown). Chosen over gemma4:12b and
qwen3:8b after a head-to-head benchmark (`scripts/tailor-bench.mjs`) — gemma3
had the best bullet selection with zero rule violations. To re-compare on any
JD:
```bash
node scripts/tailor-bench.mjs "/path/to/jd.txt"
```

---

## Quick command reference

```bash
npm run tailor:doctor    # full health check — START HERE
npm run jd:export        # regenerate JD buckets (run after every scrape)
npm run tailor           # start the local build sidecar
npm run tailor:recover   # auto-repair Ollama + sidecar + tunnel
npm run tailor:check     # relay/tunnel-only health
node scripts/tailor-bench.mjs "<jd.txt>"   # compare models on one JD
```
