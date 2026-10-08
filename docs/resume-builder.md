# Resume builder

`apply.atriveo.com/resume_builder`: change what a resume says without changing how it looks. You edit the
content (bullets, header title, skills); the pipeline's own renderer and compiler build the PDF, so the template
is always the same one every generated resume uses.

Started 2026-10-08. Status: **Phase 1 built, plus writing your own bullets and the live preview** (see [Phases](#phases)).

## How you use it

| Start from | How | What saving does |
|---|---|---|
| A Today card | **Edit** on the card (next to Resume) | The edited PDF becomes that job's resume: Fill, Easy Apply and the Resume button use it. **Revert to generated** undoes it. |
| A track's general resume | Today → **Resumes** → Edit, or the **Resumes** tab → pick SWE / AI / Data Analyst / DS / FDE | Replaces that general resume (Today's Resumes menu serves it). The generated one is kept for **Revert**. |
| A job description you paste | *Phase 2* | |

In the editor:

- **Bullets**: move (↑ ↓), **Swap…** for another bullet of the same employer or project (also another version of
  the same bullet, marked ↺), **✕** remove, **+ Add a bullet from the bank**.
- **Projects**: **Remove project**, **+ Add a project**, and the **tools after the name** ("Atriveo | FastAPI,
  Docker…"). Until you type in it, the tools line is picked from the project's bullets (as in generated resumes) and
  follows your swaps; once you type, your list is printed (up to 8). **Auto** goes back to the automatic one.
- **Header**: **Title**, **Email** and **Location** (printed as you write it, e.g. "Charlotte, NC"). They start as
  the resume prints them: your profile's email, and the posting's city (home city when it names none).
- **Technical skills** (one line each, `Category: a, b, c`).
- **Save** turns on when the compiled PDF passes every check.

### Writing bullets (three ways)

| You want | Do | What happens |
|---|---|---|
| Different words on **this resume only** | ✎ on the bullet → edit → **Use on this resume only** | The bank keeps its wording; the bullet shows "this resume only". |
| Different words **from now on** | ✎ → edit → **Save to bank (future resumes too)** | Your wording replaces that bank bullet's (that version of it) for every future resume. Resumes already built keep the old wording, which stays valid. |
| A **new bullet** | **+ Write a new bullet** in the section → **Add (saved to your bank)** | A new bank entry (`AC-U001`, …) for that employer or project, on this resume and offered to future ones. |

While you type, the rules' verdict shows under the box (RESUME_BULLET_GUIDE.md, the bank lint's own rules, in
`scripts/ac-bullet-rules.mjs`): 12–35 words, an approved action verb (not Built / Developed / Trained), at most two
"and" and two commas, no puffery, at most 3 technologies, no "research" at Stony Brook. **For the bank only**, the
opening verb must be one no other bullet that can share a resume uses; when it isn't, the box offers free verbs (click
one to swap it in). A this-resume-only edit needs a verb not used elsewhere on that resume.

### Live preview

One toolbar over the preview holds everything: **Live** / **PDF** tabs, the page chip, the PDF's page count, JD match,
and the buttons (**Revert**, **Download** the saved PDF, **Discard**, **Save**). There's no header bar; which resume
you're editing is the small line at the top of the left column. The whole page is always in view (scaled to fit the
column's width and height), so nothing scrolls on the right.

- **Live** is the resume as HTML in the template's layout (Letter, 0.5in margins, 11pt Computer Modern), paginated
  in the browser by [Paged.js](https://github.com/pagedjs/pagedjs). It updates as you type. The chip says how much
  room is left: **1 page ✓ · room for 3 more lines** (green), **1 page ✓ · full** (blue, 0–1 lines left), or
  **2 pages ⚠ · 2 lines over** (amber). A line is a bullet's line (10pt × 1.2 = 16px); most bullets are two lines.
  It measures the lowest line of text on the last page, so it mirrors the LaTeX template closely, not to the pixel.
- **PDF** is the compiled resume, the file Fill sends. It recompiles about a second after you stop, and its page count
  (**PDF 1 page ✓**) is the one that decides Save.

## Checks (every render; Save is refused unless all pass)

- **One page** (counted with `pdfinfo`; tectonic compresses page objects, so scanning the PDF undercounts).
- **Every bullet is from your bank**, under its own employer or project, and its text is one of that bullet's bank
  versions (Phase 1 has no free text).
- **No repeated opening verb** (the same rule the pipeline enforces: `assertUniqueCompositionVerbs`).
- **Email** looks like an email address.
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
- The header city follows the job's location, as in generated resumes, unless you set one.
- Two options of `assembleAcResume` exist for the builder only (the pipeline never sets them, so generated resumes
  are unchanged): `city` (the header city as written) and `project.stack` (a project's tools line). Email goes in
  through the `profile` option (your profile with that email).

### Where things are stored

| What | Where |
|---|---|
| Your bullets (new and reworded) | Mongo `bank_overlay`: `{ _id: "AC-U001", type: "new", ac }` or `{ _id: "AC-026:default", type: "reword", ac_id, facet, text, previous }`. Each machine copies it to a local file (`AC_BANK_OVERLAY`, default `<tmp>/atriveo-bank-overlay.json`) before reading the bank: the builder on every load/render, the resume workers before every build. `loadBank()` merges it over `data/ac-bank` (only the real bank dir) and adds `+u<fingerprint>` to `bank_version`, so cached resumes rebuild. |
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
| `scripts/resume-builder.mjs` | load / render / save / revert, the checks, `checkText` / `saveBullet` / `freeVerbs` (your bullets), `GENERAL_RESUMES` (track → folder) |
| `scripts/ac-bank-overlay.mjs` | your bullets: Mongo `bank_overlay` ↔ local copy, merged by `loadBank()` (`scripts/ac-bank.mjs`) |
| `scripts/ac-bullet-rules.mjs` | the bullet rules, shared by `ac-bullet-lint.mjs` and the builder |
| `scripts/tailor-worker.mjs` | refreshes your bullets (`syncOverlay`) before each build |
| `src/apply/ResumeLivePreview.tsx` | the Live tab (HTML in the template's layout + Paged.js in its own frame) |
| `scripts/ac-tex.mjs` | the renderer; `city` and `project.stack` options used only by the builder; `toolsFromBullets` exported |
| `scripts/tailor-server.mjs` | the `/resume-builder/*` routes (search "Resume builder") |
| `src/apply/ResumeBuilderPage.tsx` + `resume-builder.css` | the page |
| `src/apply/ApplyApp.tsx`, `ApplyHeader.tsx` | route `/resume_builder`, the **Resumes** tab |
| `src/apply/TodayPage.tsx` | **Edit** on cards, **Edit** in the Resumes menu |
| `src/apply/tracks.ts` | track labels shared by Today and the builder |
| `scripts/general-resumes.mjs` | builds the general resumes (keeps `composition.json`, so they can be edited) |
| `tests/review/resumeBuilder.test.mjs` | load → swap → render one page → save → reload → revert, and the refusals |
| `tests/review/resumeBuilderBullets.test.mjs` | rules, new bullet → bank, reword → bank (old wording still valid), this-resume-only edit, the pipeline composes with them |
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
| 2026-10-08 | **Project tools lines, header email and location are editable** (user asked). The tools line stays automatic until you type in it. |
| 2026-10-08 | **Live preview with Paged.js** (user asked), next to the compiled PDF. The PDF stays the one that's sent and that gates Save; making HTML the real renderer would be a separate decision. |
| 2026-10-08 | **One screen**: header bar removed, its buttons moved into the preview toolbar; the page is scaled to fit whole; a "room for N more lines" chip (user asked). Room is measured on the Live preview, not the PDF. |
| 2026-10-08 | **Three ways to write**: this resume only, reword for the bank, new bullet (always to the bank). Bank bullets keep the bank's rules, including a verb of their own. |

## Phases

1. **Edit with your bank** (built 2026-10-08): from a Today card or a track's general resume; move / swap / remove /
   add bank bullets, add or remove projects, project tools lines, title / email / location, skills; live preview;
   checks; save; revert.
2. **Your words** (built 2026-10-08, pulled forward): this-resume-only edits, rewording for the bank, new bullets
   saved to the bank, live rule checks with free-verb suggestions; Paged.js live preview. **Still to come:** paste a
   job description to start a resume; a script that exports your bullets into `data/ac-bank` YAML for git.
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
- **A rule for bullets** (e.g. allow a repeated verb): bank rules in `scripts/ac-bullet-rules.mjs` (the lint uses
  them too); what the builder adds (bank-wide verb, per-resume checks) in `checkText()` / `validate()` in
  `scripts/resume-builder.mjs`.
- **Undo a bank reword**: delete its `bank_overlay` document (`AC-xxx:<facet>`); its `previous` field has the old
  wording. A new bullet: delete `AC-Uxxx` (resumes that use it keep their PDF; re-opening them in the builder flags it).
- **How the Live tab looks**: the `CSS` in `src/apply/ResumeLivePreview.tsx` (sizes in pt, as in the LaTeX template).
- **How long a render may take**: tectonic timeout in `renderDraft()` (120 s); the page waits 0.9 s after your last edit.
- **A job is re-tailored** (forced rebuild): the pipeline writes a new `pdf_path` and the edit stops being used;
  it's still in `edits/` and **Revert**/re-open finds the new generated resume.

## Deploy and roll back

- Frontend: `cd ~/atriveo-app-moods && git fetch origin && git checkout --detach origin/main && npm run deploy:apply`
- Server (the routes): an overlay of the running dashboard image with `scripts/tailor-server.mjs` and
  `scripts/resume-builder.mjs` (script given with each phase). Roll back with the previous `start-dashboard-*.sh` on
  the server.
- Tests: `node --test tests/review/resumeBuilder.test.mjs` (needs `tectonic` and `pdfinfo`).
