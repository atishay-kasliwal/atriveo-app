# Network page (`/network`)

The people around the job search: who they are, where they came from, what happened, and when to follow up.

## What it stores (Mongo `job_pipeline`)

| Collection | What |
|---|---|
| `network_people` | A person: name, role, city, email, LinkedIn, phone, notes, `sourceId` (where they came from), `via` (who introduced them), colour, follow-up date, history, map position, archived |
| `network_sources` | Where people come from: company, staffing agency, event, family or other; optional parentSourceId and context. Identity is name + parent + context |
| `network_links` | Your own connections between two people (or a person and a source), one per pair |
| `network_board` | The free layer on the map: text boxes, sticky notes, pen strokes, images, groups, work items |
| `network_images` | Image and GIF bytes (PNG, JPEG, GIF, WebP, under 2.5 MB) |
| `network_mail_log` | Every email sent from the page |
| `network_drafts` | AI drafts while they are written (kept a day) |
| `network_snoozes` | Snoozed reminders |
| `network_maps`, `network_map_cards` | Maps other than My network: name, preview, where You sits; and which people and sources are on each, and where |
| `app_settings` `network_you`, `network_mail` | Where "You" sits on the map; the sender name, address, "about you" and signature |

Nothing here is in the repository. Tests use invented people.

## Canvas workspace

The map fills the viewport below navigation. Compact floating controls open layers/filters, search, add/import actions, people and jobs views. Details and views overlay the map without resizing it. Board tools, pan, zoom and saved positions use the existing graph implementation. Layer visibility and source stacks are presentation controls; they never delete or rewrite people. Expand a stack by click or Enter; Collapse stacks restores the overview.

Add Person asks for Company / employer independently of its source (for example, Family). That employer drives the existing jobs/application matching. Staffing sources also act as employer fallbacks, like company sources.

## Separate source contexts

Two records can both be named Randstad: one direct connection, another introduced through All Things Open. Create the second with **Introduced through another source → All Things Open**. Add **Context / when you met** for labels such as “Reached out last year.” Parent/context fields are available in source editing and inline source creation while adding/importing people. Pickers show the context and parent so the records are distinguishable.

The graph connects the child source to its parent with an introduction line. Each record keeps its own ID, colour and people; company matching still uses the original employer name, so jobs aren't duplicated just because two contexts name the same company. Existing sources remain direct roots. No migration is needed. Self-parenting and cycles are rejected; deleting a parent preserves its child sources and their people.

## Source cards and links

Companies and staffing agencies show a logo on white, where they are (Details → Where), the faces of up to three of their people and a
count. Events are tickets with a date (Details → When). Family people carry a small house tag. A source's **Connected** tab links it to
another source or a person (Randstad and the conference where you met them) without changing where it came from.

## Companies nobody added

When two or more people share a "Works at" (Dana met at All Things Open, Priya introduced by Chani, both at Randstad) and no company or
agency card matches it, the map shows a dashed Randstad card linked to each of them by a "works at" line. Their sources, introducers
and colours stay as they are; the warm path can go through the company. It is worked out each time and never saved: it goes when one of
them moves on, and **Keep as a source** in its panel makes it a real card (logo, place, notes, links). A company with one person gets no card.

## Maps

/network opens on your maps: cards with a preview, **New map** and **Open a saved file** (or drop the .json file on the page).
**My network** (id `main`) is the map you already had: everyone, with the layout people and sources carry themselves. Any other map is
a selection of the same people and sources (`network_map_cards`: which cards are on it and where), with its own board
(`network_board.mapId`) and its own place for You (`network_maps`). Editing a person or source changes them on every map; adding someone
on a map also adds them to your network. On a map, **+ → From your network…** puts people (or a source with its people) on it, and a
person's **⋯ → Remove from this map** takes them off without archiving them. Deleting a map removes its layout, board and preview only.

**Open a saved file** turns a copy made with Export → Save a copy into a new map. Sources match on name, kind and context; people on
email, then LinkedIn, then name. Matches are reused exactly as they are; everything else is added with its layout, links, introducers
and board. Pictures are not in the file, so photos and board images are left out. A preview of each map is saved when you go back to
all maps. Links from notifications and the extension (`?person=`, `?work=`, `?view=`, `?linkedin=`) open My network.

## Export

**Export** (next to Fit, or Ctrl/Cmd+Shift+E), like Excalidraw's: PNG, SVG or Copy to clipboard (PNG), with a preview and the options
Only selected (when cards are selected), Background, Dark mode and Scale 1x/2x/3x, plus a file name. Pictures are embedded, hover and
editing controls are left out, and nothing is faded. **Save a copy (.json)** downloads the whole map: people, sources, links, the board
and positions (it holds contact details, so keep it private). Open it again from the maps page as a new map.

## Colour rule

A source has one colour, and every first connection from it shares it. Someone introduced by another person starts their own branch:
a colour of their own (never close to a source's hue) and a small dot in the source's colour. Anything picked by hand wins.

## How a source came to you

A source comes straight from you, through another source (a separate Randstad met through All Things Open), or through a person (NKHS,
introduced by Chani). Through a person, the map draws that person to the source, and the source's own people still belong to the
source, not to the person; only someone marked "introduced by Chani" hangs off Chani. A person cannot belong to a source they introduced
(that would loop back to them): keep their own source and set "Works at". If the introducer is archived, the source comes straight from you.

## Email

Sent from your Gmail through the send-only connection Outreach sets up (`PLAYATRIVEO_HOME/gmail-send-token.json` with
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), only when you press Send. "Write to all" still has one Send per person.
Draft with AI goes through the same path as application answers (`RESUME_AI_REMOTE_WORKER=mac` uses the Mac AI worker).

## Reminders

On the page: a reply waiting for your answer, follow-ups due or late, work ending within a week or late, people quiet for two weeks,
and sources whose people have never heard from you.

On the phone, at 9 a.m. New York daily and a weekly digest on Sunday from 6 p.m.:

- **Web Push** (the Atriveo app on your phone, see `docs/WEB_PUSH.md`) when `VAPID_*` and `PUSH_EVENT_USER_ID` are set. It goes only
  to your own devices, encrypted, so it names people ("Follow up with Dana today"), and a tap opens them (`/network?person=…`,
  `?work=…`, or `?view=due` when several need you).
- **ntfy** (`NTFY_TOPIC`) otherwise, counts only, since an ntfy topic is readable by anyone who knows its name.

`NETWORK_PUSH=both` sends to both, `NETWORK_PUSH=ntfy` keeps ntfy only. Turn Network's phone messages off with
`NETWORK_REMINDERS=off` (or `PHONE_SUMMARIES=off` for every phone message).

## Deploy

Website and the dashboard sidecar (`npm run ship`, answer `y` at the Oracle prompt). No migration: collections are created on first write.

## Tests

`npm run test:network:browser` checks desktop/mobile viewport geometry, floating panels, visibility, source stacks, company input, source context creation, pan/zoom and board tools against a local fake API.

`node --test tests/network.test.mjs tests/network-colors.test.mjs tests/network-mail.test.mjs tests/network-reminders.test.mjs tests/network-board.test.mjs`
