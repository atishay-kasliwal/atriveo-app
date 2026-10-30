# Loops: deploy and live check

Phases 1 to 4 (backend, dock, page, Today strip, notification buttons) went out with `npm run ship` from `~/atriveo-app-deploy` on a clean
`origin/main` (Oct 30, commit b33c46fab): the dashboard and workers on Oracle first, the website last. Two things are separate from `ship`
and are set up once.

## 1. The Mac worker (reads captures with your local Codex)

Needs the Codex CLI signed in, and the tunnel the resume AI worker already uses (`com.atriveo.resume-ai-tunnel`, 127.0.0.1:18789). It reuses
`~/.playatriveo/resume-ai-worker.json` ({ base, token }) unless you create `~/.playatriveo/loops-worker.json` with the same shape plus
`"provider": "codex"` (or `"claude"`).

```
cd ~/atriveo-app-deploy && git fetch && git checkout --detach origin/main
npm run loops:worker:install            # copies the worker to ~/.playatriveo/loops-worker/ and starts com.atriveo.loops-worker
tail -f ~/.playatriveo/com.atriveo.loops-worker.log
npm run loops:worker:install -- --uninstall
```

The worker only makes outbound calls and asks for one waiting capture every ten seconds. If the Mac sleeps, captures wait ("Waiting for your
Mac · last seen …" on the page) and nothing is lost.

## 2. The transcriber (voice → text, on Oracle, slow on purpose)

Without it, a voice capture stays RECORDED (the page offers "Type what you said"). The transcriber is its own container: whisper.cpp
(pinned v1.9.5) with `ggml-small.en` (pinned by SHA-256), converted with ffmpeg, one recording at a time at `nice 19`, limited to 1 CPU and
3 GB. It never sends audio anywhere. Waiting hours is fine.

```
cd ~/atriveo-app-deploy && git fetch && git checkout --detach origin/main
npm run ship:transcriber -- --dry-run   # the plan, nothing touched
npm run ship:transcriber                # build (one job, low priority: expect 15 to 40 minutes) and start atriveo-loops-transcriber
npm run ship:transcriber -- --stop      # remove it; recordings just wait
```

It does not touch the dashboard, the workers or the website. The build shares the VM's 2 OCPU with Mongo, so it runs with one job at low
priority; start it when you are not applying in bulk. Logs (counts only, never a transcript): `docker logs atriveo-loops-transcriber`. A
recording stuck in TRANSCRIBING (the container was restarted) returns to the queue after 45 minutes. Transcription failing keeps the audio and
shows "Try again" or a box to type the words.

## 3. Check it live (about five minutes)

1. Open apply.atriveo.com and press Ctrl/⌘+Shift+Space. Type "Remind me to message Sarah at NVIDIA about the software engineer role", press Enter.
   Expect "Kept." and the thought under **Waiting for your Mac** on `/loops`.
2. With the Mac worker running, within about a minute it moves to **Needs review**. Fix anything, set the interval, Confirm.
3. Make it due now to see a reminder without waiting six hours (Mongo shell or Compass, `captures` collection): set that capture's
   `reminder.nextAt` to a past date. Within a minute you get the notification; try its Done and Snooze buttons on desktop Chrome or Android. On
   iPhone you get the notification and tapping it opens the capture.
4. If no notification arrives: Settings → push "Send test notification". Push needs the VAPID keys and `PUSH_EVENT_USER_ID` in the dashboard env
   (not verified in production before Loops). Reminders are logged on the capture's Activity: "Reminder skipped: no device is subscribed" or
   "Reminder couldn't be delivered" tells you which part is missing.
5. Voice (after the transcriber is up): record a short clip. It shows "Recording saved. It will be transcribed in the background", then moves on to
   the Mac like a typed one.

## Roll back

`npm run ship -- --rollback` puts the previous dashboard and workers back (Loops then 404s on the server and the dock saves captures on the device
until it returns). Roll the website back in Cloudflare Pages (atriveo-apply, Deployments, Rollback).
