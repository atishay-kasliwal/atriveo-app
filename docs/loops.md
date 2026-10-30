# Loops

Say or type a thought once; Atriveo keeps it, has your Mac's Codex read it, asks you to confirm, then reminds you until you finish it.
Phase 1 (this change) is the backend and the Mac worker, with no UI. Phases: 2 the capture dock, 3 the /loops page, 4 Today + push action
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
