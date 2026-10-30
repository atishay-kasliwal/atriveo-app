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

The map fills the viewport below navigation. Compact floating controls open layers/filters, search, add/import actions, people and jobs views. Details and views overlay the map without resizing it. Board tools, pan, zoom and saved positions use the existing graph implementation. Dragging a card brings everything under it (a source its people and sub-sources, a person their introductions); hold Alt to move only that card. Layer visibility and source stacks are presentation controls; they never delete or rewrite people. Expand a stack by click or Enter; Collapse stacks restores the overview.

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

**Keep off My network.** Tick it next to **Open a saved file** (or a file can say `"separate": true`) and what the file adds belongs to
the new map only: its new people and sources carry `mapOnly: <map id>`, My network and the "From your network…" picker leave them out,
and the map shows them. People you already had are reused exactly as they are and stay on My network. `GET /network?everything=1`
returns everyone including these (the Day plan reads it). For a file opened before this existed, `scripts/network-ato-companies.mjs`
does the same for the ATO 2026 map (dry run by default, `--apply` to change), and also gives each employer its own card and colour
under the event and moves each person onto their employer's card. Big events lay out as cells: each employer with its people beside it.

## Export

**Export** (next to Fit, or Ctrl/Cmd+Shift+E), like Excalidraw's: PNG, SVG or Copy to clipboard (PNG), with a preview and the options
Only selected (when cards are selected), Background, Dark mode and Scale 1x/2x/3x, plus a file name. Pictures are embedded, hover and
editing controls are left out, and nothing is faded. **Save a copy (.json)** downloads the whole map: people, sources, links, the board
and positions (it holds contact details, so keep it private). Open it again from the maps page as a new map.

## A source that reached you more than once

Red Hat through your uncle in 2024, then All Things Open in 2026: keep one Red Hat. Its **Introduced** tab has the main way in
(Introduced through, with the year it happened) and **Also introduced by**: more people or sources, each with a year. The main one
places the card; each extra one draws an "also introduced · 2026" line, shows in the trail ("You › Uncle 2024 › Red Hat, also All
Things Open 2026") and counts for the warm path. Someone you met at the conference keeps All Things Open as their source and Red Hat
as Works at.

## Kinds of source

Company, Staffing agency, Event, Online assessment (OA), LinkedIn reach-out, Day, Family, Other, or **Something else…** with a name
you type ("Hackathon", "Discord community"), shown on the card. A **LinkedIn reach-out** source (or one named "LinkedIn…") holds a
card per day: **Add today's reach-outs** makes or reuses today's card (New York time) and opens Add a list on it; the extension's
LinkedIn button adds people to today's card; **Sort N into day cards** moves people sitting straight on it into the day they were
added. A **Day** source is named after its date unless you name it.

## Network Intelligence dock

A persistent tab at the bottom right of the maps home and canvas shows a count of actionable items. It expands upward into a floating
400 px feed; the canvas keeps its full width. The server remembers expanded/minimized state across logins. The top three items appear
first, with View all for the rest. On a custom map, the relationship feed is limited to people, sources and work on that map; assessments remain visible on every map.

The feed combines company openings (including staffing), recent applications with no logged contact since applying, replies, follow-ups
already due or coming in the next seven days, introductions, quiet relationships, and dated work. These are facts from Network and the
existing jobs query, not AI-generated fit scores. Openings use the existing 45-day job-board window and query limits. A first connection
is preferred for the suggested contact; this is not a scored claim about relationship strength. Future work uses recorded start/end
dates, not inferred meetings or invented times.

Selecting a card keeps the dock open, frames its connection path and fades unrelated graph cards. Company cards can be suggested for
one connection while its opportunity is focused, without changing saved sources. Job details and external role links appear inside the
dock. People, sources and work use their existing panels, and Draft message opens the existing composer; it never sends automatically.

Assessment cards read the existing open assessment records, even when you do not know anyone at the company. They count remaining
New York calendar days (6, 5, 4, 2, tomorrow, today), display the exact recorded deadline with EST/EDT, and rank more urgently as the
deadline approaches. A missing deadline is labeled unknown, never assumed to be noon or end of day. Open assessment links to that
specific row on the Assessments page. Mark completed updates the real record, removing it from both views and future assessment
reminders. Snoozes cannot extend beyond the deadline day; an expired deadline is described as passed. The existing one-day overdue
visibility window still applies. Changed deadlines create a fresh item so an extension is not hidden by an old dismissal.

Unselected connection lines are subdued and slightly thinner. Hovered/selected connections and an Intelligence-focused path remain bright.

Discovered items can be acted on immediately. Unreviewed company opportunities become Actionable after two days from first seeing them;
waiting replies, late follow-ups and recent applications without contact receive higher priority. Reviewing a card is remembered. These
stages rank the dock; they do not add new phone interruptions or replace the existing notification schedules.

Remind me accepts a date up to a year ahead and returns the item on that New York day. Don't show again hides that specific item;
changed job sets can create a new opportunity. I followed up records an actual contact outcome and keeps a future follow-up date or
advances it by a week. It is a manual record, not a claim that Atriveo sent a message. Sending mail or logging contact elsewhere also
updates the feed. It refreshes after Network changes, on window focus, and every minute while visible.

State lives in `network_intelligence_state` (first seen, review, dismissal, snooze) and `app_settings.network_intelligence` (dock preference).
The authenticated API is GET `/network/intelligence` and POST `/network/intelligence/action`. No migration is required.

## Follow-ups by default

Everyone but family has a follow-up every week, opt-out: due 7 days after you last reached them (or after they were added, if you
never have). Someone reached through LinkedIn is first due 3 days after being added. A date you set wins; Follow-up → "No follow-up"
switches it off for that person. It is worked out when the page, the bell or the phone message reads people, never stored, so it
covers everyone already in your network.

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

## LinkedIn outreach (check-ins)

A source of kind **LinkedIn outreach (check-ins)** (`outreach`) is one day's batch of LinkedIn reach-outs; it is separate from the older
LinkedIn reach-out / Day cards. New source: the date starts as today and can be changed (Details tab later). Everyone added to it
(Add people, Paste list, or one person) gets `outreach: { reachedAt, status, answers[] }`; today's reach-outs start the clock now, an
earlier date at noon that day. The source stores `checkHours` (default 24, 48, 72).

At each check-in "Did they respond?" appears in the source panel and the bell: **Accepted** or **Replied** keeps them (a reply is logged
in their history); **No** before the last check-in means "message again" and they keep waiting; **No** at the last check-in archives them
(restore with `/network/outreach/restore`). People in an outreach source get no automatic weekly follow-up.

Web Push (ntfy: a count) goes once per person and hour from the 10-minute tick (`runOutreachAlerts`, claims in
`network_outreach_alerts`), held until 8 a.m. New York time. From the second check on it says to message again if they have not
answered. Routes: `/network/outreach/source`, `/people`, `/answer`, `/restore`. Code: `scripts/network-outreach.mjs`;
tests: `tests/network-outreach.test.mjs`.

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
