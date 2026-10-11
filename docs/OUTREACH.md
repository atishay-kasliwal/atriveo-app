# Job outreach on the website

The Today job cards open an editable outreach drawer. `/outreach` keeps drafts after jobs leave Today and provides Gmail, templates, sender details, pitch, daily limits and cooldown settings. No paid enrichment or email service is required.

## Start locally

1. Install dependencies in `atriveo-app` and `playatriveo`. Set `PLAYATRIVEO_DIR` in the sidecar environment if the engine is not at `~/playatriveo`.
2. Keep the existing engine `MONGO_URI`, profile and engine configuration. The website uses the engine's Mongo `outreach` collection and Gmail sender; it does not have a separate mail database.
3. Build with `npm run build:apply`; start/restart the existing tailor service after updating both repositories. Publishing the website remains a separate deployment step.
4. Open **Outreach → Mailbox & settings → Connect Gmail** on the computer running the sidecar. The existing Google OAuth desktop client's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be configured in the engine. Approve **send-only** access. Its refresh token is stored in `PLAYATRIVEO_HOME/gmail-send-token.json`, separate from Gmail read access. Return to the website and refresh.
5. Set your sender email to the connected Gmail account, write your pitch/template, and optionally send yourself a test. Uncheck **Pause all outreach sending** when ready. Merely connecting Gmail does not enable sending.

## Using a job card

- Choose **Prepare outreach**. **Read posting contacts** extracts published addresses from its saved description. **Find public emails** checks the company website you confirm and follows up to six actual careers/contact/about links. Each result retains its source and evidence.
- Recruiter search opens a search engine; add the person's published email, name and profile yourself. This version does not guess addresses or scrape LinkedIn profiles. No result is a valid outcome.
- Edit the message and select a PDF. Tracked applications use their pinned application resume. Manually marked LinkedIn jobs use an available tailored PDF; upload the exact submitted version if needed.
- Mark the job applied, verify any recruiter, then **Approve & queue email**. The default delay is 30 seconds; a future schedule is editable before approval. Cancel before editing a queued message.
- Published hiring inboxes can queue automatically only with the global option enabled. Card-created drafts also require the per-job option and a confirmed website. Automatic sends wait at least ten minutes. General inboxes and people require explicit approval.
- **Scan applied jobs** uses the engine's existing scan: tracked applications from the last 14 days. It can queue published hiring inboxes when the global option is on. Manually marked jobs can be researched through their individual drawers.

## Sending and records

Defaults remain 15 emails per rolling 24 hours and one per company/address per 30 days. CLI and website share limits, a sender lease and per-record compare-and-set claims. Any recipient, message or attachment edit clears approval. Excluded addresses and no-email postings are held. PDF bytes are checked immediately before sending. Uncertain deliveries are never retried automatically.

The local service must be running for scheduled delivery. Overdue queued work detected on restart returns for review, and interrupted deliveries become uncertain. Existing approvals made before the attachment-filename digest change need reapproval. The browser never receives OAuth tokens. The deployed website uses the existing authenticated `/tailor` relay; keep its token authentication enabled.

The small crawler reads public HTML only, caps response size/time, blocks private network addresses and follows same-company links. It cannot find contacts hidden behind login, JavaScript-only pages, or private directories. No follow-up sequences or extension recruiter line are included in this change.

## Validation

`npm run test:outreach` runs discovery, HTTP boundary and Mongo/Gmail workflow tests against a temporary Mongo instance and fake sender. `npm run test:outreach:browser` builds and exercises desktop/mobile editing, approval and cancellation in Playwright. The tests import the sibling engine through its installed `tsx` and require its dev dependencies. They do not use production Mongo, Gmail or public discovery sites.

## Current hosted deployment

The current production backend runs in Oracle Docker, not directly on the Mac. The Mac's `com.atriveo.tailor` is a proxy. Restarting that LaunchAgent alone does not deploy backend changes.

Outreach is packaged in `atriveo-dashboard:outreach-v1`, layered on the existing dashboard image. Its engine copy lives at `/app/outreach-engine`, selected with `OUTREACH_ENGINE_DIR`, so the shared `/engine` used by other workflows is untouched. The server launch script is `/home/ubuntu/atriveo-production/start-dashboard-outreach-v1.sh`. Rollback uses the preceding `start-dashboard-fits-fee3b9489.sh`.

For the hosted server, complete Gmail consent on the Mac using `npm run outreach -- auth`, then securely install the resulting send-only token in the server's mounted private context with mode 0600 and dashboard ownership. Do not paste it into chat. The website's loopback OAuth flow requires a local backend; it cannot directly finish the hosted server's callback without port forwarding. Connecting Gmail does not unpause sending.

## Frontend release source

Use `/Users/atishaykasliwal/atriveo-app-outreach-release` (branch `release/outreach-current-ui`) for the combined UI. It is based on `fee3b9489`, the last deployed Today/Staffing shared-card release before outreach. The older `atriveo-app` main checkout does not contain that UI and must not be deployed over it. This release keeps the existing card layout and adds outreach in the caption row.
