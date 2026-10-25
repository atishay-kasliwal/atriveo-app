# Unified Apply flow

Apply in Job Matching carries the selected job and its exact viewed PDF into the desktop Chrome companion. The backend never compiles a new resume for this handoff. It checks the current job revision and returned file bytes against the viewed SHA-256, then returns a 24-hour kit with profile fields and a PDF up to 5 MB. Stale or unavailable bytes stop the handoff rather than substituting a different file.

The workspace discovers the companion through its production-origin bridge and prefetches the kit while the job is visible. Apply delegates opening the application tab to the extension once, then records the existing opened decision. Without the extension, Apply continues to open the normal application page. A failed handoff stays on the current job for retry. Prefetch requests have a deadline and keep at most three workspace kits in memory.

Each returned kit includes only job metadata, basic copyable profile fields and the pinned PDF. Credentials and signed storage URLs are not passed to employer pages. Blank contact fields may be recovered from a saved assessment only when its PDF checksum matches this exact resume. The existing authenticated relay protects the preparation endpoint; this endpoint has no application submission or resume-generation side effects.

The companion owns a cache and binds each application tab to its kit. The Chrome side panel offers Copy, Paste into the focused text field, and PDF Preview/Download/Attach. Attach can ask for access to the current employer origin; with prior access, a unique explicit resume upload can be selected automatically. Ambiguous controls require selection. Changed application URLs block file attachment. Unsupported embedded or custom upload widgets retain a Download fallback.

Both halves use protocol version 1 (`atriveo-companion-v1`). Build/reload the extension and deploy the workspace/backend together for the unified flow. The pre-existing normal Apply and PDF download remain usable without the companion.
