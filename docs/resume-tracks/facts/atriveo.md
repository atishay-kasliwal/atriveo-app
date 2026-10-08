# Atriveo (Sep 2025 – present): fact sheet

| Fact | Source | Status |
|---|---|---|
| **V1:** a Chrome extension captures each application as you apply (JD, resume used); Gmail integration updates its status, replacing spreadsheet tracking | you, 2026-10-08 | confirmed |
| **V2:** job boards were sponsored and stale, so it found jobs directly when listed, with timestamps and email alerts | you | confirmed |
| **V3:** multi-user with friends, gamified weekly challenges (most applications, best resumes and ATS scores) | you | confirmed; **how many friends, for how long?** |
| **Now:** company boards monitored: **8,125** (Greenhouse 4,809, Ashby 3,287, Lever 29) | Mongo `ats_boards`, 2026-10-08 | confirmed (data) |
| **6,564** jobs discovered from **2,209** companies; 5,930 full job descriptions (Sep 29 – Oct 8, 2026) | Mongo `jobs`, `descriptions` | confirmed (data) |
| **2,216** tailored resumes, one per job | Mongo `jobs.resume` | confirmed (data) |
| **893** applications processed: 78 submitted, 404 in review, 335 skipped, 76 failed | Mongo `applications` | confirmed (data) |
| Application systems: Greenhouse, Ashby, Lever, Workday, generic forms; LinkedIn Easy Apply in the extension | Mongo `applications.ats`; extension | confirmed (data) |
| 225 Gmail status events | Mongo `inbox_events` | confirmed (data) |
| Real-world failures handled: Ashby form changes, Greenhouse email verification, dynamic questions, spam blocks; final submission and open answers kept human-controlled | this project's history (Oct 2026) | confirmed |
| Backend moved from the Mac to an Oracle VM (Docker workers, Mongo) | this project's history | confirmed |
| Note: Mongo data starts 2026-09-29; earlier versions' numbers have to come from you | | |
