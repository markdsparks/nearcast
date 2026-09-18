# Native Places and Settings — build 104

September 18, 2026. **Phase 2B1: editable native controls, existing authoritative storage.** Native preview remains opt-in. This is not Phase 2 completion or native ownership activation.

## Where to find it

Open **Menu → Native weather preview**. Tap the place name for Places, or the gear at the top for Settings. Both sections are also reachable from the same sheet.

- Search by city or ZIP, select a result, or bookmark it without changing the current place.
- Rename, move up/down, or remove a saved place from its options menu. Existing eight-place capacity is preserved; a ninth place is rejected, never silently evicted.
- Use current location only after explicitly choosing that action. Opening Places alone does not ask for permission.
- Change Fahrenheit/Celsius, Auto/12/24-hour clock, and Auto/Light/Dark appearance. Auto retains its existing meaning, including day/night appearance at the selected place.
- Sky effects, motion, and advanced options still open the existing Settings surface. Plans, Ask, radar and notification management retain their existing implementation.

Unlike the earlier read-only preview, **these controls make real saved changes**. Closing the preview does not undo them.

## Family test

1. Add a temporary city, give it a nickname, move it, and select it. Check that its name and forecast agree. Return to the existing app, then force-close/reopen: the same place, nickname and order should remain.
2. Remove that temporary city, reopen Places, and restart. It must stay removed; existing plans must remain. Removing a saved place also stops that saved-place watch selection, as the existing app does.
3. Set Celsius and 24-hour time, then inspect Today, Hourly, a future day and Sun & daylight. Switch back to Fahrenheit and your preferred clock. The selected options and displayed values should agree immediately.
4. Try a European city with a long name, Light/Dark/Auto, and larger text. No clipped names or unreachable controls. Auto clock should follow the phone; forecast times remain local to the selected place.
5. Try a search or place switch with connectivity unavailable, then restore it and retry deliberately. Never claim a place switch succeeded without its matching forecast; don't automatically repeat an uncertain save.
6. Check your existing widget and Watch after committed place/unit/clock changes and normal refresh. No extra watches or notification permission prompt should appear. Physical delivery remains a family acceptance check, not a simulator claim.

## Safety and implementation boundary

The existing app remains the sole owner of saved places, preferences, watch selection, and publication. Native controls submit strict version-1 commands through the trusted loaded page and accept only a matching validated receipt. Each mutation includes its last confirmed source; concurrent/stale edits are rejected with a refreshable snapshot rather than overwriting newer records. Numeric legacy IDs, aliases, exact coordinates, time zones, order, optional following flags and raw Auto preferences are preserved. Native forecast context is updated only from verified records.

The native migration store retains protected read-back rehearsal copies, not a second live database. No ownership marker is switched and no browser record is cleared. The remaining ownership handover must still route every legacy writer and coordinate widget/Watch publication before removing the web dependency.

The adapter serializes commands and caches request receipts; it does not automatically replay uncertain mutations. Search has a 12-second deadline and late results are ignored. Storage failures report failure or possible partial completion rather than a false success. Existing implicit watch targets are frozen before adding/reordering/removing places so these structural changes do not broaden delivery. Removal persists and verifies the watch opt-out before deleting the saved entry, preventing a later re-add from silently reactivating it. No new background publisher, permission, calendar access, endpoint, account, sync or telemetry is added.

Compatibility is advertised as `preview.controlsVersion: 1`. Old hosts do not show these native controls; old/incompatible pages fail closed and offer the existing app. Source records and command contents are not logged. Local QA uses loopback-only synthetic public-city records with watches disabled, not family storage.

## Engineering evidence and release record

- Full portable and native shared-model checks passed, including typed receipts, strict validation, stale edits, numeric IDs, alias clearing, capacity, search timeout/late results, notification target preservation, storage failure and metadata-only forecast refresh races.
- Debug iOS Simulator build passed after fixing a WebKit overload that returned before the command receipt. The actual WK bridge was then exercised successfully, not inferred from source tests.
- Isolated iPhone 17 Pro / iOS 27 simulator: rename, reorder, exact European place switch, search/save/remove of a synthetic Hardin Kentucky entry, Celsius, 12-hour time, Light appearance, and large-text Places/Settings layouts verified. Native forecast immediately reflected the committed place and settings.
- Cold relaunch on Pro retained the selected European place, Celsius, 12-hour time, Light appearance, renamed/reordered saved entries and the test-place deletion. No deleted entry returned.
- Isolated iPhone 17 Pro Max / iOS 27: final Debug build, dark native Settings, exact European place switch and the corrected Existing Settings handoff verified. The existing menu opened with the matching place and preferences. A stale legacy hourly-sheet issue found during testing was corrected; the regression clears its old dataset before a later preference refresh can relabel it.
- Final Debug and Release iOS Simulator builds passed. Existing Watch asset-catalog warnings remain; they are unrelated to the new controls. No physical touch, full VoiceOver, performance or Watch delivery pass is claimed.
- Signed archive/upload and final source commit are recorded below when complete.

Web companion: **3.0.411**. Native targets: **104**. This checkpoint is not in the already uploaded build 103.
