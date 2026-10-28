# Atriveo Web Push

Implemented for the existing **apply.atriveo.com** PWA and its Settings page. Uses the open-source `web-push` Node library, the existing dashboard server, MongoDB and authenticated Cloudflare Pages Functions. No Firebase, native APNs integration, paid delivery provider, Apple Developer membership or App Store submission. Existing ntfy files, topic, settings and delivery behavior are unchanged.

## Credentials and configuration

A VAPID pair was generated locally in `.env.push.local` (gitignored, mode 0600). Do not commit or paste the private key into frontend configuration. Keep the pair stable; rotating it requires devices to disable and re-enable subscriptions.

To generate a replacement pair locally if needed:

```sh
npx web-push generate-vapid-keys
```

Add these to the existing **dashboard Node server environment** (`/home/ubuntu/atriveo-muse/private/dashboard.env` on Oracle, or the environment loaded by the local tailor server):

```dotenv
VAPID_PUBLIC_KEY=<public key from .env.push.local>
VAPID_PRIVATE_KEY=<private key from .env.push.local>
VAPID_SUBJECT=mailto:katishay@gmail.com
PUSH_EVENT_USER_ID=katishay@gmail.com
```

Use your actual contact address for the subject. `PUSH_EVENT_USER_ID` must be the signed-in owner's lowercase account email. It explicitly assigns the existing single-owner engine's shared inbox/outreach/application collections to that account. Omit it to disable automatic event pushes while retaining subscriptions and test delivery. Do not point it at another user's account. Supporting multiple engine owners requires per-owner event data and queries first; this implementation deliberately does not broadcast shared records to every subscriber.

Existing `MONGO_URI` and nonempty `TAILOR_TOKEN` are required on Node. Existing Cloudflare Pages `JWT_SECRET`, `TAILOR_ORIGIN`, `TAILOR_TOKEN` must be configured; the token must match Node. No VAPID variables belong in Cloudflare or any `VITE_*` variable. The authenticated config endpoint returns only the public key.

## Deployment

Nothing has been deployed. Follow branch → PR → merge into main, then use a clean checkout of `origin/main`:

```sh
npm ci
npm run ship
```

Set the dashboard environment before starting the new dashboard. `ship` now includes dependency manifests when they change and installs dependencies in the dashboard overlay. It also detects `apply-public/` and `functions/` changes so the PWA and authenticated API are shipped with the frontend. It retains the clean-main and confirmation guards. If deploying the site separately after the backend is updated, use `npm run deploy:apply` from clean main. Do not deploy this feature branch.

The server needs outbound HTTPS to browser push providers, including `web.push.apple.com` (and Apple's push subdomains). No new inbound port or service is required. Only the dashboard runs the one-minute event poller. HTTPS is required on the site. `/sw.js` has revalidation headers, root scope and no fetch handler: this feature introduces no offline caching of authenticated pages.

## MongoDB changes

No SQL migrations or manual Mongo migrations. Indexes are created idempotently on the first subscription or event poll:

* `job_pipeline.push_subscriptions`: `userId` (canonical login email), `endpoint`, `keys.p256dh`, `keys.auth`, `createdAt`, `updatedAt`. Unique endpoint index and userId index. Multiple devices per user; concurrent duplicate writes are safe. Other accounts cannot claim or delete an endpoint.
* `job_pipeline.push_deliveries`: event/test deduplication and short delivery leases, with an `expiresAt` TTL index. Event records retained for 90 days, test rate-limit records for one minute. Failed deliveries retry after the two-minute lease. Successful recipients aren't repeated because another device failed.
* `job_pipeline.app_settings`: `push-events:<email>` start timestamp. Events older than opt-in are skipped; polling looks back at most seven days. No changes to existing event records or ntfy deduplication records.

Subscriptions are capability credentials: restrict database/backups like other private account data. Responses do not list endpoints or keys. HTTP 404/410 from the push service removes the expired subscription; transient failures retain it. Disabling notifications removes this device's server record and browser subscription. Signing out attempts the same cleanup before clearing the session; disable first when sharing a device, since a network outage can prevent server-side cleanup.

## Events and links

The one-minute poller consumes existing `outreach.reply.at` records (recruiter replies), `inbox_events` interview/offer classifications, and the existing `widgetProgress`/`readGoal` application totals. It does not rescan Gmail or modify detection. Dismissed/undone/ignored mail is excluded. The engine's existing daily-goal value in Mongo is used, consistent with its phone summaries.

Assessment reminders run at 9 AM New York on the day before a known deadline (catch-up until noon), and at 3 PM on the due date if still open and before its deadline (catch-up until 7 PM). Done, dismissed, expired and undated assessments do not alert. Each assessment/deadline/reminder stage has its own persistent delivery ID; changing a deadline allows a fresh reminder for the new date.

The daily summary runs at 8 PM New York (catch-up until 11 PM), once per calendar day. It reports the existing applied count, first recruiter replies recorded on outreach messages that day, and interview-email updates. It includes zero-activity days. Schedule calculations use New York calendar dates, including daylight-saving changes. No new environment variables or migrations are needed.

Replies open `/outreach?id=<id>` with the corresponding message panel. Interviews/offers open `/applied/<applicationId>` when linked, otherwise `/applied`. Daily goals open `/job-matching`.

There is no existing follow-up reminder detector/schedule in the inspected engine, so no invented reminder schedule has been added. A future detector can call the same abstraction:

```js
import { sendPushNotification } from './web-push.mjs';
await sendPushNotification(db, authenticatedOwnerEmail, {
  title: 'Follow up reminder', body: 'Your contact is ready for a follow-up.',
  url: '/outreach?id=...', type: 'follow_up', data: { contactId: '...' }
});
```

Use `deliverEvent` from `push-events.mjs` with a stable event ID when the detector can repeat. Accepted push delivery is best effort, not proof of display; a crash after acceptance but before recording success can cause a duplicate. Notification tags reduce visible duplicates. Payload data should be small and appropriate for the lock screen.

## Exact iPhone test

1. Use iOS 16.4 or newer with Web Push support. In **Safari**, open `https://apply.atriveo.com`.
2. Tap **Share → Add to Home Screen → Add**. Keep the name **Atriveo**.
3. Launch **Atriveo from its Home Screen icon** and sign in.
4. Open **Settings → Atriveo notifications**. Tap **Enable notifications**, then **Allow** on the system prompt. No prompt appears automatically.
5. Confirm **Notifications enabled**, then tap **Send test notification**. The authenticated request sends only to your signed-in account's devices; no user ID is accepted from the browser.
6. Expect **Atriveo — Push notifications are working 🎉**, using the installed Atriveo identity/icon. Check Notification Center if the app is foregrounded; Focus settings can suppress a banner.
7. Lock the phone or background the PWA and repeat the test after 30 seconds. Tap the notification: it should focus/navigate the existing Atriveo window or open Atriveo at Settings.
8. Disable notifications and verify the control changes to disabled. Re-enable to subscribe again. If permission was denied, allow it in iPhone Settings → Notifications → Atriveo first.

For event tests, enable `PUSH_EVENT_USER_ID` for the engine owner and let the existing Gmail watcher record a new real reply/interview/offer, or reach the configured daily goal. Delivery is checked once a minute. Tap to verify the relevant detail view. Multiple-device delivery can be tested by enabling the same account on another browser/device.

Apple's platform requirements: https://webkit.org/blog/13878/ and https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers . Physical iPhone delivery cannot be confirmed by local unit tests; the above is the required device acceptance check after authorized deployment.

## Verification

```sh
npm run build:apply
npm run build
npm run lint
npm run test:push
npm run test:outreach
node --test tests/phone-summary.test.mjs tests/widget-progress.test.mjs tests/inbox-summary.test.mjs tests/ops/ship-lib.test.mjs tests/review/authSecurity.test.mjs
```

The Mongo integration test follows the existing outreach tests and uses `mongodb-memory-server` from the sibling `PLAYATRIVEO_DIR` (default `~/playatriveo`); it never uses production Mongo. Focused tests cover endpoint/key validation and SSRF restrictions, JWT/CSRF boundaries, ownership, multiple devices, concurrent registration/delivery, expired cleanup, retries, goal/event deduplication and service worker click behavior.
