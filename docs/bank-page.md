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
- `tests/review/bankPage.test.mjs` checks:
  - every pinned bullet is a live wording the page marks;
  - the desktop board fits one screen;
  - the filters work;
  - the phone layout.

## Phases

1. **Read-only page (this).**
2. Edit, retire, merge and pin from the detail panel, through the builder's checks (`checkText`, the unique-verb rule,
   `ac-bullet-lint`).
3. Needs your input: type the missing fact on the card; it goes to the fact sheet, and a new wording is drafted for
   review.

Next after v1:
- reply rate per bullet (applications × inbox replies);
- what job postings ask for per track that no bullet covers;
- facts stored once and linked from bullets, so a changed fact flags every bullet using it.
