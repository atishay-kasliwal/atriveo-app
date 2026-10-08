# Resume builder

`apply.atriveo.com/resume_builder`: change what a resume says without changing how it looks. You edit the
content (bullets, header title, skills); the pipeline's own renderer and compiler build the PDF, so the template
is always the same one every generated resume uses.

Started 2026-10-08. Status: **Phase 1 built** (see [Phases](#phases)).

## How you use it

| Start from | How | What saving does |
|---|---|---|
| A Today card | **Edit** on the card (next to Resume) | The edited PDF becomes that job's resume: Fill, Easy Apply and the Resume button use it. **Revert to generated** undoes it. |
| A track's general resume | Today → **Resumes** → Edit, or the **Resumes** tab → pick SWE / AI / Data Analyst / DS / FDE | Replaces that general resume (Today's Resumes menu serves it). The generated one is kept for **Revert**. |
| A job description you paste | *Phase 2* | |

In the editor:

- **Bullets**: move (↑ ↓), **Swap…** for another bullet of the same employer or project (also another version of
  the same bullet, marked ↺), **✕** remove, **+ Add a bullet from the bank**.
- **Projects**: **Remove project**, **+ Add a project**.
- **Title** (header) and **Technical skills** (one line each, `Category: a, b, c`).
- The preview re-renders about a second after you stop editing. **Save** turns on when the draft passes every check.

## Checks (every render; Save is refused unless all pass)

- **One page** (counted with `pdfinfo`; tectonic compresses page objects, so scanning the PDF undercounts).
- **Every bullet is from your bank**, under its own employer or project, and its text is one of that bullet's bank
  versions (Phase 1 has no free text).
- **No repeated opening verb** (the same rule the pipeline enforces: `assertUniqueCompositionVerbs`).
- **JD skill match before → after** (jobs only; `ac-jd-skills.mjs`): shown, not enforced. Hover it for the skills
  the job names that the resume still misses.

## How it works

```
Today card / track ──► GET  /tailor/resume-builder/load      loadResume()   sections + bank options + JD
                        POST /tailor/resume-builder/render    renderDraft()  assembleAcResume + tectonic → draft PDF + checks
                        POST /tailor/resume-builder/save      saveDraft()    keep the draft, point the job (and its applications) at it
                        POST /tailor/resume-builder/revert    revertResume() back to the generated resume
```

- A resume = its **composition** (which bank bullets, in which order, under which employer/project) + **header
  title** + **skills lines**. Generated runs keep it in `composition.json` (`composition.experience/projects`,
  `header_title`, `skills`); a saved edit keeps it in `builder.json`.
- Rendering calls `assembleAcResume()` (scripts/ac-tex.mjs), the same function every generated resume goes through,
  then `tectonic resume.tex`. Nothing in the builder writes LaTeX itself.
- The header city follows the job's location, as in generated resumes.

### Where things are stored

| What | Where |
|---|---|
| Drafts (every render) | `tailored-resumes/.builder-drafts/<id>/` (not synced between Mac and Oracle; safe to delete) |
| A job's saved edit | `<generated run folder>/edits/<n>/Atishay Kasliwal.pdf` (+ `builder.json`, `resume.tex`); always under the generated run, never nested in another edit |
| Which PDF a job uses | Mongo `jobs.resume.pdf_path` (all documents of that job URL); `resume.generated_pdf_path` = the generated one while an edit is in use; `resume.edited_at` |
| Its applications | `applications.resume.path` follows the job (not for APPLIED/SUBMITTING ones); `resume.sha256` is cleared so the file is verified again before it's attached; a pinned choice (`extension.resumeChoice`) is cleared |
| A track's edited general resume | `tailored-resumes/general/<Track>/` (PDF + `builder.json` + `resume.tex`); the generated one in `general/<Track>/generated/` |

Edits are made on the Oracle server (the dashboard container). The resume sync copies new files to the Mac (`edits/`
folders are new files, so nothing is ever overwritten).

### Files

| File | Role |
|---|---|
| `scripts/resume-builder.mjs` | load / render / save / revert, the checks, `GENERAL_RESUMES` (track → folder) |
| `scripts/tailor-server.mjs` | the `/resume-builder/*` routes (search "Resume builder") |
| `src/apply/ResumeBuilderPage.tsx` + `resume-builder.css` | the page |
| `src/apply/ApplyApp.tsx`, `ApplyHeader.tsx` | route `/resume_builder`, the **Resumes** tab |
| `src/apply/TodayPage.tsx` | **Edit** on cards, **Edit** in the Resumes menu |
| `src/apply/tracks.ts` | track labels shared by Today and the builder |
| `scripts/general-resumes.mjs` | builds the general resumes (keeps `composition.json`, so they can be edited) |
| `tests/review/resumeBuilder.test.mjs` | load → swap → render one page → save → reload → revert, and the refusals |
| `~/.playatriveo/integrations/sync-resumes.sh` (not in git) | `--exclude .builder-drafts` |

## Decisions (and why)

| Date | Decision |
|---|---|
| 2026-10-08 | **Same template, content only.** The builder edits the composition and renders with `assembleAcResume`, so layout can't drift. |
| 2026-10-08 | **A bullet you add to a resume goes into the bank automatically** and is used by future resumes (Phase 2). |
| 2026-10-08 | **Two ways in:** direct (paste a job description, or a track's general resume) and from a Today card (loads that job's current resume). |
| 2026-10-08 | **A saved edit becomes the resume Fill attaches**; the generated one is kept for Revert. |
| 2026-10-08 | Edits are saved as **new files** (`edits/<n>/`), never over the generated PDF, because the Mac↔Oracle sync never overwrites. |
| 2026-10-08 | Auto-filled metadata of a typed bullet (technologies, keywords) is shown collapsed and editable (Phase 2). |

## Phases

1. **Edit with your bank** (built 2026-10-08): from a Today card or a track's general resume; move / swap / remove /
   add bank bullets, add or remove projects, edit title and skills; live preview; checks; save; revert.
2. **New words**: paste a job description to start a resume; write a new bullet (lint rules from
   `ac-bullet-lint.mjs`: approved action verb, not Built/Developed/Trained, 12–35 words, ≤3 technologies, no
   "research" at Stony Brook). It's saved to the bank (Mongo, copied next to the git bank before each build so
   future resumes can pick it; bank version bumps so cached resumes rebuild) with an export-to-git script.
3. **Evaluation view** (below).

## Evaluation

| Question | Measure | Target |
|---|---|---|
| Is the template untouched? | An unedited composition re-renders to the same `resume.tex` | identical, always |
| Is every saved resume valid? | One page (`pdfinfo`), text extracts (`pdftotext`) | every save |
| Is it truthful? | Every bullet from the bank (Phase 2: new ones lint-clean and saved to the bank) | no exceptions |
| Did the edit help this job? | JD skill match before → after | shown on every save |
| Is it fast enough? | Edit → preview | under ~5 s |
| What should the generator learn? | Which sections and bullets you change most, per track (Phase 3) | patterns feed back into the pipeline |
| Does editing pay off? | Reply / interview rate of edited vs generated resumes, per track (Phase 3) | needs a few weeks of outcomes |

## Changing things

- **Another track's general resume**: add it to `GENERAL_RESUMES` in `scripts/resume-builder.mjs` and to
  `GENERAL_RESUMES` in `src/apply/TodayPage.tsx`, add `data/baseline-jds/<track>.txt`, run
  `node --env-file=.env.tailor --env-file=.env scripts/general-resumes.mjs <track>`.
- **Rebuilding a general resume** replaces an edit made in the builder (it deletes `builder.json` and `generated/`).
- **A rule for bullets** (e.g. allow a repeated verb): `validate()` in `scripts/resume-builder.mjs`.
- **How long a render may take**: tectonic timeout in `renderDraft()` (120 s); the page waits 0.9 s after your last edit.
- **A job is re-tailored** (forced rebuild): the pipeline writes a new `pdf_path` and the edit stops being used;
  it's still in `edits/` and **Revert**/re-open finds the new generated resume.

## Deploy and roll back

- Frontend: `cd ~/atriveo-app-moods && git fetch origin && git checkout --detach origin/main && npm run deploy:apply`
- Server (the routes): an overlay of the running dashboard image with `scripts/tailor-server.mjs` and
  `scripts/resume-builder.mjs` (script given with each phase). Roll back with the previous `start-dashboard-*.sh` on
  the server.
- Tests: `node --test tests/review/resumeBuilder.test.mjs` (needs `tectonic` and `pdfinfo`).
