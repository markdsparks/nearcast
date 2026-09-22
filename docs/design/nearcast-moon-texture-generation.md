# Nearcast lunar surface asset

Created with the image-generation skill in **built-in tool mode**, generation (not an edit). The native renderer supplies the astronomical phase, orientation, glow and cloud occlusion. This texture is illustrative, not a scientific lunar map.

- Bundled asset: `native/ios/NearcastApp/Assets.xcassets/LivingSkyMoon.imageset/living-sky-moon.png`
- Original retained: `/Users/markdsparks/.codex/generated_images/019f8747-a973-7fe2-a22f-9f54f7f6be1b/exec-bb43cc46-c7d3-4574-939a-1ca1f254537a.png`
- Original: 1254 × 1254 RGBA. Bundled: 256 × 256 RGBA, 100,949 bytes. Alpha preserved during resizing; native circular clipping excludes stray edge flecks.
- The small bundled image is approximately 256 KiB decoded, excluding GPU targets/cache overhead. It is drawn about 25–34 points wide. No runtime generation or download is used.

## Exact final prompt

```text
Use case: stylized-concept.
Asset type: a single small lunar surface texture for native compositing in the Nearcast iPhone weather app, not a scene or mockup.
Create a square, front-facing, fully illuminated near-side Moon disc in neutral silver-gray. Center it precisely and make its circular limb touch the midpoint of all four canvas edges so it fills the square. Outside the circular disc is genuinely transparent alpha. Keep the full lunar face visible, no crescent or terminator; the app will apply astronomical phase shading itself.
Surface: sophisticated, restrained tonal detail, broad darker lunar maria with delicate crater texture, softly photographic rather than cartoon or embossed. Gentle low contrast appropriate to a moon shown only about 30 points wide. Flat frontal illumination without a directional lighting gradient; no bright white blowout.
Constraints: one moon only, true transparency outside the disc, no sky, clouds, stars, colored lighting, halo, glow, rays, border, text, UI, watermark or cast shadow. Do not paint stars or glow into the transparent area. The native renderer supplies illumination and atmospheric glow.
```
