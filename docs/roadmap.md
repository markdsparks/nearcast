# Nearcast roadmap - great to indispensable

Living product roadmap. Current as of **v2.6.24**.

Nearcast has moved past a generic weather-app build. The core product is now:

- A private, contextual weather assistant for the moments people actually plan around.
- A highly visual current-conditions app with a living sky, radar map, and glanceable truth.
- A local-first PWA that intentionally avoids backend complexity unless a feature clearly earns it.

The next phase is not "add more weather widgets." It is to protect trust, make personal context useful without clutter, and decide when the product is ready for the proactivity/backend leap.

## Where we are now

### Shipped strengths to protect

- **NearAI Planner** - forecast-grounded answers for real activities like golf, bike rides, school runs, and ballgames. This is the app's clearest moat.
- **Shared weather truth** - hero icon, living sky, Today at a Glance, hourly current, and receipts now route through a shared current-condition model. Active precipitation can define the scene; merely "rain soon" should not.
- **Radar-backed current precipitation** - fresh radar over the selected place can promote the app to "rain now"; nearby radar becomes "rain nearby" instead of pretending rain is active.
- **Living sky** - time of day, sun angle, cloud, precipitation, humidity, wind, AQI, and pollen now shape the feel of the background.
- **Radar map** - labels over radar, a place marker, and a Now-centered timeline remain a class-leading surface.
- **Plan memory** - users can keep local context for personally meaningful windows, and those windows appear in hourly/day graph views.
- **Air quality and pollen** - now part of the glance layer and planner context, with an AQI visual and scale detail.
- **Brand and welcome** - the durable Nearcast mark is integrated across app icon, welcome, and first-run identity.

### Current constraints

- **Static deployment** - GitHub Pages keeps the app cheap and simple, but real push notifications require a small backend/serverless layer and VAPID keys.
- **Code size** - `app.js` is now over 13k lines. This is not yet a user problem, but it is becoming a product velocity and regression-risk problem.
- **Testing loop** - most visual truth issues are found through real-device testing. We need to keep shipping small, observable increments.
- **Local AI budget** - a large on-device LLM is only worth carrying if it does something deterministic code cannot, such as alert translation, richer plan parsing, or personal-context synthesis.

## Product principles

1. **Truth before drama**
   The app can be immersive, but it should not overstate current conditions. Active weather may define the scene. Future or nearby weather should be clearly phrased as future or nearby.

2. **Personal context under user control**
   Memories should feel useful, inspectable, editable, and easy to forget. They should enrich views without muddying the base forecast.

3. **Glance first, details one tap away**
   The first screen should answer "what matters now?" Details, receipts, AQI ranges, memory details, and graph overlays should be available without crowding the main read.

4. **Backend only when it unlocks a must-have behavior**
   A backend is justified for proactivity and push. It is not justified for ordinary forecast display, saved places, or local memories.

5. **Small craft fixes matter**
   Mismatched icons, clipped labels, overlapping chrome, and washed-out text erode the trust the rest of the app works hard to earn.

## Priority roadmap

### 1. Trust and craft hardening

Status: **in progress**.

Goal: make the app feel consistently premium and internally coherent across real test locations.

Shipped in v2.6.24:

- AQI card no longer repeats the same value twice.
- Air visual labels wrap more gracefully.
- 10-day labels have more room while temp bars stay aligned.
- Floating menu chrome tucks away while reading lower content.
- Bright clear-day text and temp rails have stronger contrast.

Next checks:

- Verify the scroll-aware menu on iOS PWA after normal and fast scrolls.
- Test clear-day, warm evening, overcast, rain, and night scenes on-device.
- Watch for any remaining hero/background/glance mismatch after the radar truth change.
- Confirm the welcome screen still fills the viewport after fresh install and after IP ambience resolves.

### 2. Roadmap and product language refresh

Status: **this document**.

Goal: keep the product plan aligned with reality so we do not chase stale priorities.

Artifacts to keep current:

- `docs/roadmap.md` - product sequence and principles.
- `docs/map-overhaul.md` - map-specific history and future map work.
- Optional future `docs/weather-truth.md` - explain the shared truth object, radar precedence, current-vs-soon behavior, and surface rules.

### 3. Codebase health: move-only modular split

Status: **next foundation bet**.

Goal: reduce regression risk without changing behavior.

Recommended first extraction:

- `weather-truth.js` - precipitation truth, radar signal interpretation, current/scene code selection, receipts.

Why first:

- This is where the most trust-sensitive bugs have clustered.
- It is logically separable from DOM rendering.
- It gives us a place to add targeted test fixtures for "rain now", "rain soon", "radar nearby", "clear radar", and day/night transitions.

Follow-up extractions:

- `sky.js` - living sky rendering and atmospheric state.
- `planner.js` - parser, deterministic activity rules, memory creation.
- `memory.js` - local plan memory storage, edit/delete/detail logic.
- `map.js` - radar/future map frames and tile rendering.
- `day-detail.js` - day sheet, graphs, memory overlays.

Rules for the split:

- Move-only first. No behavior changes in the same commit.
- Keep globals temporarily if that makes the split safer.
- Add smoke checks after each module lands.

### 4. Personal context that earns its space

Status: **designed and partially shipped**.

Goal: make local memory feel like Nearcast understands the user's real life, without turning every surface into a calendar.

Next bets:

- A global memory management view that is clearly not scoped only to the currently selected place.
- Better memory density rules: show specific labels when one memory matters, summarize when several overlap, and keep all details one tap away.
- Planner follow-through: when a user asks about a plan, make it easy to keep, edit, forget, or inspect the interpreted window.
- Graph overlays that remain legible when memory bands overlap highs/lows or labels.

Guardrails:

- No surprise persistence. The user should always understand what was remembered.
- Memories should stay local unless the user explicitly opts into a future sync/backend model.
- Context should enhance planner/hourly/day views, not dominate them.

### 5. Signature motion and continuity

Status: **not started**.

Goal: make Nearcast feel more alive and expensive without adding clutter.

Candidates:

- Springier bottom sheets and detail cards.
- Shared-element feeling from NOW/NEXT/LATER chips into detail views.
- Day-row to day-detail continuity.
- Subtle sky parallax that responds to scroll without hurting readability.
- Pull-to-refresh that feels native in the PWA.

Priority note:

Motion should follow trust. Do not animate broken or unclear states.

### 6. Proactivity: notification spike

Status: **deferred until we accept a backend/serverless layer**.

Goal: make Nearcast useful before the user remembers to open it.

First notification to prove:

- "Rain starting near [place] in about 20 minutes."

Why this first:

- It is concrete, high value, and already supported by nowcast/radar truth.
- It does not require a broad notification product.
- It tests the actual hard parts: opt-in, VAPID, iOS PWA install behavior, background reliability, and user trust.

Required architecture:

- Minimal push endpoint.
- VAPID keys.
- Subscription storage.
- Service worker push handler.
- Explicit opt-in UI.
- A conservative scheduler/checker that avoids noisy notifications.

Do not start with:

- Morning briefings.
- Multi-place notification rules.
- AI-generated push prose.
- Severe weather alert rewriting.

Those can come after the rain-starting spike proves the channel.

### 7. Local AI, only where it clearly wins

Status: **questionable as currently scoped**.

Current stance:

- Deterministic planner logic is already doing the important weather reasoning.
- A large local LLM is too expensive if it only rewrites a short summary.

Possible valid uses:

- Plain-language translation of NWS alert jargon.
- More forgiving natural-language plan parsing.
- Personal-context synthesis across saved memories.
- Tone rewrite for planner answers, only after deterministic facts are locked.

Rule:

- AI may explain, translate, or interpret. It should not be the source of weather truth.

## Suggested next sequence

1. Finish testing v2.6.24 and patch any regressions from the trust/craft pass.
2. Add a dedicated `weather-truth.js` module with no behavior changes.
3. Add small fixture tests around weather truth cases.
4. Improve the global memory management surface.
5. Add one signature motion pass.
6. Decide whether to start the notification backend spike.

## Backlog

- Repo cleanup: move design exploration files out of the deploy root or ignore them, and ignore `.DS_Store`.
- Dedicated weather-truth documentation.
- AQI/pollen planner refinements.
- Better saved-place comparison.
- Offline fallback polish.
- Optional install/onboarding education for PWA push, if notifications move forward.
