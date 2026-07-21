# Nearcast roadmap — from beautiful to dependable

Living product roadmap, current for **v3.0.285+**.

Nearcast already has a distinctive product: an unusually beautiful current
weather experience, a capable radar map, useful iPhone widgets and Apple Watch
surfaces, and a Plan Check that translates weather into a decision. The next
phase is not another screen. It is proving that Nearcast remains correct and
helpful when the user is not looking at it.

## Product North Star

**Nearcast remembers what matters and gives a trustworthy heads-up when the
weather story meaningfully changes.**

Four principles protect that promise:

1. **Truth before drama.** Current, nearby, future, and official-alert weather
   must never be blurred together.
2. **One model, many surfaces.** The app, widgets, Watch, complications, plans,
   map, and notifications present the same underlying weather truth.
3. **Glance first, depth one tap away.** The main read is immediate; evidence
   and hourly detail remain nearby without crowding it.
4. **Performance is part of beauty.** Sky and map immersion must yield to input,
   accessibility settings, battery, and thermal constraints.

## Current Position

### Strengths to protect

- The hero, NOW/NEXT/LATER guidance, glance cards, hourly views, and living sky
  form a coherent premium first screen.
- Hourly temperature, rain chance/amount, wind, alerts, and explanatory detail
  are materially more readable than a generic weather table.
- The large widget, small widgets, Watch app, and complications now share
  explicit freshness, hourly projection, and expiry rules instead of painting
  one observation indefinitely.
- Plan Check and Watching turn a forecast window into a human verdict, relevant
  metrics, a receipt, and an optional notification target.
- Web Push and APNs use one deterministic server evaluator and one shared
  weather-truth contract.
- Nearcast Radar, recent NASA GIBS satellite imagery, and the guarded StormScope
  experience cover increasingly deep map needs without making provider names
  the primary UX.
- Reactive Sky is opt-in, Current Location aware, Reduced Motion aware, and
  pauses when app work makes animation inappropriate.

### Gaps that now matter most

- We cannot yet see aggregate activation, freshness, delivery, or performance
  outcomes well enough to distinguish an isolated glitch from a product-wide
  issue.
- Notification permission and a successful stored delivery channel are not the
  same thing; every readiness surface must make that distinction.
- Background refresh on iOS/watchOS is discretionary. The product must measure
  and design around real delivery behavior rather than promise a fixed cadence.
- Official alert context is NWS/US-only while the forecast experience is
  worldwide. Coverage must be stated honestly.
- The repository has broad smoke coverage but historically lacked an automatic
  push/pull-request gate and reproducible clean-commit release discipline.
- `app.js`, `planner.js`, `map.js`, and the native widget/watch files are large
  enough that untested cross-surface changes carry increasing regression risk.

## Priority 0 — Production Trust Loop

Status: **active**.

Goal: know whether Nearcast is fresh, correct, reachable, fast, and valuable
without collecting personal weather context.

### Reliability work

- Record last attempt and last success separately for forecast loads, widget
  refresh, Watch refresh, complication timelines, notification registration,
  and server evaluation.
- Keep enough cached forecast runway to advance widgets and complications when
  Apple defers another extension launch; move to an explicit update-needed state
  when the real forecast horizon ends.
- Persist aggregate scheduled-evaluator health and expose it through the
  protected production health endpoint.
- Run the protected health canary twice an hour and keep dedicated manual Web
  Push and APNs delivery canaries.
- Add retry/backoff, expired-channel cleanup, duplicate suppression, and quiet
  hours before materially increasing notification capacity.
- Treat official-alert coverage as a first-class state: ready, none active,
  unavailable here, or temporarily unknown.

### Release work

- Run portable product, weather-truth, notification, map, satellite, Reactive
  Sky, and freshness checks on every push and pull request.
- Run native shared-model tests and an unsigned iPhone/widget/Watch build on
  macOS CI.
- Make TestFlight execute the same production preflight before archive/export.
- Upload only from a clean, identifiable commit and retain build-to-commit
  traceability.

### Privacy-safe product signals

Nearcast may collect coarse allowlisted events such as:

- forecast launch success, cache fallback, or failure;
- Plan Check invitation shown/opened/dismissed;
- Plan Check started, completed, and watched;
- notification registration success/failure and coarse signal type;
- notification open;
- widget/Watch freshness age buckets and explicit expiry;
- full-map open, high-detail actually visible, satellite selected, StormScope
  activated, and provider failure;
- Reactive Sky enabled, motion allowed, reduced-motion fallback, and long-task
  buckets.

Never send coordinates, place names, plan wording, alert prose, device tokens,
subscription identifiers, or raw sensor readings.

### Definition of done

- Production notification health is visible and alertable.
- `Notifications ready` means a successful unexpired server registration.
- A failed refresh cannot leave an open-ended stale forecast or alert.
- Every TestFlight artifact can be traced to a passing clean commit.
- We can measure the path from Plan Check invitation → completed check → watched
  plan → meaningful notification → return visit.

## Priority 1 — Make Proactivity Earn The Return Visit

Status: **next product push after Trust Loop health is green**.

The notification system already watches high-signal changes. The next work is
to turn it into a calm production experience:

- Keep the promise narrow: selected plans and saved places only.
- Lead with the changed decision, not raw forecast numbers.
- Open the exact context that explains the notification.
- Use an alert-specific cadence for time-sensitive official-alert overlap while
  keeping routine forecast changes quieter and less frequent.
- Let users pause all interruptions without deleting plans or saved places.
- Let users choose sensible quiet hours; do not make them configure a rule
  engine.
- Show a short recent-calls receipt so users understand what Nearcast sent and
  why.

Do not position Nearcast as a replacement for NWS, Wireless Emergency Alerts,
or local emergency guidance.

Success means a user receives few notifications, but the ones that arrive are
useful enough to keep Plan Check and Watching enabled.

## Priority 2 — Improve Activation With Evidence

Status: **measure, then tune**.

Nearcast now gives users without a plan a limited, dismissible Plan Check
invitation. The next iteration should be driven by the privacy-safe funnel, not
more onboarding pages.

Questions to answer:

- Do people understand what Plan Check does from the invitation?
- Which real-world starter produces a completed check rather than an abandoned
  sheet?
- Where do users stop: wording, place, time confirmation, result, or Watch?
- Does the first meaningful notification lead to a return visit?
- Do existing users discover Watching without the invitation?

Improve the narrowest failing step. Preserve the current guardrails: at most
three invitation impressions, a long dismissal interval, and no prompt after a
user has already engaged with plans.

## Priority 3 — Graduate Or Retire Experiments

Status: **measured experiments only**.

### Reactive Sky

Keep it labeled Experimental until real-device evidence shows:

- stable frame/input performance across clear, cloud, rain, storm, day, and
  night scenes;
- no material battery or thermal regression;
- correct Current Location and remote-place behavior;
- graceful Reduced Motion and poor-compass fallbacks;
- enough retained use to justify the settings and sensor complexity.

If those checks pass, make weather-driven Reactive Sky the default and leave
device motion optional. Otherwise retain the beautiful standard sky and remove
the experiment.

### Map

Measure the user outcome of each capability:

- full-map opens;
- Nearcast high detail actually rendered, not merely requested;
- loading/failure time and visible fallback continuity;
- satellite selection and useful dwell time;
- StormScope activation, weather relevance, provider acceptance, and estimated
  cost.

Do not add another map tier. Reconcile the current automatic immersive
high-detail behavior with the historical generated-radar decision record, then
document one production routing policy. Keep satellite imagery truthful about
its pass date and keep StormScope an explicit paid-data activation.

## Priority 4 — Architecture That Protects Product Speed

Status: **incremental**.

- Continue moving deterministic interpretation into `weather-truth.js` with
  fixtures shared by browser and Worker.
- Extract notification operations, freshness projection, map routing, and
  activation telemetry behind stable interfaces only when tests already cover
  the behavior.
- Add native XCTest/UI snapshot coverage for shared snapshot arbitration,
  projection/expiry, complication families, Watch layouts, and deep links.
- Add screenshot matrices for weather condition × day/night × device size ×
  motion setting; recent cloud/night regressions prove that source assertions
  alone cannot protect visual quality.
- Keep generated-radar artifacts and provider experiments out of ordinary app
  complexity unless measured value justifies their operating cost.

## Product Scorecard

The Trust Loop should make these measurable without personal data:

- forecast launch success and warm-start fallback rate;
- percentage of widget/Watch renders in fresh, projected, and expired states;
- scheduled evaluator success and oldest-record age;
- Web Push/APNs provider acceptance and expired-channel cleanup;
- Plan Check completion and Watch conversion;
- meaningful notifications per enabled device per week;
- notification-open and seven-day return rates;
- map high-detail success/latency and StormScope cost per useful session;
- Reactive Sky opt-in retention and long-task rate;
- crash-free sessions and WebKit process recovery.

Targets should be set after the first trustworthy production baseline. Avoid
optimizing raw notification volume, time in app, or animation engagement; those
can reward noise rather than usefulness.

## Recommended Sequence

1. Finish the Trust Loop: health endpoint, privacy-safe event pipeline, honest
   readiness, CI, canaries, and clean releases.
2. Observe widget/Watch freshness and production delivery for at least one full
   weather week; fix demonstrated failure modes.
3. Expand notification capacity responsibly and add quiet delivery behavior.
4. Tune the Plan Check activation funnel from observed drop-off.
5. Decide whether Reactive Sky and each enhanced map capability graduate,
   simplify, or retire.
6. Only then choose the next large product surface.

## Parking Lot

- Cross-device account sync.
- General morning briefings.
- AI-generated push prose.
- International official-alert providers.
- Pollen-specific plan guidance.
- Broader calendar integrations.
- New radar providers or another map tier.

These may become valuable later, but none should outrank a dependable Trust
Loop and a proven proactive weather promise.
