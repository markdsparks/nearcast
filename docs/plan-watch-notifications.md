# Watch Notifications

Nearcast keeps notifications platform-neutral: the app syncs watched-plan and
saved-place intent plus a delivery channel, and the server can later evaluate
weather changes without caring whether the client is a PWA or a native app.

## Current Foundation

- `POST /api/watch/notifications/register` stores one delivery channel plus the
  enabled watched plans and saved places for that device. The delivery channel
  can be a Web Push subscription or a native iOS APNs token.
- `POST /api/watch/notifications/unregister` removes the stored delivery
  channel.
- `GET /api/watch/notifications/config` advertises whether Web Push is configured
  with a VAPID public key and whether native APNs delivery is configured.
- `POST /api/watch/notifications/test` is a token-protected backend smoke route
  that sends an empty Web Push to a stored subscription using VAPID signing.
- `POST /api/watch/notifications/evaluate` is a token-protected evaluator route
  that checks stored watched plans and saved places against fresh forecast/alert
  data.
- `POST /api/watch/notifications/pending` lets the service worker pull the
  queued notification body after an empty wake-up push.
- The service worker handles `push` events and displays a notification that opens
  Nearcast.
- The iOS shell exposes `window.NearcastNative.notifications`, asks iOS for
  notification permission, registers for remote notifications, and syncs an
  `ios-apns` delivery channel to the same registration endpoint.
- The browser syncs enabled watched plans when notification permission is granted,
  when a plan changes, when a plan is forgotten, and when watched forecasts refresh.
- The browser syncs the selected saved places when saved-place notifications are
  enabled, when the saved-place list changes, or when the user changes the
  watched-place selection.
- VAPID public key config lives in `wrangler.toml`; the private JWK and smoke
  token are GitHub secrets that the deploy workflow installs as Worker secrets.
- Native iOS delivery also needs APNs credentials installed as Worker secrets:
  `PLAN_WATCH_APNS_TEAM_ID`, `PLAN_WATCH_APNS_KEY_ID`, and
  `PLAN_WATCH_APNS_PRIVATE_KEY`. `PLAN_WATCH_APNS_BUNDLE_ID` is optional when the
  bundle remains `app.nearcast.ios`.
- A Cloudflare Cron Trigger runs the evaluator every 30 minutes while
  `PLAN_WATCH_EVALUATOR_MODE=beta`.

## Beta Guardrails

The notification evaluator is intentionally capped so public traffic cannot turn
into an open-ended backend job:

- `PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS=10`: at most 10 active Web Push
  subscriptions can register during the beta. Existing subscriptions can refresh
  their own plan state.
- `PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION=3`: each subscribed device can sync at
  most 3 notifying plans.
- `PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION=3`: each subscribed device can select
  and sync at most 3 saved places.
- `PLAN_WATCH_EVALUATOR_LIMIT=5`: each scheduled run checks at most 5
  subscriptions.
- The scheduler checks the least-recently-evaluated subscriptions first, so a
  larger beta cap rotates through devices instead of repeatedly checking the
  same records.
- Forecast and alert calls are cached per place/unit within each evaluation run.

With the default beta settings, the upper bound is 5 subscriptions x 6 watched
items x 48 runs/day, or 1,440 item evaluations/day. Each unique place can
require one Open-Meteo forecast request and, for US places, one NWS alert
request. Per-run forecast and alert caching means a saved place and plan at the
same coordinates usually share the same external requests.

At this beta size the expected Cloudflare-side cost should remain effectively
inside normal free/very-low-cost usage: roughly 2,880 external weather requests
per day at the cap before per-run place caching, 1,440 scheduled Worker
invocations/month, and small R2 JSON
reads/writes. Scaling is linear:

`monthly item evaluations = evaluated subscriptions per run x watched items per subscription x 48 x 30`

Before raising the caps meaningfully, revisit the Worker subrequest limit,
Open-Meteo/NWS fair-use behavior, R2 operation volume, and push-provider failure
cleanup.

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

Saved-place notifications baseline silently on first evaluation. After that they
watch today/tomorrow for high-signal changes: a new alert, storms becoming
likely, rain becoming materially more likely, tomorrow clearing up, heat risk
rising, or gusts jumping. The evaluator sends only the highest-priority candidate
per subscription per run.

## Native iOS Notes

The native app can now ask for permission and register an APNs token. If the
Worker does not have APNs credentials yet, Nearcast stores the channel but
returns `native-push-not-configured`; the app should explain that native delivery
needs server setup instead of showing a silent failure.

APNs delivery uses the bundle id as the `apns-topic`, sends alert pushes through
the production APNs host for TestFlight/App Store builds, and uses the sandbox
host for debug builds.

## Intentionally Not Built Yet

- Encrypted notification payloads with plan-specific copy.
- User accounts or cross-device plan sync.

## Target Flow

1. User enables notifications for a watched plan.
2. User can also enable saved-place notifications from the Places sheet and
   choose up to 3 saved places to watch.
3. Client registers one delivery channel with watched-plan and saved-place
   intent.
4. A scheduled worker refreshes forecasts for stored watch places.
5. The worker compares new weather truth to the stored last-known state.
6. A push is sent only when a plan or saved place meaningfully changes.
7. Tapping the notification opens Nearcast.
