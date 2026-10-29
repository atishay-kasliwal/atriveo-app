# Network follow-up design

Brief: A private job-search network needs a concrete next step per person, and a record of what happened. Existing contacts and reminder dates remain valid. Planning never sends a message.

Concept candidates (originality / fit / feasibility / portability, 1–5; low portability preferred):
- Next conversation: the contact list becomes a queue of conversations, and reviewing one hands its context to the next. 4 / 5 / 5 / 2. Anchor: existing networking introductions and follow-up dates. Signature: log outcome and schedule the next contact in one save. Emotion: calm preparedness.
- Connection itinerary: appointments arranged as a transit timetable. 4 / 3 / 3 / 3. Anchor: the network graph. Signature: planned and completed stops. Emotion: momentum.
- Contact notebook: one expanding note per relationship. 3 / 4 / 5 / 4. Anchor: existing history. Signature: a turned page after logging. Emotion: familiarity.

Chosen: Next conversation, because the user needs a reliable action loop inside a working tool.

Idea: Each relationship has one clear next conversation.
Metaphor: A handoff from the last conversation to the next.
Signature: One outcome save records current notes and hands the next date/topic/notes into the list.
Emotion: Prepared, never pressured.
Motion verb: Settle; controls give a brief press response. No idle motion or spectacle in this task-focused application. Reduced motion removes transforms.
Screenshot: A quiet contact list with next steps alongside names; a focused follow-up sheet.

System: existing Vite + React + TypeScript, existing router and CSS. Existing app font for UI and tabular dates. Ground #0c0d10, surface #15171c, ink #eceef2, muted #aeb5c2, line #363a45, accent #a9b4ff. Preserve the app palette and graph. No new font or animation dependency.
Grid: list name/source/next action; follow-up panel uses stacked sections and paired platform/date fields, collapsing on narrow screens. 8px base rhythm, 12px field radius. Primary controls min 44px. Still at rest. Existing app lifecycle handles navigation.

List: [Person + role] [Source] [Next conversation + platform/topic] [Plan ↗]
Sheet: [Follow-up / status] [Plan | Log outcome] [Did you follow up?] [Current notes] [Next step needed?] [Platform / Date] [Regarding] [Notes for next time] [Save]

Assumptions: follow-up is manual; this does not send messages. Dates use the existing app date conventions. Not yet records an attempt, not contact. Completing and scheduling are atomic. Older date-only reminders stay visible; optional fields need no data migration. No invented contact or schedule data.
Genericness check: avoid a generic CRM dashboard; keep the network list and existing relationship context, show the actual platform/topic inline, and preserve a distinct note for the current outcome versus the next conversation.
Scope: existing private app view, so no new public pages, SEO, loader, GL, or marketing assets. Final accessory cut: no decorative step numbers.

QA: production builds, 48 network/store/reminder/map tests, and 14 canvas browser tests. Two additional evidence captures run on desktop and a throttled phone. Outcome-to-next-plan persistence is tested across reload; the backend validates before one update. Invalid calendar dates fail without partial updates. The mobile sheet has explicit dialog semantics, a visible close control, Escape handling and a Tab loop.

Independent visual passes separated current and next follow-ups, finished native textarea styling, repaired clipped mobile actions, and replaced the cramped mobile pane with a focused sheet. Both desktop and phone scans have zero scoped axe violations, no document/panel/form horizontal overflow, and all new form targets exceed 24px. The app remains still under reduced motion. Local lab performance is evidence for this build, not a production field measurement; global app-shell performance and public metadata are outside this feature change.
