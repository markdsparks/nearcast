# Nearcast immersive sky: rendering architecture

Research date: 2026-09-19. This is a recommendation based on repository inspection, Apple documentation, and visual prototyping. Performance figures below are proposed acceptance targets, not measurements of a completed renderer. The four-panel reference at `docs/design/nearcast-living-sky-reference.png` establishes art direction; the composition prototype using that static plate does not demonstrate a native animated renderer, correct weather integration, or measured performance.

## Decision

Use one continuous, viewport-sized sky behind the native content. Build it with a small `MTKView` renderer hosted by SwiftUI, combining authored cloud-density/alpha and thickness atlases with bounded procedural edge variation, native lighting, and restrained motion and precipitation. Start with a single composition pass. Keep SwiftUI responsible for the interface, layout, accessibility, and weather copy. The sky renderer receives a compact, immutable scene; it never fetches weather, evaluates forecasts, or owns navigation.

Visual prototyping found that full-frame procedural fractal noise still read as a pattern. Cloud composition should therefore be authored and reviewed as visual assets, with runtime variation limited to gentle edge changes and movement within those compositions. The final implementation should not simply animate a flattened JPEG. A flat illustration contains baked illumination and cannot be convincingly relit by applying a tint or moving a glow over it. Production requires separable cloud layers and masks, or a small set of baked lighting variants whose runtime shading stays deliberately subtle. Decorative assets ship locally with the app; there is no runtime AI generation or decorative-asset network dependency.

This choice gives Nearcast direct control over animation cadence, drawable resolution, texture lifetime, and when rendering stops. Apple explicitly supports timed, invalidation-based, and explicit drawing in `MTKView`; its drawable size can be set independently of the view’s size. That control matters more here than the ability to draw a large number of effects. [MTKView](https://developer.apple.com/documentation/metalkit/mtkview/), [drawableSize](https://developer.apple.com/documentation/metalkit/mtkview/drawablesize)

The result should resemble softly lit atmospheric photography at a glance, with deliberately edited composition. It should not repeat obvious ellipses, decorative ribbons, cell noise, separate card skies, or a uniformly distributed field of cloud blobs. Weather information remains in text and icons; the scene reinforces its meaning.

## What the current code explains

`NativeAtmosphericField.swift` builds every scene from a gradient, two blurred ellipses, an optional blurred moisture band, and a capsule horizon. `NativeWeatherPreviewView.swift` instantiates related fields for the backdrop and hero. Reusing the same geometric arrangement at different scales makes the design read as repeated patterns and independent panels instead of one sky. Its primary inputs are a forecast point, a theme, and placement, so observation provenance and freshness are not part of its rendering contract.

The older `sky.js` has concepts worth retaining: selected-place solar geometry, low/mid/high cloud structure, precipitation truth, stable seeds, generated cloud atlases, quantized cache keys, and a bounded cache. Its cloud paint work is separated from animation. Port those boundaries and tested weather meaning; do not carry the DOM/CSS rendering architecture into native.

## Layers and visual composition

1. **Atmospheric light:** a smooth zenith-to-horizon color field, with a broad light source driven by the selected place’s solar elevation. Morning and evening warmth belongs around the source and horizon, not across the whole image. Night keeps subtle depth and cool reflected light. Theme preference adjusts readability and exposure; it must not turn local daytime into a moonlit night.
2. **Cloud structure:** two authored irregular cloud layers with different spatial scales. Large connected cloud masses establish the ceiling; a smaller amount of bounded procedural edge variation makes them feel alive. Use density/alpha and authored thickness information to control softness, transmitted light, and shaded undersides. These are art-directed approximations, not recovered three-dimensional clouds. Where lighting is baked into an asset, choose a matching lighting variant and limit further shading. Cover and opacity follow weather; shapes remain stable during ordinary refreshes. Avoid a visible repeating tile in the viewport or animation cycle.
3. **Air and distance:** a shallow haze veil softens the distant layer when visibility supports it. Do not manufacture smoke or pollen particles from an air-quality number.
4. **Precipitation:** restrained depth-separated rain or snow only when the scene’s evidence policy allows it. Rain uses short, softened streaks with varied length and opacity; no uniformly spaced slash pattern. Wind adjusts the visual lean and drift within a bounded range. The app is not compass-aligned, so the screen direction is an atmospheric cue, not a literal bearing.
5. **Legibility treatment:** a broad, quiet exposure zone behind hero text and sufficiently opaque content surfaces below it. Avoid a visible spotlight shape around the temperature. Keep text and controls outside the weather render pass.

Use a small finite set of composed families—clear, broken cloud, overcast, rain, snow, fog—with continuous light and density parameters within each family's validated range. A stable place/day seed selects a composition variant and modest edge variation so opening the same place does not reshuffle the sky. Changes should evolve through parameter interpolation or a controlled crossfade between authored variants; avoid replacing all cloud geometry every time the forecast refreshes.

## Asset preparation and golden references

Finish and validate the still image before adding movement. The generated reference is an art-direction input, not a ready-to-ship density map or proof that its depicted light can change independently.

1. Select golden compositions for the weather families and relevant lighting states. Evaluate them behind the actual hero, outlook, hourly rows, toolbar, and large text sizes. Preserve quiet space for reading at short and tall phone sizes.
2. Prepare separable far-cloud and near-cloud assets with clean alpha or density masks, an authored thickness channel where useful, and sufficient overscan for bounded drift. Reconstruct or author these assets deliberately; do not assume arbitrary RGB imagery contains recoverable depth, cloud thickness, or physically correct normals. Validate edges in daylight, at night, and against both light and dark surfaces.
3. Choose the lighting strategy per family. Neutral density/thickness assets support broader runtime color and lighting changes. Assets with strong baked highlights require matching dawn/day/dusk/night variants and restrained modulation. Keep the catalog small enough for a bounded memory cache; load only the current and transitioning families.
4. Produce approved static composites with all processing applied: working color space, premultiplied alpha, texture compression, mipmaps, and actual viewport cropping. These become golden image references and the basis for static accessibility/power fallbacks. Test for halos, banding, compression artifacts, and visible seams before motion.
5. Implement native compositing to match those still references. Only after the match is satisfactory, add slow layer advection, bounded edge variation, and precipitation. Compare paused frames against the static references; animation must not hide weak composition or visible patterns.

Generated artwork may help authoring, but all production assets must be prepared, reviewed, and bundled before release. The renderer uses no runtime model or web view. This phase is asset and renderer work still to complete; the existing four-panel concept and static composition preview do not fulfill it.

## Data and scene boundary

The weather presentation layer should resolve a `SkyScene` when selected place, selected time, forecast, or observation evidence changes:

```text
Forecast + local solar time + existing precipitation evidence
                      ↓
               SkySceneResolver
                      ↓
                 SkyScene
                      ↓
       SkyRenderer + SkyQualityPolicy
```

Suggested scene fields: stable seed; place/time identity; current-versus-forecast mode; solar elevation and normalized light position; cloud family and density; visibility/haze; precipitation kind/intensity; evidence kind and expiry; normalized wind strength; temperature-independent palette; contrast/exposure settings. Convert to compact GPU uniforms only after resolution. Rendering time is a monotonic clock, separate from the selected weather timestamp.

Today’s falling precipitation must come from the existing trusted current-precipitation decision, with a timestamp and an expiry. Radar near the point is different from radar over the point, and radar is evidence of precipitation aloft rather than proof of rain reaching the ground. Preserve that distinction in the shared decision model. An hourly rain percentage alone must not start visible rain in Today. When current evidence expires, ease to the appropriate neutral cloud scene; do not preserve falling rain indefinitely. A deliberately selected future hour may show forecast rain because the interface already identifies it as a dated forecast.

Do not flash the screen for a thunder probability. Keep lightning flashes out of this first version, even with lightning observations: the visual and accessibility cost exceeds their usefulness. Official-alert meaning stays in the alert surface.

The renderer must consume existing evidence; it should add no background weather requests, location polling, camera usage, or motion sensors. Avoid fetching a second source merely to paint the background. Recompute solar lighting at a low rate and on foreground/place/time changes, not per animation frame.

## Why this technology

| Option | Fit for Nearcast |
| --- | --- |
| SwiftUI gradients and shapes | Excellent fallback and supporting surfaces. Repeated blurred geometry is the current visual limitation; many composited layers also obscure the actual rendering cost. |
| SwiftUI `Canvas` with cached images | Good low-complexity prototype or static renderer. Apple recommends Canvas for rich 2D graphics that do not need independent interactive elements. It can place cached cloud images, but generating noise or pixels in its draw closure would be the wrong workload. |
| SwiftUI Metal shaders | Excellent way to prove the look with little glue. Apple executes a shader per pixel on the GPU. A color shader can produce a background without filtering UI; a `layerEffect` rasterizes and filters its source, with sampling bounds. This is viable if profiling proves its resolution/cadence sufficient. |
| Dedicated `MTKView` | Recommended production owner. Explicit resolution, timing, pause modes, texture caching, and a renderer lifetime independent of SwiftUI view updates. Slightly more setup, with a clear boundary and no need for a full engine. |
| Video or full volumetric 3D | Video can look good but needs many assets and reacts poorly to live data. Volumetric ray marching spends power simulating detail largely hidden by the interface. Neither is justified for the first native sky. |

[Canvas](https://developer.apple.com/documentation/swiftui/canvas), [Create custom visual effects with SwiftUI](https://developer.apple.com/videos/play/wwdc2024/10151/), [layerEffect](https://developer.apple.com/documentation/swiftui/view/layereffect(_:maxsampleoffset:isenabled:))

## Render and resource plan

- Create the pipeline and reusable buffers once. Use a single opaque full-screen triangle, no depth buffer, no MSAA, and an SDR color target. The visual does not need HDR highlights.
- Decode/upload the authored density/alpha, thickness, and lighting-variant textures asynchronously and reuse them. Keep density separate from color wherever the asset supports it. Cache a bounded set keyed by cloud family, composition variant, and lighting variant; cancel obsolete preparation on place changes. Precompute any small edge-variation field once and cache it rather than synthesizing the whole cloud image repeatedly.
- Sample two cloud layers in the fragment pass, apply the lighting treatment supported by those assets and broad haze, then composite a small precipitation contribution. Procedural variation perturbs edges within a reviewed amplitude and cannot replace the authored large cloud masses. Do not run full-frame multi-octave noise as the scene's structure or attempt to relight a flattened picture as if it contained geometry.
- Use mipmapped texture sampling to avoid texture aliasing and reduce bandwidth at smaller sizes. Prefer GPU-private texture storage after upload; assess compressed bundled textures against golden references, especially cloud-edge and thickness-channel precision. [Mipmaps](https://developer.apple.com/documentation/metal/improving-texture-sampling-quality-and-performance-with-mipmaps), [GPU counter optimization](https://developer.apple.com/videos/play/wwdc2020/10603/)
- Render the entire background in one pass; use attachment load/store actions consistent with fully overwriting the target. Avoid intermediate full-screen blur targets. [Load and store actions](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/LoadandStoreActions.html)
- Do not put the sky and SwiftUI controls together inside `drawingGroup` or apply a shader across the whole application. `layerEffect` has limitations for UIKit-backed content, and large flattened UI layers can add cost without improving the scene.

## Initial quality targets

These are starting budgets to verify on iPhone 17 Pro and Pro Max, not promises or measured results.

| Concern | Initial target |
| --- | --- |
| Cadence | 20–30 fps for visible cloud/rain movement, independent of the interface’s ProMotion scrolling; draw once when static. |
| Resolution | Start around half native pixel dimensions, with a cap near one million pixels. Soft atmospheric content should upscale cleanly. Increase only for a demonstrated visual issue. |
| GPU | Background pass p95 below 2 ms on target phones; reduce detail/resolution if missed. |
| CPU | No forecast parsing, texture generation, or SwiftUI page invalidation per frame. Renderer preparation p95 below 0.5 ms. |
| Memory | Renderer-owned persistent textures/buffers under 16 MiB; target measured incremental memory under 32 MiB including drawable/fallback costs. Validate the prepared asset catalog and actual layer allocation behavior; trim variant residency before increasing the budget. |
| Launch | A finished static scene appears immediately; texture/pipeline preparation must not delay weather or first interaction. |
| Occlusion | No continuous draws while backgrounded, covered by a full-screen map, or otherwise not visible. |

Cap quality rather than assuming all devices should use their maximum refresh rate. Apple recommends measuring rendering cost, limiting animation cadence and duration, and adapting rendering resolution/frame rate/detail for power constraints. [Rendering efficiency](https://developer.apple.com/documentation/xcode/improving-your-app-s-rendering-efficiency), [Graphics performance and power adaptation](https://developer.apple.com/documentation/metal/improving-your-games-graphics-performance-and-settings)

## Accessibility and power policy

Reduce Motion: show the same composed scene as a still, including a restrained static precipitation impression where warranted; no parallax or continuous animation. Increased Contrast: lower sky contrast behind text and strengthen content surfaces. Reduce Transparency: use opaque content backgrounds. Decorative sky layers do not receive touches or enter the accessibility tree. Foreground labels retain the complete weather meaning. [Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion), [Reduce Transparency](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducetransparency)

Low Power Mode should favor the still scene; serious/critical thermal state must pause animation. Reevaluate policy on notifications, foreground, and view visibility changes. Once paused, invalidate only when the resolved scene changes. Cache or retain a composed frame when practical; otherwise use a family-specific static gradient plus a cached cloud image with the same palette. A generic blank gradient is a last-resort initialization fallback, not the normal low-power design.

## Acceptance and profiling

Use deterministic fixtures for clear noon, warm dusk, partly cloudy night, overcast daylight, active rain, snow, fog, stale precipitation, and a foreign place with the opposite day/night state. Compare still native output with the approved prepared-asset references before reviewing animation. Verify no obvious tile seam or repeated pattern over at least a minute and across short/tall layouts. Check that moving light does not contradict baked cloud highlights and that crossfades do not briefly double cloud density. Test light/dark preferences separately from actual local solar time.

Record an on-device static baseline and animated build with the same fixture, screen brightness, temperature, and interaction sequence. Use Metal System Trace/Game Performance for GPU/CPU timing, SwiftUI Instruments for unnecessary body updates, Allocations for footprint, and Energy diagnostics for idle cost. Compare fast hourly scrolling, tab changes, map presentation, foreground/background cycles, and a sustained ten-minute viewing session. Apple’s guidance explicitly calls for profiling frame time and identifying excess render passes. [Analyzing Metal performance](https://developer.apple.com/documentation/xcode/analyzing-the-performance-of-your-metal-app/)

The acceptance outcome is a readable forecast with stable native scrolling, bounded resources, and a sky that communicates the weather in one glance. Simulator smoothness is useful for layout review but does not establish battery cost or real-device performance.
