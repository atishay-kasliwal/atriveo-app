# Sequential Open & Fill

Today offers checkboxes for eligible **You submit** applications, **Select all You submit**, and **Open & Fill selected**. Select all covers eligible applications across pages, not only visible cards.

The queue rechecks each application's eligibility and record version, arms it through the existing Open & Fill action, then asks Atriveo Fill to open its supported ATS application page. It waits for a new persisted fill report belonging to the new arm before advancing. Each filled tab remains open for your review. The queue never approves or submits an application.

- **Pause after current** finishes the current fill and waits before opening the next.
- **Resume queue** continues the selected snapshot.
- A failed action, extension failure, missing completion report (three-minute timeout), or fields requiring attention pauses the queue. Inspect that tab before choosing **Skip & continue**.
- **Stop queue** stops further openings. An already opened form may finish filling; its tab stays open.
- Keep the dashboard open. Leaving the view stops queue orchestration. It does not silently resume after reload.
- Old fill reports never count as completion of a new queue entry. Server timestamps are compared with each other, avoiding dependence on the user's system clock.

## Extension update

Requires Atriveo Fill 0.2.2. The local bundle is built with `npm run extension:build` in playatriveo. Existing unpacked installations must be reloaded once in `chrome://extensions`, then the dashboard reloaded. Existing credentials remain in extension storage.

## Verification

`npm run test:open-fill-queue` runs isolated browser scenarios with mock records and blocked external requests: sequential success, failure pause, stop, and old-extension refusal. It uses Chrome and Playwright from the local playatriveo checkout; set `PLAYATRIVEO_ROOT` if that checkout is elsewhere.

Backend tests cover trusted dashboard opening, destination restrictions, regular single-application compatibility, and the existing Ashby/Lever manual-fill submission boundary. No real applications are processed by these tests.

## Verified forms: alternative browser fill

Today offers Open & Fill beside Approve submit for certified Greenhouse, Ashby, and Lever forms. It requires successful validation, CERTIFIED final-form evidence, an unchanged resume hash, no previous submission attempt, and no queued submission approval. Awaiting answer review or worker verification remains blocked. Greenhouse requires Atriveo Fill 0.2.3 and supports hosted job-board pages. The extension reports newly exposed required fields for human attention and never clicks Submit. Engine submission configuration is unchanged.
