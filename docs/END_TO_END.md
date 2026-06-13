# Atriveo — End-to-End Local Job-to-Resume System

This document maps the complete pipeline you own, **from scraping a job to a
compiled tailored PDF**, running entirely on local infrastructure. Claude (the
paid API) is no longer a dependency — local Ollama models do the AI work.

Last audited: 2026-06-12.

---

## One-Click Tailoring from the Feed (NEW)

You can now select jobs in the Live Feed and tailor resumes for them in one
click. This needs the **local tailor sidecar** running alongside the app.

```bash
# terminal 1 — the web app
cd ~/atriveo-app && npm run dev          # http://localhost:5173

# terminal 2 — the local tailor server (writes to drive, runs Ollama, compiles)
cd ~/atriveo-app && npm run tailor       # http://localhost:8787
```

Then in the feed: **select jobs → "Tailor selected"**. For each selected job the
sidecar:
1. pulls the full JD,
2. reads the resume template's exact bullets,
3. calls Ollama (gemma3:12b) for ATS scoring + bullet rewrites,
4. applies the rewrites to the template and compiles with tectonic,
5. saves to `/Volumes/Kasliwal v2/tailored-resumes/YYYY-MM-DD/NN-company-role/`:
   - `jd.txt`, `meta.json`, `optimizer.json`, `resume.tex`, `Atishay Kasliwal.pdf`

Requirements: external drive **Kasliwal v2** mounted, Ollama running, a resume
saved in Settings, and the selected jobs must have captured JDs.

> Each job takes ~2 minutes (gemma3:12b is the reliable model; qwen3:8b truncates
> under the JSON schema). Tailoring runs sequentially.

Server config (paths/model) is at the top of
[scripts/tailor-server.mjs](../scripts/tailor-server.mjs).

---

## The Three Systems You Have

| # | System | Path | Role |
|---|--------|------|------|
| 1 | **Scraper / pipeline** | `~/job-pipeline` | Scrapes LinkedIn, filters, scores, captures full JD text |
| 2 | **Resume engine** | `~/Desktop/June/Resume claude` | Rules + bullet bank + LaTeX template + auto-compile hook |
| 3 | **Web app** | `~/atriveo-app` | UI: job feed, skills gap, **Resume Optimizer** (local AI) |

Plus the **local AI layer**: Ollama serving `qwen3:8b`, `qwen3:4b`, `gemma3:12b`
from the external drive (`/Volumes/Kasliwal v2/ollama-models`).

---

## The Full Flow

```
                         macOS LaunchAgent (8:00 daily)
                                    │
   ┌────────────────────────────────┴───────────────────────────────┐
   │  SYSTEM 1 — SCRAPER  (~/job-pipeline)                           │
   │  python -m job_pipeline.main --pipeline all --deploy           │
   │                                                                 │
   │  scraper.py  → filters.py → scoring.py → storage.py            │
   │       │                                                         │
   │       ├─► output/jobs.json          (all scored jobs)          │
   │       ├─► output/descriptions.json  (URL → full JD text)  ◄── KEY
   │       ├─► docs/today_jobs.json      (published to dashboard)   │
   │       └─► MongoDB Atlas + GitHub Pages                          │
   └────────────────────────────────┬───────────────────────────────┘
                                    │  full JD text lives here
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  SYSTEM 3 — WEB APP  (~/atriveo-app)  — http://localhost:5173   │
   │                                                                 │
   │  • Live Feed / Weekly / Cart      ← reads scraper output        │
   │  • Skills page                    ← deterministic gap analysis  │
   │  • Resume Optimizer  ──────────────────┐                        │
   │    paste resume + JD, pick model       │                        │
   └────────────────────────────────────────┼────────────────────────┘
                                            │  POST /api/chat (stream)
                                            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  LOCAL AI — Ollama  (http://localhost:11434)                   │
   │  qwen3:8b  /  qwen3:4b  /  gemma3:12b                          │
   │  returns structured JSON: ATS+Human scores, keyword audit,     │
   │  bullet rewrites (9+/10), skills to add                         │
   └─────────────────────────────────────────────────────────────────┘
                                            │  approved direction
                                            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  SYSTEM 2 — RESUME ENGINE  (~/Desktop/June/Resume claude)      │
   │                                                                 │
   │  Memory/RULEBOOK.md      ← rules (truth-only, fixed structure)  │
   │  Memory/experience.md    ← bullet bank (only source of bullets) │
   │  Memory/QUESTION_ANSWERS ← stable facts, no repeat questions    │
   │       │                                                         │
   │       ▼  assemble into LaTeX                                    │
   │  tailored/YYYY-MM-DD/NN-company-role/resume.tex                 │
   │       │                                                         │
   │       ▼  PostToolUse hook → tectonic                            │
   │  "Atishay Kasliwal.pdf"   ← final deliverable                   │
   └─────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step: Scrape → Tailored PDF

### Step 0 — Prereqs (one-time / daily check)
```bash
# Ollama running with models on the external drive
echo $OLLAMA_MODELS                 # → /Volumes/Kasliwal v2/ollama-models
ls "/Volumes/Kasliwal v2/ollama-models" >/dev/null && echo "drive mounted"
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json;print([m['name'] for m in json.load(sys.stdin)['models']])"
# → ['gemma3:12b', 'qwen3:4b', 'qwen3:8b']
```
If the drive is **not** mounted, Ollama falls back to `~/.ollama/models` (which
also has copies today). Keep the drive plugged in for the canonical set.

### Step 1 — Scrape jobs + capture JDs
```bash
cd ~/job-pipeline
.venv/bin/python -m job_pipeline.main --pipeline all
```
Runs automatically every hour (12 AM – 11 PM local) via `com.atriveo.job-pipeline.plist`.
Produces:
- `output/jobs.json` — scored jobs
- `output/descriptions.json` — **URL → full JD text** (this is the JD source)
- `docs/today_jobs.json` — what the dashboard shows

If a job has no captured description yet:
```bash
.venv/bin/python -m job_pipeline.backfill_descriptions --limit 50
```

### Step 2 — Pick a job, get its JD
The JD text for any job URL lives in `output/descriptions.json`. Either:
- Copy it from there, or
- Use the dashboard / Cart in the web app to find the role, then grab the JD.

### Step 3 — Run the Resume Optimizer (local AI, no Claude API)
```bash
cd ~/atriveo-app
npm run dev          # → http://localhost:5173
```
Open **Optimizer** in the nav. It pre-fills your resume from Settings
(`localStorage`). Paste the JD, pick a model (Qwen3 8B recommended), click
**Optimize Resume**. You get back:
- ATS before/after + Human before/after scores
- Keyword audit: Have Now / Missing / Likely
- Bullet rewrites (only 9+/10), each with a reason
- Skills to add

> This page is **localhost-only** by design — Ollama refuses cross-origin
> requests from the deployed URL. Always use `http://localhost:5173`.

### Step 4 — Build the actual tailored resume (engine)
The Optimizer gives you the *direction*. The **engine** produces the
compile-ready one-page resume from your real bullet bank. From inside
`atriveo-app`, Claude is wired to the engine via `CLAUDE.md` +
`additionalDirectories`, so a resume task:
1. Reads `Memory/RULEBOOK.md` + `QUESTION_ANSWERS.md`
2. Screens work-authorization / sponsorship first (No-Go stops here)
3. Selects bullets only from `Memory/experience.md`
4. Writes `tailored/YYYY-MM-DD/NN-company-role/resume.tex` **in the engine repo**
5. Logs the run to `Memory/JD_RUNS/`

### Step 5 — Auto-compile to PDF
The engine's `PostToolUse` hook fires on any `.tex` write and runs `tectonic`,
producing **`Atishay Kasliwal.pdf`** next to the `.tex`. No manual step.

---

## What's Wired vs. What's Manual Today

| Link | Status | Notes |
|------|--------|-------|
| Scraper → JD text | ✅ Automatic | `output/descriptions.json` |
| Scraper → dashboard | ✅ Automatic | GitHub Pages + MongoDB |
| Web app → Ollama | ✅ Built | Resume Optimizer page, streaming JSON |
| `atriveo-app` → engine | ✅ Wired | `CLAUDE.md` + `additionalDirectories` + hook |
| `.tex` → PDF | ✅ Automatic | tectonic hook in engine |
| **Optimizer JSON → engine `.tex`** | ⚠️ Manual | You read the AI output, then ask Claude to build |
| **Pick job in app → JD into Optimizer** | ⚠️ Manual copy/paste | No button yet |
| **Resume text source of truth** | ⚠️ Three copies | See gap #1 below |

---

## Gaps & Missing Pieces

### 1. Resume text lives in three places (no single source)
- `~/job-pipeline/data/resume.txt` (scraper ATS analyzer)
- `~/atriveo-app` → browser `localStorage` key `atriveo_resume`
- `~/Desktop/June/Resume claude/Memory/experience.md` (bullet bank)

These can drift. **Fix:** treat `Memory/experience.md` as canonical; derive the
plain-text `resume.txt` and seed the app's resume box from it.

### 2. No one-click "JD from feed → Optimizer"
You copy/paste the JD. **Fix:** a "Tailor this" button on a job card that pushes
its `descriptions.json` text straight into the Optimizer.

### 3. Optimizer output doesn't auto-feed the engine build
The Optimizer returns JSON; building the `.tex` is a separate Claude ask.
**Fix:** an `/api/optimize` style endpoint or a CLI that takes the JSON +
bullet bank and emits `resume.tex` directly. (See "Next Build" below.)

### 4. Pipeline's old ATS analyzer still calls the Claude API
`~/job-pipeline/job_pipeline/resume/analyzer.py` uses `anthropic` +
`ANTHROPIC_API_KEY`. That's the old paid path. **Fix:** port it to Ollama
(the Optimizer page already proves the prompt + JSON shape work locally).

### 5. SECURITY — exposed GitHub token
`com.atriveo.job-pipeline.plist` has a `gho_…` token in plaintext. It's in a
LaunchAgent, not committed, but rotate it and load from a file/keychain instead.

### 6. No eligibility pre-filter shared between systems
The engine screens sponsorship at resume-build time; the scraper has
`SPONSORSHIP_REJECT_PHRASES`. They don't share a verdict. **Fix:** have the
scraper stamp each JD with a sponsorship verdict the engine can read.

---

## Next Build (to make it truly one-command)

A small local script — call it `tailor.py` in the engine repo — would close the
loop:

```
tailor.py --url <job_url>
  1. read JD from ~/job-pipeline/output/descriptions.json
  2. read bullet bank from Memory/experience.md
  3. call Ollama (qwen3:8b) with the engine RULEBOOK as system prompt
  4. screen sponsorship → No-Go stops here
  5. emit tailored/<date>/<NN>-<company>-<role>/resume.tex
  6. tectonic hook compiles → Atishay Kasliwal.pdf
  7. log to Memory/JD_RUNS/
```

That turns Steps 2–5 above into a single command, fully local, zero API cost.

---

## Quick Reference — Paths & Commands

```bash
# Scrape
cd ~/job-pipeline && .venv/bin/python -m job_pipeline.main --pipeline all

# Backfill a missing JD
.venv/bin/python -m job_pipeline.backfill_descriptions --url "<job_url>"

# Web app (Optimizer lives here)
cd ~/atriveo-app && npm run dev          # http://localhost:5173/optimizer

# Check Ollama
curl -s http://localhost:11434/api/tags

# Engine repo (rules + bullets + tailored output)
cd "~/Desktop/June/Resume claude"
```

Key files:
- JD source: `~/job-pipeline/output/descriptions.json`
- Rules: `~/Desktop/June/Resume claude/Memory/RULEBOOK.md`
- Bullets: `~/Desktop/June/Resume claude/Memory/experience.md`
- Optimizer page: `~/atriveo-app/src/pages/ResumeOptimizer.tsx`
- Compile hook: `~/Desktop/June/Resume claude/.claude/hooks/compile_tex.sh`
