# Nearcast Living Sky — design direction and delivery plan

Date: 2026-09-19. Status: native still, sunlight, nighttime, bounded cloud motion, rain, snow and storm treatment are in Nearcast Dev. The latest signed build installed on the family iPhone 17 Pro Max; automatic launch was blocked by the locked phone. Open Nearcast Dev after unlocking. See the final sections for evidence boundaries and remaining physical-device checks. Release/TestFlight rendering remains unchanged.

## The decision

Nearcast should feel like looking into the weather, with an exceptionally clear forecast in front of it. The visual identity comes from atmospheric light, cloud structure, and quiet depth—not from glass boxes, decorative gradients, or more animated objects.

Use **one art-directed, data-driven sky per viewport**. Keep the temperature, condition, outlook, and hourly evidence in stable reading zones. Preserve the existing native interactions and navigation while replacing the background system. The interface in the study demonstrates contrast and hierarchy; it is not a proposal to remove controls or redesign all forecast content.

The production approach is hybrid: composed cloud assets establish quality; a small native renderer supplies light, depth, slow movement, and precipitation. Procedural noise may add restrained variation at cloud edges, but it must not invent the entire composition.

## Why the present background feels like a pattern

The current `NativeAtmosphericField.swift` builds scenes from blurred ellipses, a moisture rectangle, and a thin horizon capsule. Related fields are repeated behind different pieces of the interface. There is no single light source or connected cloud structure, so the eye sees the implementation's shapes instead of a sky.

A first procedural-cloud study also exposed a trap: more detailed noise can look like marbling or embossed texture. Increasing shader complexity would not, by itself, solve the design problem. Art direction must constrain silhouette, scale, composition, and illumination before motion is added.

## What the research changes

- **Weather is the identity.** Apple's Tide Guide showcase emphasizes useful, expressive weather presentation and immediate tactile response. Our application: make atmosphere and forecast feel like one product, while keeping controls predictable. [Tide Guide showcase](https://developer.apple.com/videos/play/meet-with-apple/257/)
- **The important answer wins.** Flighty's design keeps critical information obvious and familiar. Our application: clouds never compete with the temperature, a warning, or the next meaningful weather change. [Behind the Design: Flighty](https://developer.apple.com/news/?id=970ncww4)
- **Materials have jobs.** Apple distinguishes the glass control layer from content. Our application: glass belongs to floating navigation and controls; reading surfaces are quieter and more opaque. The sky itself is not glass. [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- **Stillness is a first-class design.** Motion must support the experience and respect accessibility settings. Our application: approve each scene as a still before animating it, and make the static version a finished design rather than a degraded generic gradient. [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)

These are design inferences from the sources, not claims that Apple prescribes Nearcast's implementation.

## Visual grammar

### Composition

One off-axis light source; two or three cloud depths; large, asymmetrical connected formations. Place rich edges around the upper corners and sides. Reserve broad, lower-detail space for the current temperature and condition. Settle the bottom of the sky into a restrained tonal field so the forecast feels grounded.

Avoid rows of cloud puffs, repeated ellipses, a bright ring behind every card, uniform diagonal rain, exaggerated lightning, giant sun/moon icons embedded in the sky, ornamental landscapes, and saturated purple at night. A recognizably repeated texture is a failed scene.

The desired character is atmospheric photography translated into edited digital art: natural light and convincing depth, without requiring photoreal simulation. The generated reference establishes the upper visual-quality target; it is not a claim about an actual sky at a particular place.

### Weather and light

| Scene | Immediate impression | Useful weather cue | Restraint |
| --- | --- | --- | --- |
| Clear | Open air; blue deepens overhead; pale horizon | Little cloud, local daylight | No enormous sun disc or constant rays |
| Broken clouds | Sculpted ivory formations and open sky | Cloud cover with visible breaks | No endless scattered decorative puffs |
| Overcast | Connected soft ceiling; silver illumination | Little direct sun | Not dark merely because it is cloudy |
| Rain | Lower ceiling, graphite/silver depth, fine near/far drops | Current precipitation when supported | No uniformly spaced slashes; no dramatic storm from rain chance |
| Snow | Diffuse cool light, gentle depth-separated flakes | Snow, when supported by current or explicitly selected forecast evidence | No blizzard effect for light snow |
| Fog | Compressed depth, diffuse low-contrast light | Low visibility | No moving fog over foreground text |
| Dusk/dawn | Cool upper sky, narrow warm horizon, lit cloud edges | Actual local solar phase | Not a full-screen orange/purple wash |
| Night | Blue-black air, subdued cloud silhouettes, reflected light | Actual local night and cloud openness | Sparse stars only in clear areas; no galaxy or random moon phase |

Weather family and solar phase are separate parameters. Snow can happen at night; overcast can happen at noon. A dark interface preference must never turn a daytime place into night.

### Surface behavior

| Surface | Sky treatment |
| --- | --- |
| Today, hero visible | Full composition; restrained motion; forecast values remain strongest |
| Today, scrolled into hourly/daily content | Same sky, quieter exposure and near-static detail; no new backdrop inside every card |
| Hourly list | Same location/time-context palette, strongly quieted background; precipitation motion off; aligned values dominate |
| Selected-hour or selected-day detail | Explicitly dated forecast scene; change only on intentional selection, not on every row passing through the scroll position |
| Ask / Plans / settings | Calm tonal continuation behind stable reading surfaces; no animated rain behind conversation text |
| Map | Map owns the screen; stop the ambient renderer |
| Widget / Watch | Static composition-derived colors or snapshot; no continuous sky animation |

The hourly list must not cycle through weather scenes just because the user is scrolling. This would create visual instability and blur the distinction between current weather and a selected forecast.

### Motion

Cloud motion is detectable over several seconds, not the first half-second. Proposed starting range: roughly 0.2–0.6 points/second, with different depth layers moving at different rates. These are art-tuning values, not physical wind speed. Do not oscillate the whole sky left/right on a visibly repeating sine loop.

Precipitation gets fine depth variation, bounded drift, and lower opacity behind the hero. Wind changes its character, but the screen is not compass-aligned, so it must not imply an exact geographic bearing. No device-motion permission or parallax in v1.

Weather updates evolve over approximately 1–2 seconds without flashing. Cloud geometry remains stable through routine refreshes. Place changes receive a clean transition once the new place's data is accepted; do not display the previous place's dramatic weather under the new name.

Sunlight changes with local time at a low update rate. There is no reason to recompute astronomy per animation frame. Lightning flashes are excluded from v1.

### Reading and accessibility

- Foreground text and values remain ordinary native SwiftUI, above the renderer.
- Test at least 4.5:1 contrast for normal text and 3:1 for large text against the worst background position, not a convenient screenshot. Target higher where practical.
- Use a broad exposure treatment for the header and hero; never a visible circle around the temperature. Bright cloud edges cannot pass behind small white text unprotected.
- Content surfaces are sufficiently opaque to stop cloud texture competing with charts. Reserve glass treatment for navigation and controls.
- Larger type wraps and grows normally. Never solve an atmospheric layout issue by truncating the place or forecast.
- Reduce Motion produces a beautiful still. Reduce Transparency gives opaque content surfaces. Increase Contrast strengthens reading separation. Decorative layers do not receive touches or VoiceOver focus.
- Color and animation reinforce weather; complete meaning stays in the text and icons.

## Weather truth boundary

Resolve background, current condition wording, and icon from a shared weather-presentation decision. The renderer is a consumer, not a second forecaster.

1. Use the selected place's local solar time for illumination. Keep appearance preference separate.
2. Reuse the trusted current-precipitation policy and its source/freshness metadata. Radar over the point differs from radar nearby; radar echoes are not categorical proof of precipitation reaching the ground.
3. A current model condition can be represented at its actual evidence strength, but an hourly probability alone must not start rain in the current scene. Do not label modeled weather as observed.
4. Expired evidence transitions to the best valid fallback; do not let old rain persist indefinitely. Missing data should look calm and neutral, not confidently sunny.
5. An explicitly selected future hour can show its forecast conditions, clearly in that future context.
6. Thunder possibility changes neither the screen to an electrical storm nor the meaning of an official alert. Alerts retain their existing dedicated presentation.

No extra weather provider, background location polling, runtime image-generation request, or notification behavior is introduced for the sky.

## Native architecture

Longer-term option: **SwiftUI content over one lifecycle-owned `MTKView`**, backed by art-directed density/alpha/thickness assets and a small native shader pipeline. The renderer is isolated from forecast retrieval and UI state. For the approved first simple-motion pass, Core Animation moves the existing cached alpha clouds instead: Metal is deferred until an effect actually needs it. The contract and lifecycle separation below still apply.

```text
Existing forecast + current-weather evidence + selected-place solar time
                              ↓
                      SkySceneResolver
                              ↓
                       immutable SkyScene
                              ↓
             SkyRenderer ← SkyQualityPolicy + asset cache
                              ↓
                  one continuous native backdrop

SwiftUI: text, icons, charts, hit targets, navigation, accessibility
```

Target responsibilities (phase-one implementation status follows below):

- `SkySceneResolver`: deterministic, testable semantics. No graphics code.
- `SkyScene`: family, light direction/phase, cloud coverage, precipitation type/intensity/provenance/expiry, bounded wind, stable seed, selected-time identity.
- `SkyAssetCatalog`: reviewed cloud compositions, separable density/thickness masks, and finished static fallbacks. An opaque photographic plate is not a relightable density map.
- `SkyRenderer`: one stable Metal owner, cached textures, monotonic animation clock. No weather network calls or SwiftUI page invalidation per frame.
- `SkyQualityPolicy`: visibility, Reduce Motion, Low Power Mode, thermal state, and device budget. Rendering stops when no longer useful.
- `SkySurfacePolicy`: hero versus dense-reading treatment. Does not create new atmospheric renderers per card.

Use a flat composition pass with two texture depths and restrained precipitation. Avoid live volumetric ray marching, a general 3D engine, video loops, and many full-screen blur passes. Start around 20–30 fps at roughly one million rendered pixels, independent of native scrolling. Proposed profiling gates: background GPU p95 below 2 ms and renderer-owned resources below 16 MiB. These are targets to test on the family devices, not measured promises.

Detailed tradeoffs, Apple API references, fallbacks, and profiling steps: [Rendering architecture](nearcast-sky-architecture-research.md).

## Delivery gates

### 1. Approve the still composition in the real native shell

Prepare the first reviewed cloud assets and static family fallbacks. Replace the repeated atmospheric decorations with a single root backdrop behind a development flag. Preserve current page layouts and data. Review clear/cloudy, rain, dusk, night, then extend to overcast, snow, and fog. Validate long place names, bright-cloud contrast, and larger type.

Pass: every frozen frame is composed and readable; no chart-like decoration under the hero; no card-by-card sky duplication. This gate is about real native screens, not only this design study.

### 2. Connect a shared, testable weather scene

Wire local solar time and the existing weather/evidence decision. Add tests for stale observations, radar nearby versus overhead, forecast-only rain, foreign time zones, opposite day/night, day changes, missing values, and rapid place switching. Add a hidden Dev scene fixture picker so these states are reproducible.

Pass: the hero wording, icon, sky, and selected-time context agree. No extra data request exists purely for background decoration.

### 3. Add native motion within a budget

Introduce the single native renderer, prepared atlases, gentle independent cloud motion, and bounded rain/snow. Keep the approved still as the launch and accessibility fallback. Cancel obsolete asset work on place changes; retain stable shapes across routine refreshes.

Pass: touch response and ProMotion scrolling are unchanged; no load flash, texture seam, cloud reshuffle, or visible loop reset. Reduce Motion and Low Power modes look finished and issue no continuous draws.

### 4. Profile and ship through Dev first

Test iPhone 17 Pro and Pro Max on the family's current iOS, including a ten-minute sustained viewing test, rapid tab changes, map presentation, background/foreground, large text, and poor-network cached launches. Profile actual device GPU time, frame pacing, memory, and energy against a static baseline. Watch Ultra 2 consumes static styling only; this work does not claim to fix the separately reported Watch/widget reliability issues.

Pass: demonstrated resource budgets and stable interaction on physical devices. Only then remove the old native decorative field and roll out broadly.

## Assets and prototype status

- Art reference: [Four-scene reference](design/nearcast-living-sky-reference.png). Generated with the built-in image tool; not a live sky capture or production texture atlas.
- Interactive conversation study: `nearcast-living-sky.html`, in the thread's visualization directory. Four art-directed scenes, Today/Hourly reading comparison, motion toggle, and sky-only inspection. Data is illustrative.
- The study uses a static reference plate plus a small procedural precipitation overlay. It does **not** demonstrate final independent cloud motion, native battery cost, shader relighting, or a finished weather-evidence integration.
- Browser checks cover JavaScript execution and layout at 320, 390, 430, and 736-pixel containers. Native accessibility and performance acceptance still require implementation and physical-device testing.
- Targeted still-image contrast checks at 430 pixels sampled the backgrounds beneath the place name, hero kicker, temperature, condition, feels/high/low line, and outlook summary in all four scenes. Measured minima were at least 4.8:1 for the sampled normal-text groups and 4.67:1 for the large temperature. This is a prototype spot-check, not a full accessibility certification or a result for the unbuilt native renderer.

## Phase-one native implementation

- `NativeLivingSkyScene.swift` is the pure scene contract and resolver. It uses normalized current or explicitly selected forecast conditions and the selected place's provider sunrise/sunset. Interface appearance is separate from local solar phase. Stale or absent current weather resolves to neutral; probability and `thunderPossible` never manufacture current rain or lightning.
- `NativeLivingSkyBackdrop.swift` is one noninteractive native still composition behind Today/Hourly. It has no timer, display link, sensor, runtime generation, or network fetch. Existing per-hero and per-card atmospheric fields are disabled in this Dev path.
- Sky artwork uses aspect-fill cropping without stretching. Clear weather is open air; broken cloud uses the reviewed day/twilight/night plates. Daytime rain uses only the rain plate. Overcast, fog, snow, and nighttime rain use a precipitation-free, star-free cloud plate with appropriate exposure; dedicated snow/rain motion is deferred. This is deliberately not an observation-driven reactive-sky claim.
- The hero keeps the immersive composition. When the hero leaves the viewport, or Hourly opens, a broad reading veil quiets the same sky. Secondary forecast text uses explicit, stronger-contrast ink. Reduce Motion suppresses the short scroll-state transition; Increase Contrast and Reduce Transparency use the dense treatment.
- The feature is enabled in Debug and can be compared against the old native field with launch argument `-nearcast-classic-sky`. Release remains on the previous renderer.
- The two bundled JPEG assets total about 425 KiB on disk. This is not a measured GPU-memory or energy result. No physical-device performance target is claimed yet.

### Verification and remaining gates

- `scripts/test-native-living-sky.sh`: supported condition families, probability restraint, provenance, freshness, exact solar boundaries, foreign time zones, selected future context, missing data, polar night, and all 35 family/phase artwork combinations pass.
- `scripts/test-native-sun-daylight.sh` and `scripts/test-native-weather-preview.sh` pass, including DST and place/cancellation behavior.
- Xcode 27 simulator and signed device Debug builds pass. The direct Dev pipeline installed and launched `app.nearcast.ios.dev` on the family's iPhone 17 Pro Max. No TestFlight upload was made.
- The actual native Today, Hourly and scrolled-daily surfaces were visually inspected on the Pro Max simulator. A separate simulator-only `LivingSkyProof` harness exercises the real renderer/assets on iPhone 17 Pro with visibly illustrative data; it is not part of the app target. Daylight, rain, dusk and night were inspected there.
- Remaining: family review of stills; shared radar/observation evidence integration; prepared separable animation assets; lifecycle-owned motion renderer; complete Dynamic Type/accessibility contrast matrix and physical-device GPU/energy profiling. These are subsequent gates, not implied complete by a successful install.

### Saved native artwork and new prompt

Both images were created using the built-in image-generation tool, then bundled locally. No runtime AI image call exists.

- Approved four-scene native reference: `native/ios/NearcastApp/Assets.xcassets/LivingSkyReference.imageset/living-sky-reference.jpg` (derived from the reference below).
- New overcast still: `native/ios/NearcastApp/Assets.xcassets/LivingSkyOvercast.imageset/living-sky-overcast.jpg`.

Exact final overcast prompt (the approved four-scene sheet was supplied as an art-direction reference, not an edit target):

> Create ONE portrait sky-only asset, 1024 by 2048 if available, for the native Nearcast app. Reference image is approved ART DIRECTION ONLY, not an edit target. Match the reference's sophisticated atmospheric photographic-digital-art look, large coherent natural cloud volumes and calm low-detail lower half. This new asset is OVERCAST DAYLIGHT WITHOUT RAIN. An unbroken but softly sculpted pearl/slate-gray cloud ceiling, diffuse silver light, shallow depth, a calm smooth upper-middle region behind forecast text, slightly richer natural cloud edges at the left and right borders. NO open blue sky, no stars, no sun or moon disc, no visible sunbeams, no sunset orange, NO rain streaks, NO snowflakes, NO lightning, no ground or horizon line. The lower 45 percent settles to a muted blue-gray low-detail atmospheric field. Soft directional illumination from upper right but no bright burned-out highlights. Beautiful large-scale asymmetric forms; NOT noisy marbling, wrinkled patterns, geometric blobs, repeating cloud puffs, smoky swirls or wallpaper. Natural edited composition with real visual depth. No text, UI, borders, collage, panels, or phone frame. This is a full-frame single portrait asset.

### Reference image prompt

Built-in image generation was used with this prompt:

> Use case: stylized-concept. Create an art-direction reference sheet for Nearcast, a premium practical immersive iPhone weather app. A single wide image divided into exactly FOUR equal-width tall portrait sky-only panels side by side, edge-to-edge with thin simple gaps. NO text, letters, labels, numbers, UI, phones or device frames. Panel 1: luminous partly cloudy daytime, refined deep blue air at top, ivory sculptural cloud masses at upper left and lower right, warm off-axis light, open calm blue center. Panel 2: rainy afternoon, a coherent slate-blue storm ceiling with believable broad softly sculpted underside, silver diffuse light from right, very fine sparse short rain streaks with depth, NOT slash wallpaper, NOT apocalyptic. Panel 3: evening clearing, dusky blue overhead transitioning into a soft restrained apricot horizon, thin coherent sweeping stratified clouds with illuminated edges, no oversaturated purple. Panel 4: quiet partly cloudy night, rich blue-black sky, subtle cool moon illumination outside frame, faint natural cloud silhouettes, only a few tiny stars in open sky, no giant moon or galaxy. Overall style: sophisticated atmospheric digital art informed by editorial sky photography; luminous, spacious, natural light scattering and genuine cloud volume, but edited and composed rather than literal photograph. Not cartoonish, no graphic icons, no giant sun disc, no repeated texture/noise wallpaper, no geometric blobs, no wave patterns, no marbling or swirls, no film grain, no land or buildings, no lightning. Each panel has a large calm negative space in the upper-middle third where large white temperature text could later sit, and its bottom 40 percent smoothly settles into a low-detail blue/slate tonal field for forecast information. The sky is the subject, not decoration. Each frozen frame should feel intentional and beautiful. Make all four portraits consistent in art direction, sophisticated and softly dimensional, with large cloud forms not tiny scattered puffs. Wide landscape contact sheet.

## Sunlight and Nearcast identity pass

This supersedes the phase-one daylight/broken-cloud renderer described above; release behavior remains unchanged until Dev review.

### Implemented

- Open sky now includes an off-axis sun, soft atmospheric scatter and a restrained low-sun wash. The apparent vertical position follows solar elevation, not device orientation; this is a composition, not a compass-aligned sky camera.
- Daytime and twilight broken clouds use one generated RGBA layer rather than an opaque photographic panel. Native sunlight is behind the cloud alpha, and a localized warm tint reuses the same alpha and cloud texture. Fine vapor is preserved; a luminance-only mask was rejected during visual review because it introduced a hard fringe.
- Nearcast's signature is warm light against cool cloud depth, asymmetric cloud framing, a quiet temperature area and a settled forecast surface. Clear remains open; overcast remains diffuse; a thunder probability does not add storm art or darken the scene.
- Existing current/hourly direct, diffuse and shortwave radiation plus low/mid/high cloud cover are decoded as optional, unit-checked enrichment. No data provider, endpoint, permission or runtime image request was added. Missing enrichment falls back to a condition-based illustration, not a claim of measured sunshine.
- Solar geometry is a pure Swift port of the established web calculation. Provider sunrise/sunset remains authoritative for day/night; continuous geometric elevation governs warmth. Low radiation at noon can weaken sunlight but cannot create sunset colors.
- Mostly-clear code 1 with sufficient measured cloud cover receives broken-cloud art while retaining its condition label. Code 0 remains clear; measured cover can still attenuate sunlight. No rain/thunder possibility is promoted into current precipitation.
- The hero's main condition and icon use the normalized condition and the same selected-place solar state as the sky. Forecast storm possibility is secondary text. Current readings older than 90 minutes retain a labeled cached temperature but no present-tense sunny/cloudy claim.
- Only Current may borrow optional enrichment from its bounded containing hourly row. A deliberately selected actual hour uses its own data. A synthetic daily summary does not silently borrow radiation from an unrelated noon hour; its light remains forecast illustration.
- Stronger secondary text and appearance-aware exposure protect reading in both themes, including forced light mode at local night. Hourly and scrolled Today keep the dense reading treatment. The light-mode and dark-mode colors are independent of solar phase.

### Architecture and limits

This is still one static SwiftUI backdrop with bundled artwork and native gradients. There is no animation/render loop, live ray marching, per-card duplicate sky, sensor polling or extra network activity. The new cloud PNG is 1024 × 1536 and about 1.58 MiB on disk (about 6 MiB as an uncompressed four-channel image, excluding render targets/cache overhead). Actual GPU/energy profiling belongs to the motion gate; these sizes are not a measured memory-budget claim.

The artwork is an atmospheric interpretation of current forecast evidence, not a live camera, observed precipitation claim, physically simulated cloud field, or exact sun-bearing visualization. Radar/observation fusion and lifecycle-owned animation remain later gates.

### Verification

- Living Sky tests pass: solar parity with the established calculation, San Diego-like clear sun, Indianapolis-like low-sun broken cloud with separate thunder possibility, optional-unit/range validation, same-hour enrichment boundaries, selected context, missing/stale data, overcast/fog/rain/snow/night sun suppression, and geometry-derived warmth.
- Forecast/cache, native preview/navigation and sunrise/daylight regression suites pass.
- Xcode 27 full Debug simulator and signed device builds pass.
- Real native renderer inspected on iPhone 17 Pro and Pro Max simulators: clear afternoon, sun through clouds, golden hour, overcast, and high-contrast larger-text reading. The complete app was also inspected with live San Diego and Maryville data. Proof-screen weather values are explicitly illustrative, not live readings.
- A mathematical worst-case check of the dark hero exposure and secondary ink gives at least 4.65:1 even against a white underlying cloud at the minimum 68% exposure veil. This is a bounded color check, not a full native accessibility certification; full Dynamic Type, interaction and physical-device profiling gates still apply.
- Direct Dev installation succeeded on the family's iPhone 17 Pro Max. Automatic launch was denied because the phone was locked. Open Nearcast Dev manually after unlocking. No TestFlight upload was made.

### New asset

The image-generation skill supplied the separate transparent cloud layer, not a flattened mockup. The original is retained, and alpha was verified with transparent and partially transparent samples. [Exact final prompt and saved asset paths](design/nearcast-cloud-layer-generation.md).

## Moonlight and stars — native Dev pass

This supersedes the baked nighttime artwork described in phase one. The feature remains Dev-only; no TestFlight or release rollout is implied.

### Visual behavior

- Clear nights use deep blue-black air, a small silver-textured moon, and sparse stable stars. Moonless nights have no invented moon or moonlight and allow slightly stronger stars.
- The illuminated fraction and local orientation are calculated for the selected place and time. A projected-sphere mask gives the correct crescent, half, gibbous or full shape. Both lit and unlit lunar silhouettes occlude stars.
- The moon is hidden below the geometric horizon and fades in between approximately 1° and 9° elevation. Very thin new-moon slivers are suppressed. Screen position is editorial and elevation-informed, not an azimuth/compass sky map.
- Broken clouds use the same real-alpha asset as daylight, with restrained cool illumination toward the moon. They sit in front of the moon and stars; celestial detail is not baked into the cloud image.
- Twilight, cloud coverage and above-horizon moonlight control visibility. Dense overcast, fog, rain, snow, missing/stale weather and unknown coordinates do not produce a confidently clear starry sky. Thunder probability alone still does not manufacture storms.
- The dark nighttime hero uses a lighter reading veil than the daylight hero, because its artwork is already low-luminance. Hourly/scrolled Today, Increase Contrast and Reduce Transparency retain the dense reading veil. Forced light appearance remains supported separately from selected-place day/night.

### Architecture and honesty

- `NativeLivingSkyScene.NightSky` is an immutable contract. Its pure Swift lunar geometry adapts SunCalc 1.9.0 and adds a spherical-observer parallax correction. It does not model terrain, refraction, libration, light pollution or measured star visibility.
- Stable stars are a decorative composition, not constellations or a visibility forecast. They never reshuffle on refresh. Their 78 coordinates are calculated once; no twinkle or motion timer exists.
- The native backdrop adds one 256-square RGBA moon texture, a small phase path, a static star canvas and restrained gradients. No new permission, provider, API call or continuous render loop was added. Physical-device energy/GPU profiling remains a later motion gate, not a result claimed from a successful build.
- Full SunCalc attribution is bundled and available in Settings → About → Acknowledgments, alongside the already-bundled MapLibre notices.
- The image-generation skill was used only for the lunar surface texture. [Exact prompt, generation mode and saved asset paths](design/nearcast-moon-texture-generation.md).

### Verification and delivery

- Deterministic tests pass for lunar phase/orientation, northern and southern latitude references, parallax, twilight, below-horizon/new moon, polar and invalid inputs, selected future time, stale/no-data handling and weather suppression. Independent USNO reference fixtures supplement upstream SunCalc fixtures.
- Native forecast/cache, sunrise/daylight and preview/navigation regression suites pass; `git diff --check` is clean.
- The real native renderer was visually checked on iPhone 17 Pro and Pro Max simulators: full/crescent/gibbous, moonless clear, broken cloud, rainy overcast, forced light appearance and high-contrast larger-text reading. The separate proof app uses explicitly illustrative weather values, not live observations. The full app's live San Diego daylight screen also passed visual regression review.
- Full simulator and signed-device Debug builds pass. The SunCalc notice is present in the built app bundle.
- The direct Dev pipeline installed **and launched** this update on the family's iPhone 17 Pro Max. No TestFlight upload was made. Animation and broader release remain separate approval/testing gates.

## Simple cloud motion — native Dev pass

Historical first pass; the continuous-motion refinement below supersedes its one-shot timing and static-canopy limits.

This is the approved first motion increment, not the full precipitation/Metal renderer proposed earlier. It adds no new artwork, provider, permission or weather request.

### Motion and composition

- Only the existing broken-cloud alpha artwork moves, in daylight, twilight and night. Sun, moon, stars, lighting masks, reading protection and forecast content stay anchored.
- One-way travel is 40 points right and 6 points upward over **180 active seconds**, then the sky settles into its finished still. It does not reverse, tile, repeat or jump back. This is an art-directed drift, not measured wind direction or speed.
- Pausing banks active time and resuming continues from the same position. Routine forecast refreshes do not reset motion; intentional place/time identity changes do. Overscan covers the entire path at every viewport size.
- Meaningful same-place weather changes crossfade over 1.4 seconds when the hero may animate. There is at most one outgoing still composition. Place changes, unavailable evidence and loss of motion permission immediately cancel obsolete transitions; another place's sky never remains under the new place name.
- No animated precipitation, star twinkle, moon travel, lightning or device-motion parallax is included. Clear, overcast, rain, fog and snow remain finished stills in this increment.

### Architecture and lifecycle

- `NativeSkyDriftTimeline` is a pure, injected-monotonic-clock contract. It owns accrued active time and bounded progress; it has deterministic unit tests.
- `NativeLivingSkyCloudMotionView` bridges a transparent, noninteractive `UIView` with one cached cloud-image `CALayer`. The base cloud and localized light tint share the image and time sample. Explicit linear Core Animation transforms request 15–30 fps, preferably 30; this request is not a measured frame-rate guarantee.
- The compositor drives movement without a SwiftUI frame clock, display link, astronomy loop or network activity. A single cancellable completion deadline per active layer removes its finished animation entry. Short transition tasks exist only during accepted scene changes.
- Motion is limited to fresh current weather on Today, with the hero visible, the scroll view idle and no covering surface. Native scroll-phase and visibility callbacks are used on iOS 18+; older systems keep the still.
- Hourly, future-day reading, scrolling, a hidden hero, Map, Ask, Plans, weather detail, ancestor Places/Settings, inactive/background state, Reduce Motion, Reduce Transparency, Increase Contrast, Low Power Mode and serious/critical thermal state all pause motion. Power and thermal changes use OS notifications, not polling. Hosts without explicit presentation ownership default to a still.
- The new layer is decorative and never intercepts touches or VoiceOver focus. The existing reading veil and ordinary forecast UI remain separate.

### Verification and current delivery status

- Pure motion tests pass for pause/resume, refresh stability, one-way completion, explicit reset, invalid timestamps and backward-clock protection.
- The real UIKit compositor harness passes on iPhone 17 Pro and Pro Max simulators: presentation movement, exact pause, resume, refresh begin-time stability, resize/overscan continuity, finished-animation cleanup, identity reset and window-removal cleanup.
- The real SwiftUI backdrop integration harness passes: lifecycle pause inputs, same-place crossfade, place changes during a fade, unavailable evidence, rapid updates and cleanup. The separate lifecycle source-policy test checks all screen/power/accessibility gates; it does not replace physical interaction testing.
- Living Sky, sunrise/daylight, forecast/cache and preview/navigation regression suites pass. Complete Nearcast Dev simulator and signed-device Debug builds pass.
- Day/twilight movement and nighttime composition were visually inspected in the simulator with the real renderer. Proof-screen weather values are illustrative.
- Installation is pending: Xcode currently lists the family iPhone as unavailable. The Mac is locked, preventing interactive scroll/sheet checks. No TestFlight upload was made.
- Physical-device frame pacing, ten-minute sustained energy/GPU profiling, full Dynamic Type/contrast coverage and family motion review remain open. Earlier GPU/memory figures are still proposed budgets, not achieved measurements.

## Rain — first native precipitation pass

The cloud-motion installation blocker above is resolved: the family phone reconnected, and the rain build includes that motion work. Both are installed in `app.nearcast.ios.dev`; production/TestFlight remains untouched. Snow, freezing precipitation and lightning effects remain separate work.

### Appearance and interaction

- Rain now uses the precipitation-free overcast artwork in every solar phase. The former daytime photograph with baked-in rain streaks is no longer selected, so disabling motion leaves a finished still rather than frozen rain.
- Two modest native particle depths add fine, irregular streaks. Drizzle, light, steady and heavy tiers change density and scale without forming a repeating diagonal pattern. Daylight droplets use a quiet slate reflection against bright clouds; nighttime droplets catch cool light. A side/vertical mask protects the centered hero and removes particles from the lower reading zone.
- The cloud ceiling retains local lighting: silver daylight, a restrained low-sun reflection, and a cooler low-luminance night. A sun shower requires explicit modeled radiation plus a sufficiently open cloud field; a rain code or the time of day alone does not invent a sunny break.
- Scrolling or opening reading surfaces freezes particle simulation immediately, fades the field for 180 ms, then destroys it. Backgrounding, unavailable evidence, power/accessibility restrictions and place changes clear synchronously. Resume starts fresh particles, not suspended drops. Existing cloud-motion gating applies.
- Thunder possibility alone never triggers rain or dark storm artwork. A supported current thunder condition can have rain at its actual modeled rate; it does not automatically imply heavy rain. No flash, bolt graphic, sound or parallax was added.

### Shared weather decision and limits

- The native hero and sky share `NativeCurrentWeatherDecision`, preserving the existing current-reading acceptance window (five minutes ahead through less than 90 minutes old).
- Moving rain is stricter: an explicitly tagged `modeled-current` sample less than 30 minutes old, a credible 60–3600-second accumulation interval, finite nonnegative precipitation, an accepted liquid-rain/thunder condition, and at least 0.2 mm/h. The intensity is accumulation divided by its real interval, never a daily amount or assumed hourly rate.
- Native decoding now preserves optional `origin` and `precipitationIntervalSeconds`. Unknown/legacy origin, service or local hourly fallback, quarter-hour forecasts, missing/zero amounts, raw storm codes, probabilities, snow and freezing precipitation cannot enable falling rain. Older Codable data remains readable.
- This is an illustration of accepted **current model guidance**, not observed rain at the ground. Native Home still has no point-radar reconciliation; nearby-station enrichment currently adjusts temperature only. Porting the web radar/observation decision requires separate native evidence work. No new provider, endpoint, permission, network request, notification behavior or confidence badge was introduced here.

### Native rendering and verification

- `NativeLivingSkyRainView` uses two `CAEmitterLayer`s with one cached tiny code-drawn alpha streak, not a generated image or video. There is no SwiftUI frame clock, display link, per-frame forecast work or continuous app-side polling.
- Birth rates and lifetimes are bounded independently of viewport area (at most 64 configured births/second and a tested configuration envelope under 300 particles). This is a configuration limit, not a physical-device energy/GPU measurement.
- Fresh fields start at explicit parent-local time. Actual rendered-frame checks caught and fixed a direction error: a line emitter's downward direction is around pi, not pi/2. Regression tests now protect both timing and direction.
- Forecast/cache/provenance, Living Sky solar/lunar/rain rules, sunrise/daylight, preview/navigation, cloud-motion and lifecycle-policy tests pass. Full Debug simulator and signed-device builds pass.
- Real UIKit and SwiftUI-backdrop rain suites pass on iPhone 17 Pro/iOS 27; the full-size backdrop suite also passes on Pro Max. They verify viewport sizing, two depths, capped work, unchanged-refresh stability, pause/fade cleanup, rapid resume, accessibility/power policy, place switches, unavailable data, resizing and teardown.
- Pixel comparisons of two nighttime frames confirm actual precipitation movement with otherwise static artwork, rather than merely attached emitter layers. Daylight, sunset/sun-shower and night are reviewed with explicitly illustrative proof fixtures.
- Direct Dev installation and launch succeeded on the family iPhone 17 Pro Max. On-phone visual/scrolling review and sustained energy/GPU profiling remain open; no measured battery claim or TestFlight rollout is implied.

## Snow and storm treatment — native Dev pass

This extends the rain pass without new artwork, providers, permissions, requests, or release flags. Living Sky remains Debug/Dev-only. Snow and storm behavior is independent of interface light/dark appearance and keeps the selected place's solar phase.

### Visual treatment

- Snow has diffuse pearl/slate daylight and cool nighttime depth. Two slow native particle depths use tiny, softly feathered specks with modest individual lateral drift. No snowflake symbols, uniform diagonals, screen-covering blizzard, simulated accumulation, or invented wind direction.
- The light/steady/heavy snow profiles change particle density and size. The normalized snow condition chooses the optical tier; a positive credible liquid-equivalent amount gates activation. We never assume a snow-to-water ratio or infer inches of snow from that amount.
- Daylight particles have restrained slate contrast against pale clouds; nighttime particles catch cool light. The same side and vertical masks protect the hero and remove motion from the lower reading area. Pausing leaves a complete winter still, not frozen flakes.
- A supported current thunderstorm gains a graphite upper cloud ceiling, a second quiet cloud depth and diffuse distant light. It does not gain lightning bolts, screen flashes, audio, hail, a shelf cloud, or a severity claim. Local dawn/dusk warmth remains geometry-driven.
- Storm atmosphere and rain intensity are separate: a thunderstorm can have light rain, and a supported thunder condition without a credible rain amount gets cloud treatment without invented falling rain. A mere storm possibility or raw provider thunder code never darkens a sunny scene.

### Evidence and lifecycle

- Shared current-weather qualification remains explicit `modeled-current` provenance, no more than five minutes ahead and less than 30 minutes old. Old/legacy, hourly fallback and quarter-hour forecast origins cannot enable active snow or enhanced current storm treatment.
- Snow additionally requires normalized codes 71/73/75/77/85/86, a finite nonnegative precipitation amount, a credible 60–3600-second interval, and at least 0.05 mm/h liquid equivalent. This is an animation eligibility floor, not an accumulation or visibility forecast. Temperature, chance and freezing-rain codes alone cannot create flakes.
- Storm treatment requires normalized current codes 95/96/99. It does not need an accumulation amount because it only changes the cloud atmosphere. It is not a lightning observation or an official warning. Warning presentation and notification behavior are unchanged.
- Future-hour/day contexts retain still weather-family artwork; they never masquerade as current falling snow or current enhanced storm treatment. Missing/stale evidence removes the enhancements.
- The Backdrop mounts exactly one precipitation bridge. Rain and snow share the existing native emitter lifecycle; a family change retires the old particles rather than running rain and snow together. Scrolling/reading fades out in 180 ms; backgrounding, invalid evidence, identity changes and power/accessibility restrictions retire work immediately.
- Two emitter layers and cached code-drawn alpha textures do the work. Snow's maximum configured population envelope is below 227 particles, independent of viewport area. No additional frame clock, display link, SwiftUI animation loop or storm animation engine was added. Configuration bounds are not a measured battery/GPU result.

### Verification and delivery

- Forecast/cache tests cover exact snow/storm evidence boundaries, interval validation, invalid and missing values, legacy decoding, raw-code/probability exclusions and service/local hourly fallback. Rain qualification is unchanged.
- Living Sky tests cover optical tiers, separate storm/rain treatment, incompatible-family clamping, selected forecast stills, local nighttime, solar/lunar regressions and unavailable data. Cloud-motion, lifecycle-policy, preview/navigation and essentials regressions pass.
- Real-window snow renderer and SwiftUI Backdrop suites pass on iPhone 17 Pro and Pro Max/iOS 27. They check exactly two active emitters, bounded work, timing/direction, refresh stability, pause/fade/resume, resize, teardown, place changes, rapid rain↔snow replacement, and no added storm emitters or flash animations. Existing rain renderer/Backdrop suites also pass after sharing the backend.
- Native snow day/night and storm day/night proof fixtures use illustrative data, not fabricated live observations. Pixel comparison of two nighttime snow frames confirms visible particle movement with otherwise static artwork.
- Full Nearcast Dev simulator and signed-device builds pass. The Dev pipeline installed the update on the family iPhone 17 Pro Max; automatic launch was denied because the phone was locked. Open Nearcast Dev manually after unlocking. Family visual review and sustained power/GPU profiling remain open; no TestFlight upload was made.

## Rain visibility correction — layout-aware hero focus

The Aurora screenshot exposed a gap in the art review: the isolated rain proof was visible, but places and an official alert covered much of the upper-screen area favored by the masks. The exact phone cache had fresh modeled light rain (0.5 mm over 900 seconds), so changing the weather classification would have been the wrong fix. A separate native reproduction confirmed the visibility and scroll callbacks work in the actual ordinary-VStack/navigation/sheet hierarchy.

- Rain is now framed around the measured on-screen hero, not an assumed upper-third position. SwiftUI supplies integral window-space hero bounds after scrolling settles. The native layer converts them to its own coordinates, keeps the side gutters visible through the hero, and fades below it. The central text region remains subdued.
- Droplet contrast and minimum size increase, and the former full-lifetime opacity decay is reduced. Previously that decay multiplied both readability masks until light rain was almost invisible in the useful area. Particle birth rates, lifetime caps and the two-depth budget are unchanged; light rain has not been reclassified as heavier rain.
- Focus updates only change an existing gradient mask with implicit animations disabled. They do not restart particles or change weather state. Geometry writes are equality-guarded, and measurement is suppressed during scrolling, then resampled at idle. Missing, nonfinite, empty and offscreen bounds have a safe fallback.
- Snow tuning, weather evidence thresholds, accessibility/power/thermal restrictions and the 180 ms pause fade remain unchanged. The backdrop still contains exactly one precipitation owner.
- The new simulator-only Aurora fixture includes navigation, places, an amber alert, a displaced hero and outlook. It exercises actual scroll/visibility callbacks, alert reflow and a partial scroll return, rather than manually setting `motionAllowed`. Its explicitly illustrative values are never supplied to the real app.
- Rendered nighttime frames show moving rain beside the hero in that crowded layout; daylight contrast was also reviewed. Forecast, Living Sky and native navigation regressions pass. The real renderer tests cover finite ordered masks, nil/invalid/offscreen focus and unchanged emitter identities on focus updates.
- Crowded-layout native scroll/focus verification passes on both iPhone 17 Pro and Pro Max simulators. Existing rain Backdrop and snow renderer/Backdrop regressions also pass with the shared backend. Full simulator and signed-device builds pass.
- The Dev update installed on the family iPhone 17 Pro Max. Automatic launch was denied because the phone was locked; open Nearcast Dev after unlocking. No TestFlight upload was made. Family visual review and sustained energy profiling remain open.

## Continuous atmospheric motion — native Dev refinement

The first pass moved only 2.2 points in a ten-second glance and stopped after three active minutes. This refinement makes motion perceptible without moving the interface, inventing weather, or adding decorative flashes.

- Broken clouds have two depth planes: near cloud travel is about 1.57 points/second; distant cloud travel is about 0.70 points/second. Different crops, scales, periods and starting phases keep them from reading as two aligned copies. Each plane recycles two overlapping image copies at zero opacity, never reversing or exposing a hard wrap. This remains authored artwork, not a fluid simulation or measured wind bearing.
- Overcast, rain and snow use a slower canopy (~0.86 points/second). An opaque ceiling remains underneath its blended copies: source-over opacity blending alone cannot guarantee full coverage and must not create a false sun break. Storm shading stays restrained; existing rain/snow evidence rules and particles are unchanged.
- Sun, moon, stars and illumination masks remain anchored. Moving cloud alpha naturally reveals and obscures that light. No full-screen brightness oscillator, star twinkle, lightning flash, parallax sensor or extra weather request is added. Clear, fog, unknown-light and unavailable-weather scenes stay still.
- Core Animation owns repeating translation/opacity groups at a requested maximum of 30 fps. The active-time value type has no timer or three-minute cutoff. Routine refreshes do not replace active animations; pause freezes exact progress, resume continues it, and place/time changes reset it.
- Cached image data is shared across layers. Broken clouds use four image copies per visible color pass, with no invisible tint pass; canopy uses two moving copies and one opaque base. Full-travel overscan covers signed horizontal/vertical endpoints and shifted depth crops. No full-screen bitmap is generated per frame, and there is no SwiftUI frame clock or completion task per loop.
- All existing hero/scroll/reading, covering-screen, background, power, thermal and accessibility gates are retained. Pausing removes compositor animation entries; detaching the view removes all remaining animation work. The complete still composition and separate forecast text remain usable.
- Verification covers pure active-time and seam math, real compositor movement/opacity/pause/resume/resize/detach, real SwiftUI lifecycle/family/transition behavior, and visual review behind the actual UI. Sustained physical-device GPU/energy profiling remains a separate open gate; a successful build is not a battery-efficiency measurement.
- Verification completed: pure motion, Living Sky semantics, lifecycle gates, preview/navigation and routing tests pass. The actual UIKit compositor suite passes on the iPhone 17 Pro Max simulator; the SwiftUI backdrop suite passes on iPhone 17 Pro. Existing rain/snow backdrop suites also pass. Actual native Today frames and illustrative sunset/moonlit compositions were visually checked. Full simulator and signed-device Debug builds pass. The Mac lock prevented an additional manual scroll/tap pass; automated parent and precipitation checks covered pause/resume and lifecycle transitions.
- Delivery: the signed update installed successfully in `app.nearcast.ios.dev` on the family iPhone 17 Pro Max. This is the direct-device Dev lane; no TestFlight or production deployment was made.

## Restrained star twinkle and storm depth — native Dev

This supersedes the static-star limitation above. The Moon and all celestial positions remain anchored; no lightning feed, flash, bolt, sound, haptic, or weather request is added.

- Preserve the original deterministic 78-star composition, including the quiet forecast center and full-disc Moon occlusion. Only six brighter stars gently vary in opacity; the other 72 are one cached steady image. Independent 8.9–14.1-second cycles vary original brightness by at most 22%, without going dark, changing size, moving, or synchronizing into a screen-wide pulse.
- Core Animation owns the six small opacity curves, with a requested maximum of 30 fps. There is no frame timer or per-frame SwiftUI invalidation. Weather visibility affects the parent layer; steady-field rasterization happens only for size/display-scale or Moon-occlusion changes, not every frame.
- The star renderer banks its local active phase during pauses. Routine weather updates, including advancing cloud time while Dim Flashing Lights disables stars, cannot restart or advance that frozen phase. Identity changes seed a clean new phase. Hidden/transparent/zero-visibility/detached views remove compositor loops.
- Current supported night evidence and the existing scene/hero/scroll/background/power/thermal/accessibility gates are required. The real host now also supplies Apple's Dim Flashing Lights preference; that stops twinkle without removing the finished still sky. The shared immediate-stop signal stops all atmospheric animation, not just precipitation. Future-hour/day views are not animated as current weather.
- A qualified current thunderstorm retains an opaque slow cloud ceiling and adds one paired, closer cloud veil with a separate 197-second travel period. The foreground passes in front of a fixed diffuse silver light region. This reveals depth through cloud opacity instead of flashing or brightening the entire display. The quiet lower reading region, local dawn/dusk warmth, independent rain intensity and all original evidence thresholds remain intact.
- The storm veil reuses the approved transparent cloud artwork; it uses two foreground image copies instead of the previous four. This is an art-directed atmospheric cue for modeled current thunder, not a lightning observation, wind-direction visualization, shelf-cloud diagnosis, or severity indication. Nearby-strike illumination remains deferred until a separately qualified observed-lightning signal is connected.
- Pure star profiles/occlusion, cloud motion, weather/solar/lunar semantics and native lifecycle source-gate tests pass. The real-window star compositor suite passes on iPhone 17 Pro Max; the real SwiftUI night-sky integration passes on iPhone 17 Pro, including Dim Flashing Lights, phase continuity, place changes, stale/unavailable evidence and outgoing-scene retirement. The storm depth suite passes on Pro Max, including actual motion, rain-owner continuity, cloud retirement, immediate restrictions, and absence of flash loops. Signed Dev compilation passes. Physical-device visual review and sustained GPU/energy measurements remain separate checks; these bounded layer counts are not a measured battery claim.
- Existing cloud and snow/rain/storm Backdrop integration regressions and native preview/navigation model tests also pass. Illustrative clear-night, dusk-storm and night-storm compositions were visually reviewed behind forecast content. The signed update installed in `app.nearcast.ios.dev` on the family iPhone 17 Pro Max. Automatic launch was denied because the phone was locked; open Nearcast Dev manually after unlocking. No TestFlight or production/web deployment was made.
