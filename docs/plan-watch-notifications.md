# Plan Watch Notifications

Nearcast keeps plan notifications platform-neutral: the app syncs a watched-plan
intent plus a delivery channel, and the server can later evaluate weather changes
without caring whether the client is a PWA or a native app.

## Current Foundation

- `POST /api/watch/notifications/register` stores a web push subscription and the
  enabled watched plans for that browser.
- `POST /api/watch/notifications/unregister` removes the stored subscription.
- `GET /api/watch/notifications/config` advertises whether Web Push is configured
  with a VAPID public key.
- `POST /api/watch/notifications/test` is a token-protected backend smoke route
  that sends an empty Web Push to a stored subscription using VAPID signing.
- `POST /api/watch/notifications/evaluate` is a token-protected evaluator route
  that checks stored watched plans against fresh forecast/alert data.
- `POST /api/watch/notifications/pending` lets the service worker pull the
  queued notification body after an empty wake-up push.
- The service worker handles `push` events and displays a notification that opens
  Nearcast.
- The browser syncs enabled watched plans when notification permission is granted,
  when a plan changes, when a plan is forgotten, and when watched forecasts refresh.
- VAPID public key config lives in `wrangler.toml`; the private JWK and smoke
  token are GitHub secrets that the deploy workflow installs as Worker secrets.

## Manual E2E Smoke

1. Open Nearcast on the device/browser you want to test.
2. Create or open a watched plan, then enable notifications.
3. Wait a few seconds for the browser subscription and watched-plan intent to
   sync to the backend.
4. In GitHub Actions, run `Send plan watch test notification`.
5. Leave `subscriptionId` blank to send to the first fresh stored subscription.

Expected result: the device receives a generic Nearcast notification from the
service worker. Tapping it opens Nearcast. If the workflow reports
`subscription-not-found`, the backend does not have a fresh registered
subscription yet; revisit the app, confirm notification permission, and update or
watch a plan again.

## Manual Evaluator Test

1. Open Nearcast on the test device and make sure the app version is current.
2. Open the watched plan and leave notifications on so the latest plan snapshot
   syncs to the backend.
3. In GitHub Actions, run `Evaluate plan watch notifications`.
4. Use `dryRun: true` to inspect whether the evaluator sees the subscription and
   plan without sending a push.
5. Use `dryRun: false` to let the evaluator send a notification only if it sees
   a meaningful change.

The evaluator currently watches for high-signal changes: a new alert overlapping
the plan window, rain increasing materially, serious heat getting worse, gusts
getting meaningfully stronger, or the overall plan window degrading enough to
cross a score band.

## Intentionally Not Built Yet

- Encrypted notification payloads with plan-specific copy.
- Automatic scheduled evaluator runs.
- Native APNs token registration.
- User accounts or cross-device plan sync.

## Target Flow

1. User enables notifications for a watched plan.
2. Client registers a delivery channel and watched-plan intent.
3. A scheduled worker refreshes forecasts for stored plan places.
4. The worker compares new weather truth to the stored last-known plan state.
5. A push is sent only when a plan meaningfully changes.
6. Tapping the notification opens Nearcast to the watched plan.
