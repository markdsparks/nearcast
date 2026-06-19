# Map overhaul — working plan

Living doc for the multi-phase map rework so we can pick up across sessions.
Original issues (from the user): animation pulsing, zoom-in pixelation, immersive
zoom flicker, scattered HUD, city labels hidden under storms.

## Status

| # | Issue | Phase | Status |
|---|-------|-------|--------|
| 1 | Radar animation "pulses" | 1 — engine | ✅ shipped v1.10.89 (hard-cut, retimed loop) |
| 2 | Precip pixelated on zoom-in | 1 — engine | ✅ shipped v1.10.89 (z8 cap + proportional blur) |
| 3 | Immersive zoom flicker / blank | 1 — engine | ✅ v1.10.89 deferred-purge; v1.10.90 realign kept tiles |
| 4 | HUD looks scattered | 2 — HUD | ✅ shipped v1.10.99 (simplified immersive HUD + interaction fixes); refined v1.10.128 (one precipitation timeline) |
| 5 | City names hidden under storms | 3 — basemap/labels | ✅ spiked v1.10.103 (CARTO no-label base + labels layer) |

## Phase 2 — HUD redesign (#4) — SHIPPED v1.10.99

Target: a cohesive **two-zone** immersive HUD instead of independently-placed chips.

**Top zone**
- Top-left cluster: close (✕) and the place switcher icon.
- Place icon is a button that opens saved places, making location switching available without extra chrome.
- No explicit zoom controls; mouse wheel, pinch, and chosen default zoom carry that interaction.

**Bottom zone** — one cohesive control rail
- Play/pause + one **slim** precipitation timeline (thin track, small thumb, big hitbox via padding — NOT a heavy
  bordered card) + the current frame time (replaces the floating top-left frame chip).
- Timeline is one mental model with two truthful eras: radar history up to Now, forecast guidance after Now.
- Crossing Now hard-switches source/legend instead of blending radar and forecast.
- Legend: a compact vertical radar-intensity strip near the lower-left, not a big card.

Current immersive elements (index.html `#immersiveMap`): `imm-top-hud`,
`imm-bottom-hud`, `imm-credit`, `immWeatherCard`, `immersiveLegend`, `imm-timeline`.
CSS lives in styles.css under the `/* Immersive map */` section + `.imm-*` rules.
Inline map stays a clean preview (controls already hidden) — redesign targets immersive only.

Shipped notes:
- Top HUD is close-left, saved-place switcher pill, and Nowcast/Forecast.
- Explicit zoom controls were removed from immersive mode.
- Bottom HUD now groups play/pause, full-width scrubber, frame time, and attribution.
- Mobile v1.10.96 refinement: scrubber/play controls are transparent hit areas instead of a heavy
  card, and the frame time no longer consumes slider width.
- v1.10.98 simplification: use the same lightweight HUD language across desktop/mobile, move close
  to top-left, make the place pill open saved places, remove explicit zoom controls, and switch the
  immersive legend to a vertical strip.
- v1.10.99 interaction pass: keep play/pause intent across place/mode changes, add more tolerant
  immersive taps, and avoid outrunning still-loading radar tiles on the first animation pass.
- v1.10.128 precipitation timeline pass: retire the immersive Nowcast/Forecast toggle, land on Now
  when entering immersive mode, show radar history left of Now and forecast guidance right of Now,
  loop radar playback into Now, and stop/hold forecast playback at the final guidance frame.
- v1.10.129 time-indicator pass: add a thumb-attached timeline bubble while scrubbing or playing,
  showing source, selected-place local time, and relative timing without adding persistent chrome.

**Keep in mind for #5:** the basemap will likely move to CARTO with a **theme-matched dark base in
immersive**. Design the HUD glass to read well over BOTH a light and a dark basemap (dark glass +
blur generally works on both; verify on dark when #5 lands). Don't bake in assumptions that only
hold over the current light OSM base.

## Phase 3 — labels over radar / basemap (#5) — SPIKED v1.10.103

Problem: OSM bakes labels into the base tile, so radar always covers city names.
Recommended: switch base tiles to **CARTO** (OSM data, restyled — same coverage/zooms, no
capability loss) and render a **labels-only layer ABOVE the radar** so names stay readable.
- Likely styles: Voyager (detailed+clean) OR a Positron(light)/Dark-Matter(dark) theme pair.
- We already render separate panes (base / weather / marker); add a `labelTileLayer` above weather.
- Open question the user is weighing: CARTO dependency (keyless raster, attribution, fair-use) vs
  keeping OSM. Verify CARTO keyless tiles actually load before committing.
- Theme-matched dark basemap in immersive is a real aesthetic upgrade OSM can't give.

Spike notes:
- Keyless CARTO tiles were verified for Voyager no-labels/only-labels and Dark Matter
  no-labels/only-labels.
- The renderer now uses `baseTileLayer`, `weatherTileLayer`, `labelTileLayer`, then
  `markerLayer`, so place names stay above radar while saved-place markers remain topmost.
- Attribution was updated to CARTO + OpenStreetMap contributors.
- v1.10.104 follow-up: dark app mode now keeps Voyager no-label/label tiles
  instead of the full Dark Matter basemap; the app chrome can stay dark while
  the map keeps road/park/city detail and radar contrast.
- Remaining decision after mobile testing: keep CARTO long-term, or preserve this layer
  abstraction and swap providers if public-launch terms require it.

## Deploy ritual reminder
Bump 5 spots in lockstep: `VERSION` (app.js), `CACHE` and `ASSET_VERSION` (sw.js), and both
`?v=` query strings in index.html. Verify in preview → commit (Co-Authored-By) → push.
