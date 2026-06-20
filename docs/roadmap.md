# Nearcast roadmap — great → phenomenal

Living doc of the biggest next bets. As of **v2.2.3**. Companion to
[`map-overhaul.md`](./map-overhaul.md) (map-specific phases, mostly shipped).

## Where we are
Nearcast is already a genuine **great** (≈8/10) — better than most weather apps, with
real differentiators. The honest gap to *phenomenal* is mostly: it's reactive (you have to
open it), the feel isn't yet delightful in motion, and identity is faint.

**Protect these — they're the soul of the app, don't regress them:**
- **The map** — labels-over-radar on CARTO, smooth hard-cut animation, the Now-centered
  precipitation timeline. Better than Apple Weather's radar.
- **Glanceable intelligence** — NOW/NEXT/LATER chips + "Today at a glance" human phrasing
  ("Feels 9°F warmer", "Very muggy").
- **NearAI Planner** — on-device, forecast-grounded windows, free-form place/time parsing.
  The clearest "only Nearcast does this."
- **Living sky** — real sun/moon arc + time-of-day color (v2.2.0).
- **Light & Sun arc + Temp/Wind/Sun day graph.**

---

## The biggest bets (priority order)

### 1. Proactivity — notifications  ·  impact: ★★★★★  ·  effort: ★★★★
**The single biggest lever.** Today Nearcast is an app you must *remember to open*. Every
phenomenal weather app earns its home-screen spot by reaching out. We already compute the
nowcast ("Dry next 2 hours") and have NWS alerts — we have the data, not the delivery.
- **Ship:** "rain starting in ~20 min," a morning briefing, severe-weather pushes.
- **Honest constraints:** true push needs a tiny server + VAPID keys (the SW can't schedule
  reliably on its own); **iOS PWA push requires the app be added to the home screen**
  (iOS 16.4+) and permission granted. Scope this realistically before committing.
- **First step:** spike the SW push handler + a minimal push endpoint; gate everything behind
  an explicit opt-in. Start with one notification type (rain-starting) done well.

### 2. Bright-daylight readability  ·  impact: ★★★  ·  effort: ★★  ·  OPEN
Reverted in v2.2.3 after two heavy-handed tries (white veil washed out the sky; frosted
panels were "better, not great"). The real issue is narrow: muted text + faint temp-track
rails over a bright clear-day sky.
- **Approach next time — surgical, not global:** don't touch the sky or a global wash.
  Options to test on-device: (a) bump only the *faintest* tokens (`--muted`, the temp-track
  unfilled rail) a notch when `data-sky` is `clear-day`/`partly-cloudy-day`; (b) a *very*
  light per-row scrim only behind text, not a panel card. Keep the sky fully visible.
- Get the user to A/B a couple of options on a real device rather than guessing in preview.

### 3. Signature motion & continuity  ·  impact: ★★★★  ·  effort: ★★★
Interactions work but aren't *delightful*. Craft in motion is what makes an app feel
expensive.
- Shared-element transition from a launch chip / day row into its detail sheet.
- Spring easing on sheets; subtle parallax on the sky as you scroll; tasteful
  micro-interactions (favorite star, unit toggle, pull-to-refresh).

### 4. Round out usefulness — air quality, pollen, trends  ·  impact: ★★★  ·  effort: ★★
- **Air quality + pollen:** Open-Meteo has a free Air-Quality API (US/EU AQI, PM2.5, pollen).
  Fits the glance panel and the Planner ("don't recommend a run at AQI 160").
- **Trends:** "warmer than yesterday," "coldest day this week" — cheap, human, sticky.

### 5. Identity & first-run  ·  impact: ★★  ·  effort: ★★
Strong thesis (*hyperlocal · private AI · glanceable*) that barely announces itself.
- A short, characterful first-run that states the point of view.
- A more narrative "your day" voice in the summaries.

---

## Foundation (enables everything above)

### Codebase health  ·  impact: (velocity)  ·  effort: ★★★
`app.js` is **~9.4k lines in one file**. Not user-facing, but it's now large enough to slow
the ambitious work above. A low-risk split into modules (e.g. `map.js`, `planner.js`,
`sky.js`, `daygraph.js`, `forecast.js`) would pay for itself quickly. Do it as a pure
move-only refactor with verification, no behavior change.

---

## Suggested sequence
1. **Notifications spike** (#1) — biggest payoff; de-risk the iOS/push constraints early.
2. **Bright-day readability** (#2) — quick, surgical, finishes the living-sky work.
3. **Air quality / pollen** (#4) — easy data win that strengthens the Planner.
4. **Module split** (foundation) — before or alongside the next big feature.
5. **Motion polish** (#3) and **identity** (#5) — ongoing craft passes.
