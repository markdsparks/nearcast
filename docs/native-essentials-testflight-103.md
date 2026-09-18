# Native everyday essentials — build 103

September 18, 2026. This is the **read-only utility portion of Phase 2**, developed alongside the build 102 family test. It is not acceptance of Phase 1, completion of Phase 2, or a switch to native default.

## What is included

- A permanent native **Weather details** section below the forecast, plus a top-toolbar list button to reach it without scrolling through the day.
- Native air quality, official alerts, sun/daylight, wind/gusts, UV, humidity/dew point, visibility and precipitation details.
- Air quality remains quiet at normal levels. A fresh US AQI estimate of 101 or higher is promoted for Today; missing, outdated or future-day data is never promoted as a current reading.
- Relevant official bulletins are promoted; a single alert opens its full instructions directly, and multiple alerts have an exact bulletin list. A failed check never becomes an all-clear. Coverage is based on the existing place's country code and the NWS point/geometry response, not a guessed country or time zone. Bulletin expiry and expected event end are distinct—an expired bulletin does not prove that a hazard has ended.
- An interactive daylight timeline, sunrise/sunset jumps, a moving sun above/below the horizon and real hourly UV. This is a schematic daylight window, not a calculation of exact solar elevation. Missing sun times do not imply polar night.
- Detail charts and daily summaries retain the selected place/day and clock/units. Future-day humidity uses a range; wind/UV use labeled peaks; visibility uses a labeled minimum. None borrow today's current values.
- AQI and alerts load separately from the main forecast and refresh while the preview is active. No background task, new notification target or permission is added.

The optional `countryCode` addition to the version-1 preview export is backward compatible. Existing contexts without it still open, but cannot claim that an empty official-alert response proves coverage. Web assets **3.0.410** carry the new allowlisted field; native build **103** consumes it.

## Family test

Continue the build 102 first-glance/touch comparison independently. When trying 103:

1. Open **Menu → Native weather preview**, then use the list button at the upper right. Can you find air quality and sunset immediately, without instructions? Both are also below the forecast.
2. In Sun & daylight, move the slider, tap Sunrise and Sunset, and reset to Now. Check a European place and the 24-hour clock. At night the sun should be visibly below the horizon, not disappear from an empty arc.
3. Open tomorrow and inspect wind, UV, humidity and visibility. Air quality should explain that only the current estimate is available, not show today's reading as tomorrow's.
4. Check an official alert where one is available. Read its full instructions and valid times. For a European place, the native preview should explicitly say its current alert source does not cover that location.
5. After loading, disable connectivity and use **Check again** in AQI/alerts. Last-known information must be labeled unverified, not newly refreshed; missing alerts must not appear as an all-clear. Restore connectivity and retry.
6. Rapidly change between two saved places, use larger text, and open/close several details. No late response should overwrite the new place, and no text should be clipped. Closing a detail should keep your prior forecast position.

The existing app remains the default. Places/settings, Plans/Ask, notifications, widget/Watch publishers and production radar keep their existing owner. This build does not migrate durable records. Existing alert-notification entry routes still use the existing app.

## Engineering evidence and release record

- Portable product checks and native forecast/preview/outlook/essentials/lifecycle/sun/detail/radar-proof regression suites: PASS.
- Full native simulator project: BUILD SUCCEEDED (iOS 27 SDK, existing iOS 17 deployment floor).
- New-screen visual inspection: **BLOCKED**. Computer-use access reported that the Mac is locked and could not unlock automatically. No visual or touch pass is claimed. TestFlight upload is intentionally held until the candidate can be inspected.
- Live public Maryville data probe: current AQI and two NWS bulletins decoded successfully. This check exposed and corrected the distinction between bulletin expiry and hazard end; synthetic regression cases preserve it. A point-in-time probe does not establish provider reliability.
- Supplemental-source tests cover geography/alert windows, missing/zero/stale AQI, country coverage, independent failures, cache expiry and late responses.
- Selected-day detail tests cover 30-minute current freshness, current-hour fallback, future-day isolation, units, local dates and 12/24-hour clocks. Sun tests include 23/25-hour DST days and missing/polar evidence.
- Physical touch, full VoiceOver, performance and Watch delivery remain device acceptance checks, not inferred passes.
- Source commit: pending.
- Signed archive / TestFlight: not uploaded; visual gate pending.
- Web 3.0.410 deployment: pending.

## Radar proof, separate from this build

The [isolated native radar proof](native-radar-substrate-proof.md) compiles as a separate simulator-only app and exercises the existing NOAA observed and six-hour accumulation sources. It is **not included in Nearcast or this TestFlight**. It adds no shipping SDK, endpoint, paid provider session or production map change. Native enhanced MRMS/HRRR rendering, source seams, remaining layers and physical-device performance are still unproven.

## Guidance references

The detail explanations use [EPA UV/cloud guidance](https://www.epa.gov/sunsafety/calculating-uv-index-0) and the [AirNow US AQI categories](https://www.airnow.gov/aqi/aqi-basics/). Air quality is labeled as an [Open-Meteo/CAMS modeled estimate](https://open-meteo.com/en/docs/air-quality-api), not a sensor at the user's address.
