# atriveo-app — Claude instructions

## Resume Engine Link
This project is linked to the resume-tailoring engine at:

`/Users/atishaykasliwal/atriveo-app/resume-engine`

When the user pastes a job description or asks to build/tailor a resume, treat that
folder as the engine. Do NOT improvise a resume here. Follow its system exactly:

1. Read the engine rules first, in this order:
   - `/Users/atishaykasliwal/atriveo-app/resume-engine/CLAUDE.md`
   - `/Users/atishaykasliwal/atriveo-app/resume-engine/Memory/RULEBOOK.md`
   - `/Users/atishaykasliwal/atriveo-app/resume-engine/Memory/QUESTION_ANSWERS.md`
2. Use the engine's bullet bank as the only source of bullets:
   - `/Users/atishaykasliwal/atriveo-app/resume-engine/Memory/experience.md`
   - `/Users/atishaykasliwal/atriveo-app/resume-engine/Memory/RAW_POINTS_HUB.md`
3. Screen work authorization / sponsorship / clearance / years-of-experience FIRST.
   If hard-blocked, mark `No Go`, log it, and stop. Do not draft.
4. Give a fit summary and ask before full drafting. Never auto-build on JD paste.
5. Write the tailored resume INTO the engine project, never here:
   `/Users/atishaykasliwal/atriveo-app/resume-engine/tailored/YYYY-MM-DD/NN-company-role/resume.tex`
6. The engine's compile hook builds `Atishay Kasliwal.pdf` automatically on `.tex` write.
7. Log the run to the engine's `Memory/JD_RUNS/`.

The engine's rules (truth-only, fixed structure, heading stacks, one page, 9+/10 bullets,
single-line skills, no Research suffix on Stony Brook) are authoritative. This file only
points to them; it does not restate or override them.

## This project (atriveo-app)
Normal app development tasks here are unrelated to the resume engine. Use the resume
engine only for resume/JD work.
