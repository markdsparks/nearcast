# Nearcast sunlight cloud layer

Generated with the built-in image-generation tool for the native Living Sky sunlight pass. The four-scene reference was an art-direction reference, not an edit target. There is no runtime generation or image network call.

- Bundled asset: `native/ios/NearcastApp/Assets.xcassets/LivingSkyCloudLayer.imageset/living-sky-cloud-layer.png`
- Source retained: `/Users/markdsparks/.codex/generated_images/019f8747-a973-7fe2-a22f-9f54f7f6be1b/exec-c9c077b0-c38f-4e34-a6cb-284d79b98f31.png`
- 1024 × 1536 RGBA. Alpha validation found fully transparent and partially transparent samples; alpha preserved without conversion. This is an art-directed cloud layer, not an actual sky capture or weather observation.

## Exact final prompt

```text
Use case: stylized-concept. Asset type: production transparent cloud compositing layer for the native Nearcast weather app.
Input image 1 is a STYLE reference ONLY: the left sunlit-cloud panel shows the desired elegant atmospheric texture and warm-edge/cool-depth aesthetic. Do not reproduce the panels, sky, rain, stars, sun, or any background.
Create ONE portrait 2:3 RGBA PNG with a genuinely transparent background and no baked checkerboard. Only soft atmospheric clouds and their translucent wisps are visible. The center is mostly transparent for readable weather content.
Composition: a single sculptural cloud bank flowing in from the upper left edge, with irregular fine wisps reaching toward the upper right around one quarter down the canvas; a smaller, lower, airy cloud bank entering from the right edge halfway down; bottom quarter fades completely to transparent. Quiet, asymmetric, natural scale, not a repeated pattern. The upper-right opening remains largely transparent so a separate sun rendered behind the layer can peek through its edge.
Lighting: neutral pearly silver-white cloud edges and softly shaded cool slate-blue cloud depths; gentle internal volume, no sun baked in, no orange baked in, no hard glowing outlines. We will light it in the renderer at different solar elevations.
Style: art-directed atmospheric realism, luminous but restrained, sophisticated premium editorial weather experience. Broad soft volumes with delicate feathered vapor, not a photo cutout with a sharp perimeter and not a cartoon.
Constraints: genuinely transparent alpha everywhere outside the clouds, including center and bottom; preserve partial alpha on fine vapor. No sky color background, no ground, no horizon line, no text, no UI, no icons, no rays, no lens flare, no repeating puffs, no borders, no panels, no watermark.
```
