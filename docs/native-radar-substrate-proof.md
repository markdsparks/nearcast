# Isolated native radar substrate proof

Date: September 18, 2026. This is a **developer feasibility artifact**, not the next shipping Nearcast map. It is deliberately absent from `Nearcast.xcodeproj` and TestFlight. The existing map remains unchanged.

## What this settles—and what it does not

A small, separate SwiftUI app now renders the existing NOAA WMS weather sources through MapKit's `MKTileOverlay`/`MKTileOverlayRenderer`. It has a public test-place marker, native pan/zoom, recenter, refresh, and a two-position observed/forecast scrubber. Apple supplies only the diagnostic basemap; this does **not** change Nearcast's production basemap provider, keys, account, or attribution.

MapKit is used to make the smallest dependency-free raster test executable. **MapLibre remains the candidate for the full migration.** This proof is not evidence that MapKit can replace the existing numeric MRMS/HRRR textures, seam renderer, vector layers or optional StormScope adapter. No third-party SDK was added, and no paid session was activated.

The source transition is intentionally explicit, with no cross-source blend:

- **Observed radar:** latest advertised NOAA/NWS CONUS MRMS instant that is not in the future, with exact valid time and observed age.
- **Forecast:** next advertised NOAA/NWS NDFD six-hour precipitation-amount valid time. The UI says **“Forecast · 6-hour rain amount”** and explains that this is accumulation, not instantaneous radar or physical storm motion.
- The WMS advertised `TIME` is used unchanged. The slider does not manufacture hourly or subhourly images. Source generation/run time is not inferred from metadata fetch time.
- Weather attribution is always visible; MapKit's own attribution remains unobscured. The frame clock is explicitly device-local in this diagnostic app, not a claim of selected-place clock parity.
- Refresh failure retains original frame/metadata timestamps. No successful refresh of metadata implies fresh weather imagery. Image responses are validated, and the UI reports received/unavailable tile counts rather than interpreting an empty tile as “dry.”

## Files and running it

- `native/experiments/RadarSubstrateProof/RadarProofContract.swift`: pure projection, source/time, metadata and deterministic fixture contract.
- `native/experiments/RadarSubstrateProof/RadarProofApp.swift`: separate SwiftUI app, MapKit overlay, explicit two-frame transition and status.
- `native/experiments/RadarSubstrateProof/Info.plist`: separate identifier `app.nearcast.radar-proof` with no location or notification permission.
- `scripts/test-native-radar-proof.sh`: deterministic portable tests; optional `--live` reads public NOAA metadata and one image from each source.
- `scripts/build-native-radar-proof.sh`: compiles a simulator-only app using the installed iOS SDK. It prints the generated `.app` path. It does not modify the shipping project or install automatically.

Run:

```sh
bash scripts/test-native-radar-proof.sh
bash scripts/test-native-radar-proof.sh --live
bash scripts/build-native-radar-proof.sh
# Use the returned app path and an isolated simulator identifier:
xcrun simctl install SIMULATOR_ID RETURNED_APP_PATH
xcrun simctl launch SIMULATOR_ID app.nearcast.radar-proof
```

The proof is intentionally scoped to one public CONUS location. It does not request device location, export family places, publish widget/Watch state, register notifications, add service endpoints, persist accounts, or participate in Nearcast routing. No private test data is needed.

## Evidence

| Check | Result |
| --- | --- |
| World, quadrant and invalid XYZ → EPSG:3857 WMS bounds | PASS |
| Exact advertised time, future observed rejection, next forecast time | PASS |
| Nested WMS layer isolation; ignore sibling/parent/default time | PASS |
| Missing, malformed and interval-form time inputs | PASS; unsupported intervals are unavailable, never expanded silently |
| Standalone iOS 17-floor / iOS 27 SDK simulator compile | PASS |
| Existing live NOAA observed metadata + tile | PASS: `2026-09-18T20:38:15.000Z`, PNG, 1,670 bytes, z6/16/24 |
| Existing live NOAA forecast metadata + tile | PASS: `2026-09-19T00:00:00.000Z`, PNG, 11,416 bytes, z6/16/24 |
| Simulator installation and process launch | PASS on isolated iPhone 17 Pro Max simulator; process launch alone is not rendering evidence |
| Simulator visual render and source switch | PASS on retry after computer-use access became available: isolated iPhone 17 Pro Max visibly rendered observed NOAA tiles (28 received / 0 unavailable), then the **6h forecast** button switched to visible forecast accumulation (16 received / 0 unavailable). Separate source/title/timing and the accumulation explanation were displayed correctly; native MapKit attribution remained visible |
| Simulator pan, recenter and slider gestures | NOT VERIFIED: a computer-use map drag did not visibly change the viewport. The source-button switch above is not a slider-gesture pass |
| Physical iPhone 17 Pro / Pro Max pan, scrub, memory, background/resume | NOT RUN |
| Enhanced numeric MRMS/HRRR seam, RainViewer fallback, non-CONUS, StormScope/lightning, alert polygons | OUT OF SCOPE / NOT PROVEN |

Live results record point-in-time probes and a visual rendering check, not service reliability or forecast-accuracy validation. The selected PNG may be partly or wholly transparent; a PNG response alone is not proof of alignment or rain/no-rain at the marker. The simulator retry does not establish physical-device performance or enhanced radar parity.

## Next acceptance gate

1. Complete pan, recenter and slider-gesture checks in the isolated simulator; both selected-source states and the source-button switch have now been visually inspected. Do not count this as physical gesture/performance evidence.
2. Review and pin the full-renderer dependency separately. Validate MapLibre's desired raster/vector/custom numeric path rather than treating this MapKit spike as an architecture commitment.
3. Compare one synthetic numeric MRMS texture and one HRRR/seam output with matched web fixtures before any claim of enhanced radar parity.
4. Only after those checks, provision a dedicated device proof and record first visible weather tile, source-switch latency, peak memory, pan responsiveness, tile failures, offline/slow recovery and background/resume on both family phones. The current script is simulator-only and cannot satisfy this gate.
5. Validate native provider credential restrictions and attribution/rights separately before enabling production providers or paid layers. Do not activate StormScope as part of this proof.

## Primary references

- [Apple: MKTileOverlay](https://developer.apple.com/documentation/mapkit/mktileoverlay)
- [Apple: MKTileOverlayRenderer](https://developer.apple.com/documentation/mapkit/mktileoverlayrenderer)
- [NOAA observed WMS metadata](https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities)
- [NOAA NDFD precipitation WMS metadata](https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities)
- [Existing migration inventory and remaining gates](native-migration-baseline.md)
