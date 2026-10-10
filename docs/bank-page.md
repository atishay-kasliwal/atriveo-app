# Bank page (apply.atriveo.com/bank)

One screen for the whole resume bullet bank (`data/ac-bank/AC-*.yaml` plus your builder bullets from Mongo
`bank_overlay`). Asked for on 2026-10-09; layout chosen from three mockups: the board, with a detail panel.

## What it shows

- **Top bar:** how many live wordings score 9+ out of all live wordings (the `strength` field, out of 10), and the
  bank version.
- **Filters:**
  - Track: All / SWE / AI / DS / Data Analyst / FDE.
  - Under 9.
  - Retired.
  - Search (`/` to focus, Esc to clear).
  - Track, Under 9 and Retired are remembered in localStorage (`bank-filters`).
- **Needs your input:** the four lowest-scoring bullets under 9, with the total count. Each one needs a real number
  or result from you.
- **Five columns:** Stony Brook, Wake Forest, Accolite, Atriveo, and Projects (every other project). Each card shows:
  - its lowest score;
  - its id;
  - how many wordings it has;
  - the tracks whose tested resume prints it (TRACKS.yaml `pinned` and `pinned_variants`).
- **Track filter:** with a track picked, the board keeps only the wordings that track can use (bankForTrack's rule:
  untagged wordings are on every track). The bullets that track's resume prints come first.
- **Detail panel** (click a card; Esc or × closes it):
  - the fact behind the entry, and the date you confirmed it (`provenance`);
  - every wording with its score and its track tag (Every track, or "FDE only");
  - "Printed on" with the track and set (e.g. "FDE · infrastructure").
- **Phones:** the columns stack and the page scrolls; the detail opens as a full-screen sheet.

## Files

- `scripts/bank-page.mjs`: `bankView()` shapes `loadBank()` and `TRACKS.yaml` for the page. A bare id in a pinned set
  means the entry's first wording, as in `applyTrackPins`.
- `scripts/tailor-server.mjs`: `GET /resume-builder/bank` reads files only, with no Mongo.
- `src/apply/BankPage.tsx` and `src/apply/bank.css` are the page; the route and the "Bank" nav link are in
  `ApplyApp.tsx` and `ApplyHeader.tsx`.
- Editing (phase 2), in the detail panel:
  - **Edit:** the builder's live rule check (`POST /resume-builder/check`) and save (`POST bullet`, mode `reword`): your
    wording replaces that wording for every future resume, through the Mongo overlay. The old score stays, tagged
    "Edited · score is from before", until it is re-scored.
  - **Retire / Restore:** `POST /resume-builder/bank-retire {acId, facet?, reason?, restore?}` writes or deletes an
    overlay entry `{ type: "retire" }`; `applyOverlay` gives the entry or wording the `retired` track no resume uses.
    A wording a track's tested set prints can't be retired (change TRACKS.yaml first). Only retirements made on the page
    can be restored there.
  - `npm run bank:export` writes rewords and retirements into the YAML (`tracks: [retired]`, plus a "# Retired …"
    comment on an entry); you review and commit.
  - Pinning isn't on the page on purpose: the pinned sets are blind-tested, so they change through TRACKS.yaml and a test.
  - **Where it applies:** every resume builder that reads the overlay (both Oracle workers and the Mac tailor-worker)
    needs `ac-bank-overlay.mjs` from this change, or it ignores retirements.
- Giving a missing fact (phase 3), `scripts/bank-draft.mjs`:
  - **Give the missing fact** on a wording (the main button when it has a note): what you type is saved at once as an
    overlay `fact` (shown under "Fact behind it"; exported to the entry's `user_facts`).
  - `POST bank-draft` starts a job (Mongo `bank_drafts`, kept a day): your Mac AI worker (the resume builder's queue,
    `RESUME_AI_REMOTE_WORKER=mac`) drafts 2 wordings from this entry's facts only, each scored on the rubric. The page
    polls `POST bank-draft-result`.
  - Every draft goes through `checkText` (the builder's rules) and a number check: a number none of the facts or
    existing wordings state blocks the draft, here and again on save.
  - **Use this wording** (`POST bank-approve`): the builder's reword save, then an overlay `score` with the rubric
    total; at 9+ the note clears. The export writes `strength` and `strength_note`.
  - A real run (AC-196, no new fact) took 13 s; both drafts scored 8, since without a result impact stays at 1.
- `tests/review/bankPage.test.mjs`, `bankPageEdit.test.mjs` and `bankPageDraft.test.mjs` check:
  - every pinned bullet is a live wording the page marks;
  - the desktop board fits one screen;
  - the filters work;
  - the phone layout;
  - retire/restore in Mongo, the tested-set guard, the export, and the edit/retire controls;
  - the number check, the fact → drafts → use flow (with a fake model), its export, and the page's draft picker.

## Phases

1. Read-only page (live 2026-10-10).
2. Edit, retire and restore from the detail panel (live 2026-10-10). A merge is a retire with "merged into AC-…".
3. **Give the missing fact; Claude drafts; you pick (this).**

Next after v1:
- reply rate per bullet (applications × inbox replies);
- what job postings ask for per track that no bullet covers;
- facts stored once and linked from bullets, so a changed fact flags every bullet using it.
