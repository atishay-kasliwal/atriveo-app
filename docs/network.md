# Network page (`/network`)

The people around the job search: who they are, where they came from, what happened, and when to follow up.

## What it stores (Mongo `job_pipeline`)

| Collection | What |
|---|---|
| `network_people` | A person: name, role, city, email, LinkedIn, phone, notes, `sourceId` (where they came from), `via` (who introduced them), colour, follow-up date, history, map position, archived |
| `network_sources` | Where people come from: a company, an event, family, other. Unique by name |
| `network_links` | Your own connections between two people (or a person and a source), one per pair |
| `network_board` | The free layer on the map: text boxes, sticky notes, pen strokes, images, groups, work items |
| `network_images` | Image and GIF bytes (PNG, JPEG, GIF, WebP, under 2.5 MB) |
| `network_mail_log` | Every email sent from the page |
| `network_drafts` | AI drafts while they are written (kept a day) |
| `network_snoozes` | Snoozed reminders |
| `app_settings` `network_you`, `network_mail` | Where "You" sits on the map; the sender name, address, "about you" and signature |

Nothing here is in the repository. Tests use invented people.

## Colour rule

A source has one colour, and every first connection from it shares it. Someone introduced by another person starts their own branch:
a colour of their own (never close to a source's hue) and a small dot in the source's colour. Anything picked by hand wins.

## Email

Sent from your Gmail through the send-only connection Outreach sets up (`PLAYATRIVEO_HOME/gmail-send-token.json` with
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), only when you press Send. "Write to all" still has one Send per person.
Draft with AI goes through the same path as application answers (`RESUME_AI_REMOTE_WORKER=mac` uses the Mac AI worker).

## Reminders

On the page: a reply waiting for your answer, follow-ups due or late, work ending within a week or late, people quiet for two weeks,
and sources whose people have never heard from you. On the phone (ntfy, `NTFY_TOPIC`): counts only, at 9 a.m. New York daily and a
weekly digest on Sunday from 6 p.m. Turn off with `NETWORK_REMINDERS=off` (or `PHONE_SUMMARIES=off` for every phone message).

## Deploy

Website and the dashboard sidecar (`npm run ship`, answer `y` at the Oracle prompt). No migration: collections are created on first write.

## Tests

`node --test tests/network.test.mjs tests/network-colors.test.mjs tests/network-mail.test.mjs tests/network-reminders.test.mjs tests/network-board.test.mjs`
