# Atriveo (Sep 2025 – present): fact sheet

| Fact | Source | Status |
|---|---|---|
| **V1:** a Chrome extension captures each application as you apply (JD, resume used); Gmail integration updates its status, replacing spreadsheet tracking | you, 2026-10-08 | confirmed |
| **V2:** job boards were sponsored and stale, so it found jobs directly when listed, with timestamps and email alerts | you | confirmed |
| **V3:** multi-user with friends, gamified weekly challenges (most applications, best resumes and ATS scores); still enrolling users, almost a year now | you, 2026-10-08 | confirmed |
| Users: **~1,000** (voice note: "approximately thousand friends") | you | **needs confirmation: about 1,000 users, or about 10 friends?** |
| **Now:** company boards monitored: **8,125** (Greenhouse 4,809, Ashby 3,287, Lever 29) | Mongo `ats_boards`, 2026-10-08 | confirmed (data) |
| **6,564** jobs discovered from **2,209** companies; 5,930 full job descriptions (Sep 29 – Oct 8, 2026) | Mongo `jobs`, `descriptions` | confirmed (data) |
| **2,216** tailored resumes, one per job | Mongo `jobs.resume` | confirmed (data) |
| **893** applications processed: 78 submitted, 404 in review, 335 skipped, 76 failed | Mongo `applications` | confirmed (data) |
| Application systems: Greenhouse, Ashby, Lever, Workday, generic forms; LinkedIn Easy Apply in the extension | Mongo `applications.ats`; extension | confirmed (data) |
| 225 Gmail status events | Mongo `inbox_events` | confirmed (data) |
| Real-world failures handled: Ashby form changes, Greenhouse email verification, dynamic questions, spam blocks; final submission and open answers kept human-controlled | this project's history (Oct 2026) | confirmed |
| Backend moved from the Mac to an Oracle VM (Docker workers, Mongo) | this project's history | confirmed |
| **Over the year: 50K+ applications tracked and 50K+ tailored resumes** across its users | you, 2026-10-08 | confirmed |
| **Earlier version** ran on FastAPI + PostgreSQL + Cloudflare (Pages and Workers, with Docker), at **99.9% uptime** across **2K+ daily queries** | you, 2026-10-08 ("everything true") | confirmed |
| **Today's version:** Node.js/TypeScript, MongoDB, Docker on an Oracle Cloud VM, Playwright automation, React console | the running system | confirmed |
| Note: the 9-day figures (8.1K boards, 6.5K jobs, 2.2K resumes, 893 applications) are this database's window since 2026-09-29. The year totals above are the headline. Say which era a stack belongs to, so the two never read as a contradiction. | | |
