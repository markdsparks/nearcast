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
| 4 | HUD looks scattered | 2 — HUD | ✅ shipped v1.10.93 (two-zone immersive HUD) |
| 5 | City names hidden under storms | 3 — basemap/labels | ⏳ pending CARTO decision |

## Phase 2 — HUD redesign (#4) — SHIPPED v1.10.93

Target: a cohesive **two-zone** immersive HUD instead of independently-placed chips.

**Top zone**
- Top-left: weather context pill — place + temp + small condition icon ("Maryville · 79° ⛅").
- Top-center: Nowcast / Forecast segmented control (the primary mode toggle gets prominence).
- Top-right: close (✕) only. Zoom +/− become a compact vertical pair (right edge, standard map convention).

**Bottom zone** — one cohesive control rail
- Play/pause + a **slim** scrubber (thin track, small thumb, big hitbox via padding — NOT a heavy
  bordered card) + the current frame time (replaces the floating top-left frame chip).
- Legend: a slim radar-intensity gradient strip just above the rail (compact, a few labels), not a
  big card.

Current immersive elements (index.html `#immersiveMap`): `imm-top-hud`, `imm-mode-switch`,
`imm-zoom-stack`, `imm-bottom-hud`, `imm-credit`, `imm-weather-pill`, `immersiveLegend`,
`imm-timeline`.
CSS lives in styles.css under the `/* Immersive map */` section + `.imm-*` rules.
Inline map stays a clean preview (controls already hidden) — redesign targets immersive only.

Shipped notes:
- Top HUD is now weather context left, Nowcast/Forecast centered, close right.
- Zoom controls moved into a compact right-edge vertical pair.
- Bottom HUD now groups compact legend, play/pause, full-width scrubber, frame time, and attribution.

**Keep in mind for #5:** the basemap will likely move to CARTO with a **theme-matched dark base in
immersive**. Design the HUD glass to read well over BOTH a light and a dark basemap (dark glass +
blur generally works on both; verify on dark when #5 lands). Don't bake in assumptions that only
hold over the current light OSM base.

## Phase 3 — labels over radar / basemap (#5) — PENDING DECISION

Problem: OSM bakes labels into the base tile, so radar always covers city names.
Recommended: switch base tiles to **CARTO** (OSM data, restyled — same coverage/zooms, no
capability loss) and render a **labels-only layer ABOVE the radar** so names stay readable.
- Likely styles: Voyager (detailed+clean) OR a Positron(light)/Dark-Matter(dark) theme pair.
- We already render separate panes (base / weather / marker); add a `labelTileLayer` above weather.
- Open question the user is weighing: CARTO dependency (keyless raster, attribution, fair-use) vs
  keeping OSM. Verify CARTO keyless tiles actually load before committing.
- Theme-matched dark basemap in immersive is a real aesthetic upgrade OSM can't give.

## Deploy ritual reminder
Bump 5 spots in lockstep: `VERSION` (app.js), `CACHE` and `ASSET_VERSION` (sw.js), and both
`?v=` query strings in index.html. Verify in preview → commit (Co-Authored-By) → push.
