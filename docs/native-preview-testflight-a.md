# TestFlight A — native weather preview

Prepared September 18, 2026. **Native build: 101. Web assets: 3.0.409.** Release source: `2423a62`. Signed with the existing Apple Distribution identity matching all four profiles.

**Status: uploaded to TestFlight; Apple processing at handoff.** Upload succeeded September 18 at 14:43 CDT. The matching web assets are deployed and verified. TestFlight availability after processing and family acceptance are not yet confirmed.

This is the first family comparison checkpoint in the [native migration plan](native-migration-plan.md), not completion of the native migration or acceptance of Phase 0/1.

Follow-up: the family confirmed build 101 works but needs a better experience. [Build 102 refinement notes](native-preview-polish-102.md) track the next iteration within this same checkpoint.

## What changes in this candidate

The existing Nearcast app remains the default. On a build that supports the new bridge contract, open the menu and choose **Native weather preview**. Older installed builds must not show a working preview entry merely because the live website has newer assets.

The preview includes native:

- Today, current conditions, outlook, hourly trend, and daily list.
- Detailed hourly exploration, authentic 15-minute coverage where returned by the service, and selected-day forecasts.
- Temp, Feels, Rain, Wind, and available UV views, with consistent selected-state feedback. Missing 15-minute UV is not invented from hourly data.
- Temporary selection among an allowlisted export of existing saved places.
- Inherited units, 12/24-hour clock preference, appearance, and destination-local dates/times.
- A separate weather cache with original source update times and explicit refresh-failure handling.

The preview reads existing saved places/preferences; it does not take ownership of those records, edit plans, or independently publish widget/Watch weather. The shared weather service remains unchanged, and calibrated values are not calibrated a second time.

## Safe return and temporary handoffs

Use the preview's close control to return to existing Nearcast. **Closing alone preserves the existing app's selected place and user records**, even if you inspected another place in the preview.

Map, Plans, Ask, and unmigrated details explicitly ask **Open in existing Nearcast?** Confirming exits the preview before handing over the selected place and applicable date. From that point, the existing app behaves normally: selecting the requested place may update its widget and Watch weather, and explicit actions in Plans or Ask may save or change records. Do not describe a confirmed handoff as read-only.

Map handoff was checked in the iPhone 17 Pro simulator: tomorrow opened on tomorrow's forecast timestamp, while a day beyond map coverage closed the map and explained its shorter horizon. Late arrival of shorter-range guidance must not replace the requested day's valid timeline. Ask and other handoffs also have focused contract tests; physical-device route acceptance remains part of this round.

## Important limitations

**This preview is not a complete daily replacement yet.** Native AQI, sun/daylight details, official alerts, radar, Ask/AI, and Plans have not been ported. Official alerts remain in existing Nearcast; the preview's lack of an alert is not an all-clear.

Saved-place editing/search and preference ownership remain in the existing app. Quarter-hour views stop at supported coverage; other days remain hourly. Existing widgets, Watch, notifications, and Live Activities continue through their current publication path.

Physical-device performance, accessibility, offline behavior, and Watch delivery are not established by the automated checks below. No new calendar access, account sync, notification target, background permission, or notification policy is introduced.

## Family testing devices

Run all six phone tasks on **iPhone 17 Pro** and **iPhone 17 Pro Max**, both on the latest installed iOS 27. Record the exact iOS build during the test round.

The **Apple Watch Ultra 2** is present on watchOS 27 according to the Device Hub inventory. Its exact OS build and the pairing used for this round still need to be recorded. Watch delivery acceptance remains pending.

## Six family tasks

1. **Get a first weather read.** Open the preview and answer: What is it like now, and what changes next? Switch Temp → Feels → Rain → Wind → UV where available. Confirm the selected control and displayed values agree. Scroll vertically starting with your finger on the chart; look for clipped text, competing gestures, or a stuck selection.

2. **Explore the next few hours.** Open Hourly, move through the list, then switch to 15 min when available. Confirm times include the expected minutes, coverage is limited rather than invented, and returning to Hourly works. Return to Today without needing to hunt for a close control at the top of a long list.

3. **Follow a different day.** Open tomorrow from the daily list, inspect its outlook and evening hours, and return to Today. Check that the date, high/low, hourly rows, and place remain the ones you chose. A day outside quarter-hour coverage must not show today's 15-minute readings.

4. **Check places and preferences.** Select a second saved place, including one in another time zone if available, and switch quickly between two places. Watch for late weather from the previous place. Check the inherited clock and units; change those in existing Nearcast before reopening the preview if testing both settings. Close the preview without a handoff and verify that existing Nearcast still has its prior selected place. Compare the widget/Watch location without assuming an immediate background refresh.

5. **Try a connection failure.** After a successful load, enable airplane mode and refresh or reopen the preview. Saved weather should keep its original update time and make failed refresh clear. Reconnect and retry. Engineering must separately test a genuinely cold cache: it should show unavailable/retry, not fabricated weather. Do not delete user records to simulate a cold cache.

6. **Exercise the confirmed return path.** Select a different place/day and request Map or another unmigrated destination. First cancel the confirmation and verify the preview stays put; then confirm and check the exact destination/place/date where supported. A date beyond map coverage should explain that limit rather than show another day. Ordinary existing-app behavior resumes only after that confirmation. Confirm existing plans and notification selections remain intact; do not create extra watched targets just for this check.

For each task, record pass/fail/not tested, device/OS build, expected versus actual result, and a screenshot if useful. Keep private examples local; do not commit family coordinates, plan text, or identifiers into the repository.

## Engineering evidence and remaining gates

These results describe the current development run, not a signed distributed release. Re-run required checks against the final release commit after fixes.

| Check | Current result | What it does not prove |
| --- | --- | --- |
| Portable suite | PASS in engineering run | Physical interaction or release acceptance |
| Native-model suite | PASS in engineering run | Widget/Watch delivery on real devices |
| Full native project build | PASS in engineering run | Signed archive validity or successful upload |
| Forecast contract tests | PASS: provenance, exact values, units, nulls, current selection, local dates/DST, authentic quarter-hours, weather interpretation, scoped thunder | Live provider accuracy or all physical-device states |
| Preview/context tests | PASS: allowlisted validation, coordinate dedup, preferences, storage isolation, exact encoded handoff, place races, cancellation | Every actual web destination executing its route correctly |
| Offline cache and source-age contracts | PASS in automated tests: original timestamps retained, failed refresh preserves valid cache, corruption/expiry handled | Airplane-mode behavior observed on both family phones |
| Simulator Today → Hourly → 15 min → selected day → return | Observed in engineering testing | Family acceptance, real touch behavior, or measured performance |
| Map exact-day and unavailable-day handoff | Observed on iPhone 17 Pro simulator after correction; asynchronous range replacement covered by regressions | Physical-device routing acceptance and every provider state |
| Long place name, nighttime palette, hourly condition width | Observed on Pro/Pro Max simulators after correction | Large-text and VoiceOver acceptance |
| Signed archive validation and TestFlight upload | PASS for build 101; Apple accepted the upload and began processing | Completed processing, tester availability, or physical acceptance |
| Physical launch/scroll/chart performance | **NOT TESTED** | Record comparable existing/native timings on both phones |
| Large text, VoiceOver, reduced motion, appearance | **Physical acceptance pending** | Simulator screenshots alone are insufficient |
| Watch/widget/notification delivery and hydration regression | **Physical acceptance pending** | Preview tests do not validate background delivery or subscriptions end to end |
| Family feedback and phase promotion | **PENDING** | Existing app stays default until explicit acceptance |

Stop testing and report immediately for a wrong place/day, stale readings presented as newly updated, missing user records, unintended notification changes, a crash, or blocked primary navigation. Correct the candidate within this checkpoint; do not silently advance to a later phase.

## Release completion record

- Final native build / web version: **101 / 3.0.409**.
- Final source commit: **2423a62** (subsequent documentation-only commit records release results).
- Signed archive validation result: **PASS**; iPhone, widget, Watch, and complications packaged with matching build numbers.
- TestFlight upload and processing result: **Upload succeeded**, September 18, 2026 at 14:43 CDT; Apple reported processing, not yet confirmed available.
- Web deployment: [successful release run](https://github.com/markdsparks/nearcast/actions/runs/35387357642); production app and update marker verified as 3.0.409.
- Exact phone and Watch OS builds / pairing: **physical record pending**; simulator checks used iOS 27.0 on Pro/Pro Max profiles.
- Known remaining limitations communicated to testers: read-only preview, existing app remains default, unported details/alerts/radar/AI/plans, physical behavior and Watch delivery pending.
- Family acceptance or corrective-build request: **pending; do not promote to native default**.
