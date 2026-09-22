# Native companion reliability checkpoint — September 21, 2026

## Scope

Finish the everyday widget / Ultra 2 experience in the isolated Nearcast Dev
lane. Production/TestFlight identities, existing saved data, notification
consent, remote delivery and location permissions remain unchanged. This is
not a Release promotion or a declaration that physical acceptance passed.

## Reliability repairs

- Phone → Watch context: a successful newer publication clears any failed
  older pending context. Later install/state callbacks cannot restore the old
  queue entry. Failed sends retain the newest receipt for recovery/replay.
- Complication transfer budget: publication generations and display aliases
  are no longer interpreted as new places. Real selection, unit/clock and
  urgent-alert changes still qualify for priority; ordinary weather updates
  retain the existing throttle and OS quota.
- Phone activation: a transient WatchConnectivity activation error releases
  the activation latch so subsequent pending sends can activate again.
- Watch recovery: a failed immediate request falls back to the durable
  background queue. Outstanding recovery requests coalesce across receiver
  restarts. Failed transfers use bounded 1/3/8-second retries; later lifecycle
  recovery has a 60-second minimum request interval. Reopening the Watch app
  now checks recovery even if its session was already activated.
- Phone widget travel failure: a confirmed move plus failed weather fetch
  explicitly invalidates weather, preventing freshness arbitration from
  resurrecting origin weather alongside a destination alert.
- Complication deadlines: exact alert/event/plan transitions and weather/plan
  validity boundaries no longer disappear beside nearby hourly entries.
  Completed plans become empty, and plan evidence becomes stale at its actual
  two-hour boundary. Normal projections remain bounded to 24 hours; a small
  fixed set of terminal expiries may extend beyond that horizon.

## Executable evidence

New native CI entries compile actual production code with deterministic
transport/platform fixtures, without touching a device or a personal store:

- `scripts/test-native-watch-sync.sh`: pending A failure followed by successful
  B, install replay, semantic priority, quota exhaustion, duplicate receipts,
  activation coalescing/failure recovery, and the real foreground retry timer.
- `scripts/test-native-watch-receiver.sh`: immediate-error fallback, durable
  queue coalescing, bounded retries, foreground recovery, late callbacks,
  coherent publication validation, freshness preservation and cancellation.
- `scripts/test-native-complication-timeline.sh`: 31 assertions over the actual
  timeline/projection/entry functions, including deadlines seconds apart,
  expiry beside an hourly entry, exact plan completion, count limits and
  invalid timestamps. Both old-behavior mutations fail.
- The existing shared snapshot suite includes the widget travel-failure
  atomic-store regression and successful refresh recovery.

Focused suites and the Watch structural smoke passed. The broad portable
command stops at an already-missing tracked `Package.resolved` in the Xcode
workspace. That unrelated deletion was not restored or concealed. Running
the remaining portable smokes separately produced zero failures, including
the strict 26-fixture weather-truth check; this is not a full portable-gate pass.

The full native-model gate passed. After removing the experimental Watch
movement slice, the final optimized signed iPhone build (including widget,
Watch and complications) succeeded. Both app bundles passed deep/strict code
signature verification with normal Mac trust access. The final phone Dev
update installed successfully with data preserved. The new focused suites
and shared snapshot tests were rerun against the retained final sources.

## Physical acceptance — partial, September 21

The unlocked-Mac walkthrough verified the following on the physical iPhone 17
Pro Max and Ultra 2 (not simulators):

- Both installed lanes are present: older Nearcast build 123 and Nearcast Dev
  build 133. The pre-existing Home Screen widget opened build 123's older
  experience, so it was not exercising the new Dev fixes.
- With the user's approval, a separate small **Nearcast Dev** Home Screen
  widget was added; the old widget was left intact. The Dev widget opens the
  native Dev forecast, without an incidental notification sheet.
- After a forecast refresh, the native phone and Dev widget both showed
  Maryville, 73°F, feels 76°F, high 74°F / low 68°F.
- Explicitly launching `app.nearcast.ios.dev.watch` showed Maryville, 73°F,
  high 74°F / low 68°F, north wind 8 mph and 9% precipitation. Its **Next 4
  hours** and **Next 3 days** pages rendered and could be paged through.
- A Watch-face weather complication rendered, but both lanes' extensions
  were running. Its specific provider was not established, so this is **not**
  yet Dev complication-routing acceptance.

The user approved a temporary Chicago/Celsius/12-hour switch test with cleanup.
Original preferences were Fahrenheit and Auto clock; only Maryville was saved.
The test reached Celsius, but the device stream then failed with **AVC stream
RTCP timeout** (CoreDevice 9015 / DeviceKit 4000) and the phone locked. At that
checkpoint, Chicago had not been added and 12-hour time was not verified.
Settings restoration and the remaining switch checks must be verified after
reconnecting; do not infer success from queued taps or a stale screen image.
Device Hub subsequently marked both physical devices unavailable, with the
phone message: **must be nearby or plugged in to connect with this Mac**.
The last confirmed temporary setting is Celsius; restoration to Fahrenheit
has not been claimed.

Place/preference convergence, local plan lifecycle, Dev complication identity,
disconnected/background recovery and exact-expiry presentation remain open.

### Earlier connection attempts

Xcode initially listed the iPhone 17 Pro Max as connected and Ultra 2 as paired.
The installed phone Dev app was visible. Direct Watch app listing and later
phone container/lock-state queries timed out. The Mac was locked and its
automatic unlock failed, so no new visual acceptance is claimed.

The connection subsequently recovered enough to install and launch both final
Dev apps successfully on the physical iPhone and Ultra 2, with existing data
preserved. A read-only attempt to compare their shared publication receipts
was rejected by CoreDevice's allowed-directory policy on both devices; no
receipt contents were copied, and no alternative access route was attempted.
Installation/launch is verified, but actual receipt/display and closed-phone
background behavior still require the unlocked-device walkthrough.

When the connection is restored, use the matching **Nearcast Dev** widget and
Watch app, not the separate TestFlight companions. Keep existing data:

1. Open native weather and verify the same named place, units and current
   readings on the Home Screen widget, Watch app and complication.
2. Switch between two saved places; change units and clock format, then restore
   the original preferences. Check every surface for mixed or old values.
3. Create and delete one clearly named local test plan; verify presentation and
   removal without enabling remote notifications.
4. Close the phone app, reopen the Watch, and test a temporary disconnect and
   reconnect. Observe eventual delivery without assuming an exact background
   refresh cadence; watchOS/WidgetKit decide when background work runs.
5. Check cached, expired, unavailable and exact-expiry presentations. A queued
   phone context is not proof that the Watch received or displayed it.

## Current Location provenance repair — installed in Dev; travel acceptance open

The shared snapshot now carries independent weather and alert coordinates.
Location resolution ordering is separate from forecast issue time. Phone
weather/content publication, widget refresh and named-place complication
refresh stamp their respective domains; the Watch persists a resolved travel
invalidation before fetching and reads that durable result after failure.

The atomic publication merge now prevents late origin weather or alerts from
returning after a newer location resolution, including when destination weather
is unavailable or units changed. Unknown destination alerts are not presented
as an all-clear. Repeated same-destination failures keep useful cache. Small
failed-refresh movements remain measured against the actual weather anchor,
not an advancing GPS breadcrumb trail. Complications still do not independently
fetch the phone's potentially old Current Location anchor.

Executable shared-store tests cover travel invalidation, late phone metadata,
older-issued destination forecasts, repeated destination failures, out-of-order
responses across a second move, monotonic location ordering, units changes,
legacy snapshots, accumulated small movements, serialization, invalid fixes
and date-line proximity. These are local deterministic checks, not physical
GPS/background acceptance. No new location permission is requested by tests.

This replaces the previously removed eager-invalidation experiment with a
persistent location-aware contract. Install and actual-device travel/recovery
checks remain required before closing unrestricted Current Location acceptance.

Final local verification: the optimized **Nearcast Dev Performance** generic
iOS build succeeded with embedded widget, Watch and complication targets.
Both final phone and Watch app signatures passed deep/strict verification.
The native-model gate and full portable gate passed; focused shared-store,
Watch receiver and native publication tests also passed. The shared-store
suite was rerun after the final destination-data safeguards. Missing readings
after known travel no longer borrow origin fallback values. `git diff --check`
is clean. Existing compatibility-shell compiler warnings remain; this is not
a warning-free-build claim.

No device installation, TestFlight upload, service deployment, subscription,
permission or user-setting change was performed during this away-from-home
work. The phone remains at the last physically confirmed test state (Celsius)
until the user changes it or cleanup can be verified on-device. Next session:
install the local Dev build, finish the approved switch test, restore Maryville /
Fahrenheit / Auto clock, and verify Dev complication and recovery behavior.

### Portable dependency gate repair

Repeated restoration of Xcode's workspace `Package.resolved` did not persist.
The portable Operon smoke now checks the checked-in project requirement,
which is tightened from `upToNextMajorVersion` to exact **0.4.0** (the already
validated/cached version). It no longer relies on generated workspace state.
The full portable suite, including all 26 strict weather-truth fixtures, passes.
No dependency upgrade or provider activation was performed.

## Physical Dev verification — September 21, evening

Installed the final locally verified DevPerformance phone and Watch apps on
the physical iPhone 17 Pro Max and Apple Watch Ultra 2. The first Watch install
disconnected; a retry after the user confirmed it was unlocked and nearby
succeeded. Explicitly launched `app.nearcast.ios.dev.watch` for the Watch checks.

The approved switch test passed on the phone, existing separate Nearcast Dev
Home Screen widget, and Dev Watch app:

- Added disposable Chicago, Illinois; selected it and changed to Celsius and
  12-hour time. Phone and widget both displayed Chicago at 18 degrees; Watch
  displayed Chicago at 18 degrees with km/h. Watch hourly labels used 6p/7p/8p.
- Tapping the Dev widget opened the native Chicago forecast.
- Restored Maryville, Fahrenheit, and Auto clock; removed only the test Chicago
  saved-place record. Verified Maryville was the sole saved place afterward.
- Dev widget and Watch then both displayed Maryville at 72 degrees; Watch wind
  returned to mph and hourly labels to 19:00/20:00/21:00. The phone was on its
  Home Screen during the final Watch verification (backgrounded, not force-quit).
- The older Nearcast app/widget were left untouched. The older widget still
  showed its weather-needs-refresh state; that is not the Dev widget result.

Observed follow-ups: removing the disposable place showed "Places are saved.
Notification cleanup will finish when the existing app reconnects." despite
native-only Dev testing. Review this compatibility-era cleanup path/copy before
cutover; do not infer that remote notification cleanup succeeded. Watch 24-hour
column labels also look crowded and deserve a layout pass.

Still unverified: Dev complication provider identity/deep-link routing, local
plan lifecycle on companions, true disconnected/background recovery, expiry
presentation, and physical Current Location travel. The named-place switch
test does not close those acceptance items. No TestFlight/production release,
notification enrollment, or location permission change was performed.

### Follow-up: native place removal cleanup

Fresh native profiles no longer enqueue legacy stop-watch deletion work. The
retained legacy source export distinguishes verified imported profiles, whose
cleanup queue and acknowledgement behavior remain unchanged. A native store
read atomically retires pre-fix native-only queue entries, preserving the source,
receipt history, and deletion watermark; controller startup/resume triggers
that reconciliation when needed. Native-only removal copy no longer promises
legacy notification synchronization.

Regression coverage includes fresh removal, prior-queue repair and replay,
alongside the existing imported-profile ACK/concurrency/storage suite. Places,
native-only Places contract, deep-link router, Watch receiver/sender recovery,
and actual complication timeline expiry checks passed. The signed DevPerformance
build succeeded and the repaired phone app was installed on the physical device.
Post-install Settings visual verification is pending: the phone locked and its
launch timed out. No preferences were changed in this follow-up.

The exact Dev rain-complication URL was sent to the physical Watch with a clean
app restart; CoreDevice reported a successful launch, but Device Hub displayed
a black screen. This is not a verified destination, face-provider identity, or
disconnected-recovery pass. Existing watch-face configuration remains untouched.

User subsequently confirmed the notification-cleanup message is absent in
Settings on the installed repair. Mark that UI check as user-verified. Device
Hub later reported a call/VoIP screen-sharing conflict, but the user confirmed
there was no call; treat that as an unconfirmed/stale tooling diagnostic, not
evidence of phone activity or a Nearcast defect.

### Evening continuation: Ask and plan acceptance

Physical Dev Watch route checks now passed visually: the rain-complication URL
opened Next 4 hours, and the plan URL with an empty library safely opened Today.
This verifies app destinations, not the provider identity installed on the face.

Created a local **QA test walk** for Maryville on September 21, 19:00–20:00.
Native review displayed a mostly dry-looking window with rain/gust evidence;
save opened native plan detail, with notifications explicitly Off. The Watch
received the plan title and summary, and its plan URL opened that page. An edit
was opened and its title changed, but cancelled before save during unstable
screen rotation. No edit persistence pass is claimed. The saved original test
plan remains and needs removal; no remote notification was enabled.

Physical Ask exposed a generated-date error: a tomorrow-afternoon request used
September 20, despite the current local date being September 21. Added clock-
grounded today/tonight/tomorrow forecast/hourly routing after place resolution,
with regression checks for stale model output, afternoon bounds, unchanged
unspecified follow-ups, and actual conversation execution. Plans/Ask, offline
Ask, and plan-evidence tests pass; signed DevPerformance build passed and the
repair was installed. Physical post-fix Ask retest remains open: the remote
display lagged, rotated, and eventually showed a different foreground app.
Stopped input rather than interacting with unrelated controls.

Remaining immediate checks: physical corrected Ask answer/date, saved plan
reopen/edit/delete and Watch removal, then true disconnected/background recovery.
No TestFlight or production promotion occurred.

### Final September 21 retry: phone acceptance

The QA plan survived the app update, reopened, saved its edited title, and was
deleted through native Plans. The empty library showed All plans (0). This
supersedes the earlier outstanding phone edit/delete check; only the disposable
QA plan was removed, and notifications stayed Off.

The date-grounded Ask retest selected September 22 correctly but exposed a
second defect: generated prose claimed afternoon data was absent despite six
supplied afternoon hours. Final answer generation now excludes stale assistant
answers and explicitly identifies the resolved dates and evidence count. A
narrow contradiction guard falls back to the deterministic forecast read when
generated prose denies the supplied forecast. This is not a general semantic
verification guarantee for every model answer.

Plans/Ask and offline Ask regression suites and the signed DevPerformance build
passed. Installed the repair on the physical Dev phone. The exact walk question
then returned 2% rain chance for 12:00–17:00 and a 14:00 suggestion at 71°F;
expanded evidence showed Maryville, September 22 and the supplied afternoon
hours. This closes this specific physical Ask regression, not all conversational
or plan-drafting acceptance.

Device Hub initially blocked Watch deletion verification with an error displaying
screen contents. On retry the display recovered; launching the Dev plan URL
visibly returned Maryville Today rather than the deleted QA plan, matching the
empty-library fallback. This confirms the foreground deletion route, not
disconnected delivery. Complication face identity, disconnected
and background recovery, expiry presentation and physical travel remain open.
No TestFlight/production promotion or notification enrollment occurred.
