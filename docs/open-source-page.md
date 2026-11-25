# Open source page (apply.atriveo.com/open-source)

Your pull requests in other people's repositories, synced from GitHub, next to the resume bullets that cite them. Asked for
on 2026-11-25; the layout was approved from a mockup the same day. Linked from Resumes.

## What it shows
- **Board** (the default): Not covered, Draft ready, In the bank, and a strip for skipped and closed. Filters by status,
  rating, text; best or newest first. The pull request opens on the right with its rating, bullet and resumes, and one pie
  of resume-ready bullets (All, SWE, AI, DS, FS, FE, FDE); its legend filters the board.
- **By resume:** nine resumes. For each, the open source section it could print (three suggested: ready, best first,
  different opening verbs, two per company at most), swapped line by line, next to what the master prints today
  (TRACKS.yaml `general_pinned`). Below: what recent postings ask for, where the bullets come from, merges per day.
  Your selection stays in the browser; it never changes a resume. Masters change through TRACKS.yaml.
- **Analytics:** the counts per resume, then overall charts.

## Words
- **Rating** (`scripts/open-source-rating.mjs`): 0-10 from recognition, size, proof and status, with caps for docs, tiny or
  mechanical changes, and a point off for shared work. Impressive 8+, Good 6-7, Average below. You can set it by hand.
- **Ready** for a general resume: every pull request merged, rating Good or better, and not `oss.shared` in the bank.
- **In the bank:** a live bullet in `data/ac-bank` cites the pull request. Wording changes there (or on /bank), not here.
- **Draft:** a bullet you typed here, checked with the bank's rules. It prints nowhere until it is reviewed into the bank.
- **Areas** (backend, full-stack, frontend, platform) are labels in the bank (`areas:`); selection never reads them.

## Sync
- `scripts/open-source.mjs` `syncOpenSource`, into Mongo `oss_prs`. `gh.*` is replaced by each sync; `mine.*` is yours and
  is never touched. `oss_state` keeps the last result and the posting counts (once a day, from the jobs still stored).
- The **Sync from GitHub** button starts one and the page polls; a full sync takes about 40 seconds. The after-scrape loop
  runs `scripts/open-source-sync.mjs --if-older 60`, so it also happens hourly.
- **OSS_GITHUB_TOKEN** (optional; a fine-grained token with read-only access to public repositories) gives sizes, stars and
  authorship. Without it a sync reads status and dates only: known pull requests keep their ratings, new ones show "Not rated".
- The account is `github_user` in `data/ac-bank/PROJECTS.yaml`. Descriptions are read for the rating and not stored.

## API (tailor-server, under /resume-builder/)
`GET oss`, `POST oss-sync`, `POST oss-save {id, rating?, text?, fits?, skip?}`, `POST oss-add {url, title, state, date}`,
`POST oss-delete {id, restore?}`, `POST oss-check {text}`. A deleted pull request stays in Mongo so a sync can't bring it back.

## Tests
`tests/review/openSourcePage.test.mjs` (rating, sync, edits, view) and `npm run test:open-source:browser` (the built page).
