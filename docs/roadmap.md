# Nearcast roadmap - from beautiful to indispensable

Living product roadmap. Current as of **v3.0.168**.

Nearcast is no longer a generic weather-app build. The product thesis is:

- **Trustworthy weather truth**: current conditions, forecast, alerts, radar, and
  visual atmosphere should agree with each other.
- **Personal weather decisions**: plans, saved places, and watched windows should
  answer "what does this mean for me?" without making the user manage weather
  data.
- **Beautiful, low-friction context**: the living sky and map should make the
  app feel alive, but never at the expense of clarity, performance, or trust.
- **Local-first by default**: stay cheap and private until a backend unlocks a
  behavior users can immediately feel, such as reliable notifications.

The next phase is not "add more widgets." It is to make Nearcast excellent at
turning weather into timely, human guidance for places and plans.

## Where We Are Now

### Shipped strengths to protect

- **Living current conditions**: the hero, sky, NOW/NEXT/LATER chips, glance
  cards, hourly rows, and details form a premium first screen.
- **Performance-aware immersion**: the animated background remains atmospheric,
  but pauses during maps and active app work so interaction stays responsive.
- **Free WebGL radar path**: the main app uses the free radar/map surface again,
  with generated MRMS gated behind explicit debug experiment flags.
- **Generated MRMS archived cleanly**: the high-detail radar spike is preserved
  as an experiment, not carried as main-product complexity.
- **Plan-aware weather**: users can create and watch plans, and the app can
  compare those windows against forecast and alert context.
- **Human-centered watched-plan UI**: watched plans now lead with what matters,
  show contextual weather metrics, and avoid exposing plan/watch/memory
  complexity as separate mental models.
- **Watching command center**: the main Watching sheet now starts with the human
  read, then explains what can notify the user, recent calls, and watched
  plans/places from one surface.
- **Contextual notification entry**: plan and saved-place notifications now
  deep-link back into the relevant watched context, with recent updates kept
  locally in the Watching surface.
- **Contextual PWA install entry**: install guidance is now an earned,
  dismissible nudge in the app menu and Today surface instead of an old release
  splash.
- **Hourly rain visibility**: hourly surfaces now keep nonzero rain chance
  visible by default, while still reserving stronger emphasis for active or
  meaningful rain signals.
- **Cleaner normal settings**: debug controls for map renderer, radar provider,
  radar zoom, and diagnostics are hidden unless explicitly enabled.
- **Local-first memory**: personal plan context stays inspectable and forgettable
  without implying cloud sync or surprise persistence.

### Decisions from the radar spike

Generated MRMS proved that Nearcast can render beautiful radar from public
numeric data, especially with encoded tiles and client-side WebGL styling. It
also proved that large-scale, deep-zoom generated radar is not worth the current
cost and operational complexity.

Main-app rule:

- Auto radar should stay on the free WebGL provider path.
- Generated MRMS should stay behind experiment/debug flags.
- Do not reintroduce generated MRMS into normal routing until it has no blanking,
  no persistent "enhancing" state, no visible zoom-mode switching, and a clear
  operating cost below the value it creates.

See `docs/generated-mrms-spike-archive.md` for the full decision record.

### Current constraints

- **Weather truth is still too spread out**: plan guidance, hero visuals, radar
  truth, alert text, and future notifications need one shared interpretation
  layer.
- **`app.js` is too large**: this is not a user-facing issue yet, but it slows
  safe iteration and makes regressions more likely.
- **Notifications require backend commitment**: reliable push needs VAPID keys,
  subscription storage, a scheduler, and a conservative rule engine.
- **Watched plans are promising but young**: the UX now points in the right
  direction, but the guidance model needs sharper statuses, action language, and
  a clean path into notifications.
- **No real usage signal yet**: product calls are still based on hands-on testing
  and judgment. That is fine at this stage, but roadmap bets should stay small
  and observable.

## Product Principles

1. **Tell people what matters**
   The app should translate weather into practical meaning: go now, wait, bring
   water, expect rain, consider indoors, or keep an eye on it.

2. **Truth before drama**
   Do not overstate current conditions. Active weather, nearby weather, future
   weather, and alert overlap should each be phrased honestly.

3. **One model, many surfaces**
   The hero, glance chips, maps, plans, details, and future notifications should
   be different presentations of the same underlying weather truth.

4. **Personal context under user control**
   Saved places and watched plans should feel helpful, editable, and easy to
   forget. They should not turn the app into a complicated calendar.

5. **Glance first, depth one tap away**
   The first screen should answer the urgent question. Details, receipts,
   hourly ranges, maps, and plan context should be close but not crowded.

6. **Performance is part of beauty**
   Immersion only works if the app feels responsive. Motion should adapt to what
   the user is doing.

7. **Backend only when it earns the cost**
   A backend is justified for proactivity and push. It is not justified for
   ordinary forecast display, saved places, local memories, or visual polish.

## Priority Roadmap

### 1. Watched Plans As The Product Wedge

Status: **next product push**.

Goal: make a watched plan feel like the reason Nearcast exists.

Target experience:

- User saves or watches a plan.
- Nearcast explains the main weather risk in human language.
- The watched plan shows only the most relevant metrics for that risk.
- The app suggests practical contingencies without sounding alarmist.
- One tap opens hourly detail for the plan window.
- The user can change or forget the plan without feeling trapped.

Next build bets:

- Refine plan status language into a small, consistent set:
  `Looks good`, `Keep an eye on it`, `Plan around heat`, `Expect rain`, `Wind may
  matter`, `Weather alert overlaps`.
- Add contextual action copy by risk type:
  heat, storms, rain, wind, cold, smoke/AQI, and mixed conditions.
- Make watched-plan cards summarize multi-hour ranges consistently:
  temperature range, feels-like range, max UV, max gusts, rain chance/range, and
  alert overlap.
- Add a "notify me" affordance only when the plan has a meaningful future
  change to monitor.
- Keep past plans and memory management secondary.

Definition of done:

- A normal user can tap a watched plan and understand the weather story in under
  five seconds.
- No clipped text.
- No duplicate plan/watch/memory framing.
- No provider-shaped or system-shaped language.

### 2. Notification Spike

Status: **prepare after watched-plan UX feels solid**.

Goal: prove Nearcast can help before the user remembers to open it.

First notification:

```text
Rain may affect [plan/place] around [time].
```

Why this first:

- It is concrete and high value.
- It connects directly to saved places and watched plans.
- It can be conservative without pretending to be a full alerting platform.
- It tests the real hard parts: install behavior, permission timing, VAPID,
  subscription storage, background checks, and user trust.

Initial scope:

- One opt-in surface tied to watched plans and saved places.
- One or two deterministic triggers:
  rain starting soon, alert overlap worsening, or heat risk increasing.
- Quiet hours and duplicate suppression.
- Service worker push handler.
- Minimal serverless endpoint and subscription store.

Do not start with:

- Morning briefings.
- AI-generated push prose.
- Severe weather replacement.
- Multi-rule notification settings.
- Cloud account/sync.

### 3. Weather Truth Extraction

Status: **started**.

Goal: create one shared interpretation layer before notifications and more plan
logic raise the cost of inconsistency.

First module:

- `weather-truth.js`

Responsibilities:

- Current-condition code selection.
- Active precipitation vs nearby precipitation vs rain soon.
- Alert overlap classification.
- Multi-hour plan-window rollups.
- Heat, UV, wind, rain, storm, cold, AQI, and mixed-risk summaries.
- Receipts that explain why a surface says what it says.

Rules:

- Move-only where possible.
- Add behavior tests around fixtures before changing logic.
- Keep UI rendering outside the module.
- Use deterministic rules for weather truth; AI may explain, not decide.

Starter fixtures:

- Clear but hot afternoon plan.
- Rain starting within 20 minutes.
- Radar nearby but not over the place.
- Alert overlapping only part of a plan window.
- Storm risk with low rain probability but active NWS alert.
- Windy but otherwise good outdoor plan.

First shipped slice:

- Watched-plan receipts now come from `weather-truth.js` and explain the
  evidence behind the verdict in the focused plan view.
- Notification sync/evaluator records can carry receipt text in `lastKnown`, so
  server-side watch state has room for the same explanation model.
- The Watch sheet now includes a simple activity panel showing active plans,
  saved-place watch selection, notification readiness, last sync, and recent
  matched changes from this device.
- Planner result cards now lead with one primary decision action, then tuck
  hourly detail and plan changes into secondary actions so saving a watch feels
  like the natural next step instead of a tool menu.
- Forecast-change language now says `Forecast changed` instead of implying the
  user's last tap was the baseline, and the watched-plan baseline refreshes
  after new continuity snapshots are saved.
- Opening a changed watched plan now reviews that exact forecast change, keeps
  the explanation visible in the focused sheet, and advances the local baseline
  so the same change does not keep reappearing as unresolved.
- Focused watched-plan sheets now stay centered on the plan story and plan-level
  actions; broader notification and saved-place controls live on the main
  Watching overview.
- The Watch sheet now has a unified `Watching controls` panel for plan and
  saved-place notification opt-ins, so users can manage what can interrupt them
  from one place.
- `weather-truth.js` now exposes the shared plan-watch truth contract used by
  both the browser UI and the Cloudflare notification evaluator: current state,
  change detection, last-known receipts, and notification candidates now come
  from the same deterministic plan weather spine.
- The Watch sheet now has a single notification management hub that explains
  device readiness, selected plans, selected saved places, sync health, and the
  kinds of changes that can interrupt the user.
- The planner is now framed as `Plan Check`: a simpler flow where the user types
  a real plan, gets one forecast-grounded decision, and can watch that plan for
  meaningful changes.
- Plan Check now treats the newest forecast read as the primary result, tucks
  earlier checks behind a disclosure, and links to Watching without duplicating
  the watched-plan list in the planner sheet.
- Plan Check now distinguishes explicit `next Saturday` / `next weekend` from
  bare weekday wording, and day-change choices cover the available 10-day
  forecast window.
- The Watching sheet no longer exposes manual push subscription sync. Notification
  registration stays automatic and the sheet uses plain `Updates` readiness
  language instead of server-sync controls.
- Watched-plan `Hourly detail` now opens a plan-window trust view instead of a
  generic hourly sheet: it shows the main read, best adjustment, contextual
  metrics, a key-hour callout, and only the hours around the plan.
- The main Watching overview now opens as a user-facing command center: first the
  plain-language watch read, then notification readiness, recent calls, and the selected
  plan/place targets.

### 4. Trust And Craft Hardening

Status: **ongoing**.

Goal: keep the app feeling premium as product complexity grows.

Current checks:

- iOS PWA performance after background pause changes.
- Text clipping in watched-plan and bottom-sheet layouts.
- Search, menu, map, and day-sheet motion/responsiveness.
- Hero/background/glance agreement during rain, heat, smoke, night, and clear
  day scenes.
- Debug settings remain hidden in normal app use.

Working rule:

- If a surface feels complicated, first remove exposed concepts. Add detail only
  after the main read is obvious.

### 5. Motion And Continuity

Status: **selective polish**.

Goal: make Nearcast feel expensive without adding cognitive load.

Candidates:

- Shared transition from NOW/NEXT/LATER chips into detail.
- Watched-plan card into hourly plan-window detail.
- More native-feeling sheet entrance/exit motion.
- Pull-to-refresh that feels intentional.
- Subtle sky continuity that preserves performance.

Guardrail:

- Motion should support orientation. If it competes with weather meaning or
  hurts responsiveness, it is not worth it.

### 6. Local AI, Only Where It Clearly Wins

Status: **limited**.

Current stance:

- Deterministic code should own weather truth.
- AI is useful when it translates, explains, parses, or synthesizes personal
  context.

Good uses:

- More forgiving natural-language plan parsing.
- Plain-language translation of NWS alert jargon.
- Tone polish for plan guidance after deterministic facts are locked.
- Personal-context synthesis across saved plans and places.

Bad uses:

- Deciding whether the weather is safe.
- Inventing risk from vague forecast text.
- Replacing simple deterministic summaries.

## Suggested Next Sequence

1. Finish the watched-plan decision layer.
2. Add notification-ready affordances in watched plans without enabling push yet.
3. Extract `weather-truth.js` with fixtures.
4. Build the smallest push notification spike.
5. Continue craft/performance hardening after each shipped increment.
6. Revisit generated radar only if usage, revenue, or architecture changes make
   it clearly worth the cost.

## Parking Lot

- Dedicated `docs/weather-truth.md`.
- Provider bake-off for premium radar only if radar becomes a paid wedge.
- Offline fallback polish.
- Better saved-place comparison.
- AQI/pollen plan refinements.
- Install/onboarding education if notifications ship.
- Repo cleanup for generated-radar artifacts and design explorations.
