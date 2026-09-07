# Shared forecast — v3.0.404 / native 99

Home and independent widget/Watch/complication refreshes now share temperature calibration and current-hour selection. This is a consistency release, not a new provider, notification policy, or accuracy guarantee.

## Contract

`GET /api/forecast?lat=38.723&lon=-89.956&unit=fahrenheit&precipitation_unit=mm`

- Finite geographic coordinates only, rounded to three decimals before fetch/cache.
- Temperature: `fahrenheit` or `celsius`; precipitation: `inch` or `mm`.
- Native always requests millimeters: its precipitation semantics use mm thresholds even in Fahrenheit mode.
- The response retains the Open-Meteo shape with 14 full local days and six hours of 15-minute inputs. Model median and NWS daily bounds are applied before native clients select their current-hour window.
- `_nearcastForecast` version 1 carries generation time, requested coordinate/units, source readiness, original temperature/current baselines, NWS periods, and nearby observation evidence. Generation time is preserved across the five-minute response cache.
- Source requests are bounded; missing supplemental sources never mean agreement. A missing primary forecast or required current reading fails the request. Native keeps its prior snapshot and existing stale/unavailable treatment; Home can use its existing provider fallback.
- NWS thunder language remains qualified evidence, separate from WMO codes. It does not prove lightning or rain at the selected place. Radar confirmation is not provided by this endpoint.
- No plan names, place names, saved-place IDs, accounts, calendar data, or notification targets are requested or included. The coordinate cache is an ordinary weather-response cache, not user history. Cache misses are rate-limited per requester.

## Implementation

`shared-forecast.js` owns pure parameter construction, temperature normalization/calibration, NWS normalization, and current-hour selection. `workers/shared-forecast-service.mjs` fetches existing providers and resolves the native payload. Home restores the original baseline before calling the same helpers; this avoids compounding adjustments when later evidence arrives. Unit conversions preserve converted original baselines and discard original-unit transport metadata.

`NearcastSharedForecast.swift` decodes provenance and qualified thunder periods; the three native clients no longer request raw Open-Meteo forecasts directly. Shared snapshot `uses24HourClock` is optional for backward compatibility, follows the app's resolved setting when present, and survives asynchronous merges.

Notification and Live Activity evaluator forecast fetching has not been changed. They remain a separate follow-up and must not be described as using this new endpoint.

## Verification

- Portable checks: shared core, Worker contract, Home hydration, missing sources/readings, hour rollover, coordinate/unit isolation, old-cache baseline, in-flight unit change, and native source contracts.
- Native model checks: metadata/freshness/current-hour slicing/thunder qualification plus clock formatting, serialization, and async merge preservation.
- Build all iPhone/widget/Watch/complication targets, then archive validation before upload.

## Family TestFlight scenarios

1. Choose 24-hour time on the phone. Check Hourly, a widget, Watch hourly, sunset, and plan timing. Change to 12-hour and repeat. The place timezone should not change.
2. Select a family place in another timezone. Compare local hour and sunset on phone and Watch; confirm midnight belongs to that place, not the phone's timezone.
3. Let the phone app close, then refresh Watch. Compare the same place/day high and upcoming hourly temperatures with Home after reopening. Different refresh timestamps can still produce legitimate changes.
4. Switch Fahrenheit/Celsius while a refresh is pending. Look for a unit-consistent temperature, wind speed, and no sudden double correction.
5. In an area with NWS thunder wording but no confirmed local lightning, look for a qualified possibility. A possibility badge must not imply that a thunderstorm is occurring overhead.
6. Try poor connectivity and return later. Last-known weather must not become newly timestamped just because the refresh failed. Check existing exact-place/alert/plan deep links still open their original destination.
