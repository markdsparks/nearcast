# Production Watch Notifications

Nearcast notifications have one product promise: watch the plans and saved
places a person explicitly selects, then interrupt only when the weather story
meaningfully changes. They are a production capability, not a replacement for
official emergency alerts.

## Product Contract

- Notification permission is requested from a user action, never on launch.
- A user chooses exactly which plans and saved places may notify them.
- Forecast noise stays silent. Candidate selection is deterministic and uses the
  same `weather-truth.js` rules as the in-app Watching experience.
- A notification says what changed and opens the relevant plan, place, hourly
  window, or official-alert detail.
- Nearcast must not display `Notifications ready` unless this device has a
  successfully stored, unexpired delivery channel.
- US official-alert context comes from the National Weather Service. Outside
  the US, Nearcast must describe official-alert coverage as unavailable rather
  than interpreting the absence of NWS data as an all-clear.

## Production Architecture

- `POST /api/watch/notifications/register` stores one Web Push subscription or
  native iOS APNs channel plus the enabled plans and saved places for that
  device. New-channel registration requires at least one valid watch target,
  a valid IANA timezone, and a delivery channel that passes strict key/token and
  provider validation. Web Push endpoints are limited to the supported FCM,
  Mozilla Autopush, Apple Web Push, and Windows push domains; the Worker never
  sends to an arbitrary caller-supplied host.
- `POST /api/watch/notifications/unregister` removes that channel.
- `GET /api/watch/notifications/config` publishes client-safe provider,
  storage, and operating-limit readiness.
- `GET /api/watch/notifications/health` is a token-protected operational view of
  scheduler, storage, evaluator, and delivery readiness. It returns aggregates
  only—never device tokens, subscription identifiers, locations, or plan text.
- `POST /api/product/events` accepts only a small allowlist of aggregate product
  counters using the exact `{ events: [{ name, count }], platform, version }`
  schema. It requires same-origin browser metadata and rejects context, free
  text, identifiers, and coordinates. `Sec-GPC: 1` or `DNT: 1` suppresses the
  write at the edge.
- `POST /api/watch/notifications/evaluate` is the token-protected deterministic
  evaluator and supports a no-send dry run.
- `POST /api/watch/notifications/test` sends a clearly labeled canary to a
  dedicated stored device.
- `POST /api/watch/notifications/pending` lets a Web Push service worker fetch
  the queued notification copy after an encrypted empty wake-up push.
- Native iOS delivery sends the copy and deep-link context directly through
  APNs.
- A Cloudflare Cron Trigger wakes the Worker every five minutes. A bounded urgent
  pass performs only the official-alert lookup; it does not load forecast data.
  A bounded standard pass follows in the same wake for ordinary plan/place
  changes. The two passes share alert/forecast promises by place so they do not
  repeat the same provider request in one cycle.
- Cloudflare Rate Limiting bindings enforce separate per-client and global
  admission limits for new delivery channels and aggregate product events.
  Missing or failed bindings fail closed. Existing registered channels may still
  renew their TTL or update watched targets, and no stable client hash is written
  to R2.

Delivery credentials remain secrets:

- `PLAN_WATCH_VAPID_PRIVATE_KEY`
- `PLAN_WATCH_APNS_KEY_ID`
- `PLAN_WATCH_APNS_PRIVATE_KEY`
- `PLAN_WATCH_TEST_TOKEN`
- `PLAN_WATCH_REGISTRATION_RATE_SALT` (recommended dedicated high-entropy salt;
  the protected test token is the deployment fallback)

The VAPID public key, APNs team/bundle identifiers, deterministic limits, and
mode may remain in `wrangler.toml`.

## Responsible Production Limits

Production is deliberately bounded. These are capacity and reliability
controls, not a beta cohort or product tier:

- `PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS=60` caps active device channels. The cap
  is above the former ten-device experiment and is derived from the evaluator
  throughput/SLA below.
- `PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION` caps notifying plans per device.
- `PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION` caps notifying saved places per
  device.
- `PLAN_WATCH_EVALUATOR_LIMIT=4` and
  `PLAN_WATCH_URGENT_EVALUATOR_LIMIT=8` bound work per five-minute pass.
- Separate urgent and standard continuation cursors page through R2 in bounded
  batches so every active device continues to make progress as capacity grows.
- Forecast and alert requests are cached by place/unit inside an evaluator run.
- At 60 active channels, the urgent cursor completes in at most eight wakes
  (about 40 minutes) and the standard cursor in 15 wakes (about 75 minutes).
  Health allows 45 and 90 minutes respectively, giving one-wake operating
  headroom while still detecting capacity lag.

Raise capacity only from observed evaluator duration, provider errors, R2
operations, delivery acceptance, and oldest-record age—not from an arbitrary
launch date. Change the active-channel cap and evaluator limits together so the
45/90-minute service bounds remain true.

Capacity model:

`monthly item evaluations = evaluated devices per pass × watched items per device × passes per day × 30`

Before each material increase, verify Cloudflare subrequest limits,
Open-Meteo/NWS fair-use behavior, R2 volume, provider response rates, and stale
subscription cleanup.

## Production Health And Canaries

The production health endpoint is polled at minutes 7 and 37 by
`.github/workflows/check-plan-watch-notification-health.yml`. A healthy result
requires recent successful urgent and standard evaluations, ready storage, every
configured delivery channel (Web Push and APNs in production), and cursor cycle
age/oldest-evaluation lag within the 45/90-minute bounds. Official-alert fetch
errors make that pass and health result degraded. HTTP 503 or `ok: false` fails
the workflow.

`Send notification delivery canary` is intentionally manual because it creates
a real interruption. It requires a dedicated canary subscription, selected by
one of these GitHub secrets:

- `PLAN_WATCH_WEB_PUSH_CANARY_SUBSCRIPTION_ID`
- `PLAN_WATCH_APNS_CANARY_SUBSCRIPTION_ID`

The workflow will not fall back to an arbitrary fresh user subscription. A
successful HTTP/provider response proves provider acceptance, not that a person
saw the notification; the canary device must still be checked periodically.
The health payload reports each pass's bounded scan count, `hasMore`, cycle age,
completed-cycle duration, oldest selected-record evaluation lag, and a
non-sensitive cursor state (`continuing` or `wrapped`) so growing capacity lag
is visible without exposing R2 cursor values or subscription records.

The existing `Evaluate plan watch notifications` workflow remains useful for a
targeted dry run. Use a send-enabled evaluation only when validating a known
test record.

Production signals to review:

- last successful scheduled evaluation and its age;
- records evaluated, deferred, failed, and errored;
- supported/unsupported/error official-alert readiness and NWS failure rate;
- Web Push/APNs acceptance and expired-token cleanup;
- oldest active record waiting for evaluation;
- registration failures and channel expiry;
- notification opens by coarse signal type, without plan text or location.

## Release Gate

Every push and pull request runs `.github/workflows/nearcast-ci.yml`:

- JavaScript syntax checks;
- weather-truth and notification-evaluator fixtures;
- product-activation, hourly, gesture, map, satellite, Reactive Sky, and
  freshness smokes;
- native shared widget/Watch model tests on macOS;
- an unsigned generic iOS build containing the app, widget, Watch app, and
  complications.

`scripts/nearcast-testflight.sh` runs the same portable and native-model checks,
validates packaged metadata, archives all products, validates the archive, and
only then uploads it. A TestFlight build should come from a clean, identifiable
commit so the binary can be reproduced.

## Delivery Semantics

The evaluator watches for high-signal changes such as:

- a new official alert overlapping a selected plan or saved place;
- rain or storm risk materially increasing;
- serious heat risk worsening;
- gusts increasing enough to change a decision;
- the overall plan window crossing a meaningful score band;
- tomorrow materially clearing up when that is useful.

The highest-priority candidate wins each evaluator pass. Other candidates keep
their prior baseline and remain eligible for a later pass. A failed delivery
must not advance the delivered candidate's baseline. Transient Web Push/APNs
errors retry with a five-second attempt timeout and bounded exponential backoff;
provider-expired channels are
removed. Identical accepted deliveries are suppressed for 24 hours. Routine
changes defer from 10 PM to 7 AM in the device timezone without consuming their
baseline; official warnings bypass quiet hours. Nearcast adds context but does
not replace official emergency alerts, Wireless Emergency Alerts, or local
guidance.

Web Push retries reuse the same pending notification until its two-hour TTL so
multiple empty wakes cannot degrade into generic copy. APNs alert retries use
the normalized notification tag as `apns-collapse-id`; Live Activity retries
collapse by activity id.

NWS outcomes are carried as `supported`, `unsupported`, or `error`. Unsupported
geography preserves the prior alert fields without claiming an all-clear. A
timeout, provider error, or unknown alert state never compares or advances the
alert baseline; it fails the evaluation and is visible in protected health.

## Manual End-To-End Check

1. On a dedicated iPhone or browser, create a watched plan and enable its
   notifications.
2. Confirm Watching reports a successful channel registration and expiry—not
   merely granted OS permission.
3. Store that device's subscription id in the appropriate canary secret.
4. Run `Send notification delivery canary` for Web Push or APNs.
5. Confirm the canary arrives and opens Watching.
6. Run `Evaluate plan watch notifications` with `dryRun: true` and confirm the
   test plan/place is evaluated without sending.
7. Confirm the production health workflow remains green after the next
   scheduled evaluator pass.

## Deliberate Boundaries

- No user account or cross-device plan sync is required for delivery.
- No AI model decides whether a notification is warranted.
- No notification claims to replace NWS, Wireless Emergency Alerts, or local
  emergency guidance.
- No telemetry payload contains coordinates, place names, plan wording, device
  tokens, or subscription identifiers.
