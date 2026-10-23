# Resumes in Cloudflare R2

Finished resumes are kept in the private R2 bucket `atriveo-resume` (account `a4e4f5c1214af712b0f5f48ef7c722ec`), by content hash:
`resumes/<first 2 of sha256>/<sha256>.pdf` and `.png` (the page image). Mongo keeps the reference beside the old path:
`resume.object = { bucket, key, sha256, bytes, image_key }`. Nothing is required: without the four `R2_*` settings every R2 call is a quiet no-op and the
local path flow is unchanged.

- `scripts/resume-store.mjs` — SigV4 over `fetch` (no dependency): `publishResume`, `fetchResumeToFile`, `presignGet`, `store.del`.
- `scripts/resume-queue.mjs` `updateResumeState` — on `status: "success"` with a `pdf_path`, uploads the PDF (and image if present) and records `resume.object`. A storage error is recorded as `resume.object_error` and never fails the row.
- `scripts/job-matching.mjs` — the Matching queue publishes the PDF and its page image once, and sends `resumeObject` to the page.
- `scripts/tailor-server.mjs` — `GET /applications/resume-file?sha=&kind=pdf|image` redirects to a link that expires in 5 minutes.
- `src/apply/JobMatchingPage.tsx` — uses that route when the job has `resumeObject`, else the old path routes.

Settings (private env files; the secret is never committed or shown):

    R2_ACCOUNT_ID=a4e4f5c1214af712b0f5f48ef7c722ec
    R2_BUCKET=atriveo-resume
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...

Not built yet: the apply engine and extension fetch (phase 3: `fetchResumeToFile` into a temp dir before an upload) and cleanup/lifecycle (phase 4).
