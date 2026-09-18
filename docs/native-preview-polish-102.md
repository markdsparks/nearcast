# Native preview refinement — build 102

September 18, 2026. Same Phase 1 / TestFlight A checkpoint, not a move to Phase 2 or native default.

Family feedback on build 101: the preview works, but the experience is not yet wonderful. This round concentrates on the first glance and forecast exploration. The existing app remains the default and the preview's record/notification boundaries are unchanged.

## What changed

- A more compact current-weather hero, quieter navigation chrome, and a softer day/night background. Place names still wrap rather than being covered by controls.
- A combined outlook and timeline with about four to five visible hours at standard text size, values attached to their trend points, and quieter interval/metric controls. Larger text uses wider columns rather than shrinking weather labels.
- Grounded morning/afternoon/tonight and selected-day copy: actual precipitation timing, sustained cloud changes, meaningful temperature trends, or notable wind. No zero-percent filler or invented dry guarantees; thunder possibility remains qualified.
- Today continues into tomorrow using actual forecast samples. Midnight is labeled in both the timeline and the 15-minute list, including when the first available row is already tomorrow. Selected-day views remain date-bounded and retain all 25 hours on a fall-back day.
- Previous/next controls on selected-day forecasts, daily temperature-range bars on one shared scale, and an explicit scroll-to-top action when Today is tapped again.
- Accessible larger-text navigation expands into rows so destinations remain visible and labels do not split into fragments.

No new provider, server endpoint, AI submission, notification permission, saved-record writer, or background publisher is added. Map, Ask, Plans, and other unmigrated details retain the existing explicit handoff.

## What to try on both phones

1. Open **Menu → Native weather preview**. In five seconds, can you tell what it is like now and what changes next? Compare the amount of useful information with build 101 and existing Nearcast.
2. Swipe the timeline sideways, then scroll vertically starting on the timeline. Check long storm labels, all five metrics, and the active selection. There should be no chopped text or gesture trap.
3. Open tomorrow, use the next/previous arrows, open Hourly, and tap Today. Tap Today again from lower down the page. Dates and navigation should remain clear.
4. At an evening location, follow the timeline across midnight. Check 15-minute date headings where actual coverage exists. A forecast hour is labeled with its hour, not misleadingly relabeled as the current observation.
5. Try larger text and dark appearance. Confirm navigation remains readable and all destinations remain available. Close the preview and confirm the existing app still has its selected place unless you explicitly confirmed a handoff.

## Verification and release record

- Portable and native-model suites: PASS, including new outlook fixtures and midnight/DST presentation-window tests.
- Simulator project build: PASS during development; final release archive/upload still pending at preparation time.
- Observed on Pro/Pro Max simulators: denser timeline, day arrows, selected-day copy, long place name, local nighttime outlook, larger-text layout. A larger-text tab-label issue found during QA was corrected.
- Device Hub's automated drag did not establish physical scrolling behavior. Touch feel, full VoiceOver operation, and performance remain family/device acceptance checks; they are not inferred passes.
- Watch/widget delivery is not newly established by this refinement. Their existing publication path is unchanged.
- Source commit: pending release.
- TestFlight: build 102 candidate; upload not yet recorded.

Do not treat the functional feedback on build 101 as approval to replace the existing app. The next decision is whether this refinement feels materially better before expanding native feature scope.
