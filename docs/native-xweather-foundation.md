# Native StormScope foundation (not enabled in the app)

## September 20 product follow-up

Storm Check is removed from the native app at the user's request. It is a
separate local precipitation-analysis experiment, not the Xweather StormScope
integration described here. Nearcast's own enhanced radar remains the default.

The recommended next Xweather evaluation is **observed lightning on the existing
map**, not a second radar mode. This is a proposal, not an enabled capability.
Native-use licensing has already been confirmed by the user, but exact product
entitlements and native credentials still need verification before activation.

- Prefer a separately selectable lightning layer that preserves Nearcast radar,
  the timeline and official alerts. Show observation time and stale/unavailable
  states; never carry observed strikes into future forecast frames as predictions.
- MapsGL documents native lightning layers, while the direct Weather API exposes
  strike coordinates/timestamps and supports a data-overlay approach. Compare the
  existing plan's permissions, usage and actual device overhead before choosing.
  MapsGL access does not establish direct API access.
- Standard direct lightning API access is bounded to the latest five minutes,
  100 km radius and 1,000 events per query, with a 10x multiplier in the current
  documentation. Older data requires a separate add-on. Do not promise historical
  playback or nearby-strike summaries outside the verified data/entitlement.
- The current proof requires StormScope activation and nearby radar activity.
  A lightning-only design must replace that coupling: radar echoes are not a
  prerequisite for checking lightning, and no returned strikes is not an all-clear.

References checked September 20, 2026:
[MapsGL layers](https://www.xweather.com/docs/mapsgl/weather-layers),
[Lightning API](https://www.xweather.com/docs/weather-api/endpoints/lightning).

## Current checkpoint

The native configuration client, strict lease contract, and isolated MapsGL
adapter are sidecars only. They are not members of the shipping app target;
the app does not initialize this SDK or start native Xweather sessions.
No provider data request or paid session was made during this proof.
The isolated Worker route change is committed but has not been deployed by this
checkpoint. It must be deployed along with the native credential setup before
an integrated native client can receive a permit.

Local verification:

- `bash scripts/test-native-xweather.sh`: Swift 6 contract and mocked client
  tests, including audience, expiry, lifecycle, explicit activation, redaction,
  response bounds, no caching, and no automatic retries.
- `node scripts/radar-capability-smoke.mjs`: web behavior, native credential
  isolation, shared monthly budget, separate SDK session identity, and no native
  budget bypass.
- Official MapsGL MapLibre adapter and Nearcast's candidate adapter typechecked
  with the iOS 27 simulator SDK, MapLibre 6.31.0, and Swift 5 language mode. This
  is API compatibility evidence, not a rendering or network-cancellation test.

## Configuration required before activation

Use a credential pair authorized by Xweather for the **iOS bundle namespace
`app.nearcast.ios`**. Being subscribed to MapsGL does not establish that an
existing web-domain credential pair is authorized for the iPhone app.

Store that pair separately on the existing Worker:

- `XWEATHER_IOS_CLIENT_ID`
- `XWEATHER_IOS_CLIENT_SECRET`

Never place credentials in source, build settings, fixtures, logs, or screenshots.
The route `POST /api/xweather/config?client=ios` returns audience
`app.nearcast.ios`, or fails closed with no credentials when either native value
is absent. It never substitutes `XWEATHER_CLIENT_ID/SECRET`. The audience is a
client-validation label, not caller authentication or secret access control.

The existing no-query web lane remains unchanged. Native and web use the same
monthly budget ledger and gate configuration, but separate five-minute session
identities. A web testing budget bypass cannot enable native provider work.
Native leases also require foreground, visible map, explicit selection,
non-satellite mode, active nearby weather, sufficient zoom, and unexpired time.
Returning to the map does not resume a stopped session or acquire another lease.

## Exact SDK candidate

- Package: <https://github.com/vaisala-xweather/mapsgl-apple-sdk>
- MapLibre release branch: `release/maplibre/1.7.1`
- Pin revision: `22f77238addf0ce0242acd0b5392c5623a4b5442`
- Product: `MapsGL`; imports `MapsGLMaps`, `MapsGLMapLibre`, and `MapLibre`.
- Do **not** select the plain `v1.7.1` tag; its manifest uses the Mapbox channel.
- Manifest accepts MapLibre >=6.18.0 and <7.0.0, compatible with our exact 6.31.0.
- Additional dependency: Turf exact 4.0.0
  (`bf840e6b9529d105687840fe2c9dcd74197d46d1`).
- Package minimum iOS 16, Swift tools 5.9. Official adapter has Swift 6 strictness
  warnings; the current app's Swift 5 language mode compiled successfully.

Verified official binary archives:

| Framework | Download bytes | SHA-256 |
| --- | ---: | --- |
| MapsGLCore | 11,047,008 | `09fa7d13db96008229ddabceaa455641f009b46420a38c99108ac05fc6cde531` |
| MapsGLRenderer | 14,376,463 | `dfc784ff01e300e3a43a9047fe1361e25f3009a083e3d5a41e8ff4712c9395c4` |
| MapsGLMaps | 77,452,406 | `041f61f4f3b31e21864b123b3c90666a4d570f03eb93d5f72932f86175519846` |
| Turf | 17,668,925 | `ce43384a6f875ab4becdd6bdb7ca60447e5e9133f2acf325dc57be381b52a34c` |

Device framework slices occupy roughly 52 MiB combined before archive stripping
and App Store processing. Measure the actual thinned IPA impact before shipping;
the multi-platform download sizes are not the app download size.

## Minimal later integration

1. Pin the MapLibre-channel package and add the sidecars to the app target only
   after credential setup and the runtime gate below are ready.
2. On explicit StormScope selection, validate the current surface and obtain one
   native lease. Do not authorize from map appearance, saved state, panning,
   permission callbacks, background wake, or automatic refresh.
3. Create `MapLibreMapController(map:account:)` using the ephemeral
   `XweatherAccount(id:secret:)`. The SDK owns authentication and provider URLs;
   do not invent a second native HTTP authentication path or spoof a web referer.
4. Add observed `.radar`, optionally `.lightningStrikesIcons` after its separate
   explicit request. Keep provider layers below `native-labels` and display a
   visible linked “Powered by Vaisala Xweather” attribution.
5. Drive `update(surface:)` and `stop()` synchronously on background, map removal,
   source/style change, satellite selection, low zoom, lost relevance, and expiry.
   Remove layers and sources, not merely their visibility. Stop no later than
   two seconds before the lease boundary. Lightning is separately bounded to
   90 seconds and zoom >=8.5 in this candidate.

The official adapter temporarily installs a forwarding MapLibre delegate proxy.
Do not assign `map.delegate` again while it is active. It restores the prior
delegate when released. Its additional tap forwarding also needs device checks
alongside Nearcast's marker and alert gestures.

## Runtime gate still required

The candidate is intentionally observed-radar-only and is not yet an integrated
timeline implementation. Before enabling it, verify real device rendering,
source/frame transitions, startup failure handling, teardown on every host path,
delegate restoration, absence of retained map/controller instances, and network
drain at expiry/background/source changes. Public removal APIs exist, but the
binary SDK does not expose a universal cancel-all method; compile success alone
does not prove that pending provider traffic stops. Confirm this before claiming
the native budget lifecycle is equivalent to the existing web integration.

## Primary references

- [Apple SDK getting started](https://www.xweather.com/docs/mapsgl-apple-sdk/getting-started)
- [Apple SDK changelog](https://www.xweather.com/docs/mapsgl-apple-sdk/changelog)
- [Weather layers](https://www.xweather.com/docs/mapsgl-apple-sdk/getting-started/weather-data)
- [Animation](https://www.xweather.com/docs/mapsgl-apple-sdk/getting-started/animating-data)
- [Client namespaces and authentication](https://www.xweather.com/docs/weather-api/getting-started/authentication)
- [MapsGL sessions](https://www.xweather.com/docs/mapsgl/getting-started/sessions)
- [Attribution](https://www.xweather.com/docs/weather-api/resources/attribution)
