# Day plan (/day-plan)

The All Things Open 2026 program (Oct 19-20, Raleigh) as room lanes across the day, with a time slider.

- **Schedule:** `src/apply/atoSchedule.ts`: public titles, rooms, times, speaker names and company only. Nothing private is in the repo.
- **Your people:** read from Network (`loadWholeNetwork`), matched to speakers by name. A talk with someone tagged `Priority ...` gets a ring; the "Meet today" list shows them with their follow-up date and links to `/network?person=...`. Companies with a Network source whose "about" starts with "Hiring" get a dot.
- **Agenda:** saved in this browser (`ato-day-plan-agenda`); overlapping saved talks are listed (lightning talks excepted).
- **Load the people:** on `/network`, Open a saved file, pick the ATO 2026 map file made by the generator in the conference workspace. This page writes nothing to Network.
- **Test:** `npm run test:dayplan:browser` (invented data; checks days, marks, agenda, phone width, and that nothing is written).
