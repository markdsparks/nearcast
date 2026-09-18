# Places and settings migration — Phase 2A rehearsal

September 18, 2026. **Engineering checkpoint complete; ownership has not moved.**

The family reports that the native preview is working overall and has authorized continuing the migration. This is useful functional feedback, not a substitute for the physical-device, accessibility, performance, or Watch acceptance gates in the [migration plan](native-migration-plan.md).

## What this checkpoint does

When a compatible page opens the native preview, it can send a separate, allowlisted export of places and preferences. The native app validates that export, saves a protected local rehearsal copy, and reads it back. Weather still uses the existing temporary preview context; no screen or publisher reads the rehearsal as live state.

- The existing app remains the sole owner of places and settings.
- There are no editable native Places/Settings screens or compatibility write adapter yet.
- No browser storage is changed or cleared, and no plan, notification selection, channel, widget, Watch, or Live Activity is migrated or published by this feature.
- No permission, endpoint, data provider, account, or sync service is added.
- An invalid or unavailable export does not block opening the weather preview.

The optional bridge capability is `preview.migrationVersion: 1`. Old hosts do not receive migration data. Old pages may still call `preview.open(context)` without a second argument. The existing trusted-main-frame and active-app gates remain in force. Preview message diagnostics record only the event type, not the export.

## Export and persistence contract

`native-places-migration.js` reads only these seven browser keys: `weather-places`, `weather-last-place`, `weather-unit`, `weather-theme`, `nearcast-time-format`, `nearcast-reactive-sky-v1`, and `nearcast-reactive-sky-motion-v1`. It requires completed inventory hydration and checks consistency with the loaded app state. A malformed record fails the whole export; failure is never treated as an empty inventory.

The version-1 export contains `owner: legacy`, `hydration: ready`, a UTC capture timestamp, selected and last places, saved places in order, and raw preferences. Auto clock/theme remain Auto. Place aliases, time zones, coordinates, stable IDs, and explicit current-location-following flags are preserved. Numeric legacy IDs are represented as decimal strings with numeric-origin metadata so a later compatibility adapter can preserve their original type. Different IDs at the same coordinates remain distinct. Missing optional following flags remain missing rather than being guessed from an ID prefix.

The native actor stores the copy under Application Support/Nearcast/NativePlacesRehearsal, separately from forecast caches and App Groups. Development-mode fixtures use a separate DevelopmentOnly directory. Files use restrictive permissions, iOS data protection, and backup exclusion; diagnostics expose only aggregate counts, revision, and legacy ownership.

The durable envelope records schema/minimum reader/minimum writer versions, ownership, source and receipt digests, revision, and deletion receipts. Writes use validated staging, atomic replacement, a prior-generation backup, and an advisory lock across store instances. Identical exports are idempotent; their capture-time high-water mark still advances. Older exports are rejected. Removed saved IDs receive deletion receipts, and explicit re-addition supersedes that ID's receipt. Corrupt current data may recover from a validated prior generation; unknown future versions or owners fail closed instead of being overwritten. No restore-to-live-state operation exists.

## Verification performed

- Full `bash scripts/nearcast-ci.sh all` regression suite passed, including the new exporter, bridge, and native persistence tests.
- Production JavaScript export → Swift validation → durable save → read-back passed with synthetic fixtures.
- Cases include numeric IDs, Unicode aliases, raw Auto preferences, missing optional flags, same-coordinate distinct places, malformed/oversized data, unhydrated state, repeat import, older capture rejection, deletion/re-addition, cancellation, interrupted writes, corrupt-file recovery, future-version barriers, and independent store instances.
- Bridge checks cover compatible/old hosts and pages, failed exports, unchanged preview context, and no new browser writes or publication calls. Trust/redaction checks include source assertions; these are not claimed as runtime adversarial-origin testing.
- Debug and Release iOS Simulator builds passed for the Nearcast scheme and its dependent targets.
- An isolated iPhone 17 Pro / iOS 27 simulator exercised the real WK bridge and native store using the loopback-only fixture page. First copy: revision 1, two saved places, no deletion receipts. Repeated copy: revision 1, two places. Removal of the synthetic spare: revision 2, one place, one deletion receipt. The weather preview opened normally. The same receipt was verified after app termination, replacement with the final Debug build, and relaunch.
- No physical-device performance, VoiceOver, Watch delivery, signed archive, or family ownership-handover result is claimed for this checkpoint.

To repeat the local end-to-end check, serve the repository on loopback and open `scripts/fixtures/native-places-migration-rehearsal.html` through the Debug local runtime. The fixture uses in-memory public-city records, not browser records. Use its two buttons, then Native Debug → Places migration rehearsal → Check saved rehearsal. This is a development tool, not a family-facing screen.

## Required next checkpoint — Phase 2B

1. Build native saved-place search/add/rename/reorder/delete, current-location selection, and settings against explicit native actions.
2. Implement one authoritative owner and a versioned compatibility read/write adapter before enabling those mutations. The current rehearsal is not that adapter.
3. Resolve legacy writer gaps: normalization drops saved time-zone metadata; UI and Ask settings have separate paths; rename can leave last-place metadata behind; missing current-location flags need an explicit interpretation. Preserve original ID types and never use coordinate deduplication to merge user records.
4. Route every legacy place/settings mutation through the adapter after handover. Reject incompatible writers. Preserve plans and explicit watch selections under their existing owner; incomplete hydration must never imply opt-out or an empty target set.
5. Verify upgrade, interrupted handover, edits, deletions, fallback, relaunch, and publication coordination with selected notification targets. Keep widget/Watch units, clock, and place coherent without adding another publisher. Audit the existing shared-snapshot and place-write boundaries before relying on them for ownership transfer.
6. Ship a separately numbered TestFlight checkpoint with family add/edit/delete and settings tasks. Native remains opt-in until the relevant acceptance gates pass.

## Release boundary

Web assets are prepared as **3.0.411**, but this checkpoint does not deploy them. Native target build numbers remain **103**; this source work is **not** in the already-uploaded build 103. No new TestFlight was uploaded. Assign a new shared build number before the next archive/upload. Pushing this engineering checkpoint does not activate the rehearsal in an already-installed host or transfer any ownership.
