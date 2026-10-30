# Loops

Say or type a thought once; Atriveo keeps it, has your Mac's Codex read it, asks you to confirm, then reminds you until you finish it.
Phase 1 is the backend and the Mac worker; Phase 2 is the capture dock and Phase 3 the /loops page, Phase 4 the Today strip, notification buttons and links, and Phase 5 transcription and deploy (all below; the runbook is `docs/loops-deploy.md`). Phases: 2 the capture dock, 3 the /loops page, 4 Today + push action
buttons + Network links, 5 transcription provider and deploy runbook.

## The loop

```
typed text ───────────────────────────────┐
voice → audio saved (RECORDED) → transcript┴→ WAITING_FOR_CODEX → (Mac worker) PROCESSING → NEEDS_REVIEW → confirm → ACTIVE ⇄ SNOOZED → COMPLETED
                                                                                                  └→ DISMISSED          └ reminders every N hours
```

States: RECORDED, TRANSCRIBING, WAITING_FOR_CODEX, PROCESSING, NEEDS_REVIEW, ACTIVE, SNOOZED, COMPLETED, DISMISSED, FAILED. The state
machine is in `scripts/loops.mjs` (`NEXT`); every write is one atomic Mongo update guarded by the current state.

## Data

- `captures`: the original input (`text`, or `audio` + `transcript`; never overwritten), `structured` (Codex's reading), `view` (what you
  confirmed or corrected), `tasks`, `links` (matched company / person / job, plus the candidates offered), `reminder` ({intervalHours, nextAt,
  lastAt, count}: no future rows exist), `lease` while the Mac holds it.
- `capture_events`: append-only story (captured, transcribed, claimed, processed, edited with before/after, confirmed, reminder_sent /
  reminder_failed / reminder_skipped, snoozed, completed, …).
- `loop_audio`: GridFS bucket for recordings. `app_settings` `loops:settings` ({quiet:{from,to}, intervalHours}) and `loops:worker` (last seen).

## Mac worker

`node scripts/loops-mac-worker.mjs` with `~/.playatriveo/loops-worker.json` = `{ "base": "<dashboard url>", "token": "<TAILOR_TOKEN>", "provider": "codex" }`.
It only makes outbound calls: `claim` (a lease of 2 minutes, kept alive by `heartbeat`), then `complete` or `fail`. Codex gets the thought as
data with no tools (`scripts/loops-schema.mjs`: the prompt, the strict JSON schema, and the validation the server repeats). A bad answer
never reaches review: it counts as a failed attempt. After 3 attempts a capture is FAILED (kept, with a Retry). A Mac that sleeps mid-capture
loses its lease and the capture goes back in the queue. Nothing needs the Mac to be online.

## Reminders

`pollPushEvents` (every minute) calls `tickReminders`: for each ACTIVE/SNOOZED capture with `reminder.nextAt <= now` it claims the row by moving
`nextAt` in the same atomic update (so two ticks never both send), sends one Web Push, then sets `nextAt = now + interval`. A failed push
is retried in 5 minutes. Quiet hours (default 22:00–08:00 New York) push `nextAt` to the morning. Done completes the capture and stops reminders; Snooze sets `nextAt`.

## API (sidecar)

User routes need `X-Atriveo-User` (set by `functions/api/loops/[[path]].ts` after the sign-in cookie check): `GET /loops?section|status|q|from|to`,
`GET /loops/summary`, `GET /loops/<id>` (with events), `GET /loops/<id>/audio` (Range), `POST /loops/capture {id, text}`,
`POST /loops/capture/audio?id=&durationMs=` (raw audio body), `POST /loops/<id>/confirm|edit|done|snooze|dismiss|retry|reopen|transcript`.
Worker routes: `POST /loops/worker/claim|heartbeat|complete|fail` (token only).

## Not in Phase 1

No UI; no transcription provider (`transcribePending(db, provider)` is the interface; with none configured, recordings wait as RECORDED);
no service-worker action buttons. Tests: `npm run test:loops`.

## The capture dock (Phase 2)

`src/apply/CaptureDock.tsx` (mounted once in `Console`, so it is on every signed-in screen), `src/apply/loops.ts` (API + on-device queue),
`src/apply/capture-dock.css`.

- **Rest:** a 36 px hairline ring, bottom-right, 96 px above the bottom edge (clear of the resume page's AI Help button and the Today footer).
  Unfinished intentions show as a small number beside it; when one is past its reminder time the dot breathes in the primary colour. No badge.
- **Open:** it grows in place from the ring (no modal, nothing dimmed) into "What's on your mind?" with a text box and **Speak**.
  Enter captures, Shift+Enter is a new line, Esc closes (a typed draft is kept for the tab). Ctrl/⌘+Shift+Space opens it with the box focused
  (no existing shortcut uses it); pressing it again closes it. The unfinished list (up to three, with Done / Remind in 6h) sits under the box.
- **Speak:** the box becomes a live waveform and timer with Cancel and Finish (5 minute cap). Chrome records WebM/Opus, Safari MP4/AAC.
  No microphone, permission blocked, or a recorder error: "Mic unavailable. Type it instead." and the box stays.
- **Never lost:** every capture is written to IndexedDB (`atriveo-loops`) first, sent with a client-made id (so a retry is the same capture),
  and removed only when the server confirms. If Atriveo is unreachable it says "Saved on this device." and retries every minute and when the
  browser comes back online. A capture the server refuses (not a network failure) is not kept and the message is shown.
- Tests: `npm run test:loops:browser` (headless Chromium against the built console with a stand-in `/api/loops`: every screen, shortcut,
  typing, voice with a fake microphone, no microphone, permission denied, server down then recovered, the unfinished list, a phone viewport).

## The Loops page (Phase 3)

`src/apply/LoopsPage.tsx` + `loops-page.css`, route `/loops`, a "Loops" link in the console nav, an "All loops" link in the dock. `/loops?id=<id>`
opens that capture (the notification deep link).

- **List (left):** unfinished intentions first, in the order Needs action, Needs review, Waiting for your Mac (recorded, transcribing, waiting,
  reading, failed), Completed, Dismissed. Plain rows with hairlines, no cards. The line under the title says where things stand and when your Mac
  was last seen. Search (company, person, role, any words in what you said or the tasks; `/` focuses it) and Filters (status, date range)
  turn it into one flat result list across every state and the full history.
- **Story (right):** the state and next nudge, then what applies: **Check what I understood** (company, role, person, summary, tasks, matches
  from Network/jobs, the reminder interval; one Confirm that saves only what you changed, then confirms), **To do** (per-task check, Done, Remind
  me in…, Not doing this), or honest waiting copy ("Waiting for your Mac · last seen 3h ago", "Recording saved", a failure with Try again and,
  for a failed transcription, a box to type what you said). Below: the original thought (audio player, transcript on demand), Understood as,
  and Activity: a day-grouped timeline of everything that happened (captured, read, edited, confirmed, each reminder, snoozes, completion).
- **Phone:** the list and a capture each take the whole screen, with a back link.
- Tests: `npm run test:loops:browser` (now includes `page.browser.test.mjs`: sections and states, story, finishing, snooze, review and
  confirm in one step, search and filters, retry/type/reopen, empty and unknown ids, nav and phone).

## Today, notifications, links (Phase 4)

- **Today "Do now"** (`LoopsDoNow.tsx`): one slim row above Today's cards, only when something is open: up to three unfinished intentions
  (reminder due first, then longest waiting) with Done and Later (6 h), a link to each, and "All loops". It has its own small
  `/api/loops/summary` fetch (every minute while the tab is visible), so Today's cards never wait for it; nothing is shown when Loops is empty or unreachable.
- **Notifications:** a Loops reminder is "Atriveo / Still open: <task> / Company · Role / Waiting 18h", tag `loop:<id>` (a new reminder replaces the old
  one), deep link `/loops?id=<id>`, and Done / Snooze 6h buttons (`actions` in the payload, passed through `safeActions` in `web-push.mjs`).
  `apply-public/sw.js` runs a button by calling `/api/loops/<id>/done|snooze` with your sign-in cookie; if that fails (signed out, offline) it
  opens the capture instead. Platforms that don't show buttons (iOS Safari) just get the tap, which opens the capture. Test it for real with a
  confirmed capture whose `reminder.nextAt` you move into the past.
- **Links:** a capture stores ids (`links.linked.personId / sourceId / jobUrl`, chosen at review). `GET /loops/<id>` also returns their names, shown on
  the page as "Linked in Atriveo". `GET /loops/related?personId=|sourceId=` returns the counts per state and the latest five thoughts tied to a person or
  company, ready for Network to show "Sarah: 3 thoughts, 2 done". That Network view is not built (kept out of v1).

## Transcription (Phase 5)

`scripts/loops-transcribe.mjs` (provider: `whisperCppProvider`, `providerFromEnv`) behind `transcribePending(db, provider)` in `loops.mjs`.
`scripts/loops-transcriber.mjs` is the process that runs it: every 30 s it takes one RECORDED capture, converts the audio with ffmpeg to 16 kHz
mono, runs `whisper-cli` at `nice 19` (ggml-small.en), and moves it to WAITING_FOR_CODEX with the transcript, the same pipeline as typed text.
Whisper's noise markers ("[BLANK_AUDIO]") are removed; silence fails the capture kindly (audio kept, "Try again" or type the words). A transcriber
killed mid-recording is recovered after 45 minutes. With no engine configured the process stays up and says so. Another engine is one more
provider with `{ name, transcribe(buffer, mime) }`. Deploy: `deploy/loops-transcriber/Dockerfile`, `scripts/ship-loops-transcriber.sh`.
The Mac worker has a LaunchAgent installer: `scripts/install-loops-worker-service.mjs`.
