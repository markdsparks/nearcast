# Native Places ownership — build 105

Phase 2B2 moves saved places and the migrated preferences into native storage. The native weather preview and this ownership handover are still explicit opt-ins. Radar, Ask, plans and notification management retain their existing screens; this is not the full native migration.

## Where to test

Open **Menu → Native weather preview → Settings → Use native storage** and confirm the handover once. Existing saved places, their order and nicknames, selected/last place, units, clock, appearance and sky preferences are imported and read back before activation. There is no automatic rollback to the old browser records.

After activation, native Places and Settings no longer need a loaded web page. Search and fresh weather still need connectivity; current location still requires an explicit action and the existing location permission. Native and existing screens use the same canonical records. Sky settings save intent without automatically requesting motion access.

Keep build **105 or a newer compatible build** after activation (owner schema/reader version 1). Returning to the existing weather screen is supported; installing build 104 is not a rollback of native-owned records.

## Family acceptance round

1. Select a saved place, change units and clock, rename or reorder a temporary saved city. Leave native preview: the existing screens should show the same place and preferences.
2. Force-close and reopen. All confirmed edits should remain. Test both iPhone 17 Pro and Pro Max on iOS 27, including larger text.
3. With connectivity unavailable, reopen native weather from the loading/error screen and edit a nickname or preference. A cached forecast may be shown with its actual freshness; no old place’s weather should be relabeled as the new place. Restore connectivity and verify the existing screens catch up.
4. Search a fully qualified city, bookmark it, select it, and remove the temporary saved city. Plans remain intact. Re-adding the city must not re-enable its former notification selection.
5. Check existing widgets and Apple Watch Ultra 2 after selecting another place and after changing units. An unavailable/newly refreshing forecast is preferable to an old-place or wrong-unit reading.
6. Check existing plan and place notifications. No new target or permission prompt should appear merely from activation, opening Places, or reordering saved places.

Deleting a watched saved place offline queues notification cleanup. Existing background delivery cannot be updated until the notification service can sync again. The pending cleanup is retained even if that city is re-added before reconnecting.

## Safety boundary

- One atomic, protected native owner generation; exact expected-source checks reject stale edits. Interrupted/corrupt/future-version storage does not silently import old browser records or resurrect a backup.
- The exact allowlisted legacy source is protected and read back before activation, retained separately from rotating backups until migration acceptance. It is recovery evidence, not an automatic rollback source; browser records are not erased.
- Numeric IDs, exact coordinates, time zones, aliases, optional following intent and Auto preferences are preserved. New saves keep the eight-place limit; migration does not discard a larger existing inventory.
- The document-start bridge projects only the seven owned browser keys. Existing user actions route to native commands, while old/incompatible pages cannot overwrite owned records. Exact-origin and per-document checks protect private state and delayed replies.
- Ordered deletion events are consumed into the existing watch preference with a durable watermark before acknowledgment. Existing implicit notification choices are frozen at handover. A durable sync generation prevents edits during a network request from being dropped.
- Notification registration/unregistration waits for known plan/place inventory and native permission status. Synchronization itself never asks for notification permission.
- Native storage owns companion selection/preferences. Existing weather contributions must match that owner revision, exact place, units and clock. Watch publication ordering prevents old deliveries from undoing newer native choices.
- No account, calendar permission, new provider, new server endpoint or new analytics is introduced. Private owner messages and widget snapshots are redacted from bridge diagnostics.

## Engineering evidence

- Portable JavaScript and Swift shared-model suites passed during integration. Coverage includes strict receipt validation, empty inventories, cold startup, explicit cutover, stale/replayed commands, write interruptions, deletion/re-add/ACK, failed persistence, in-flight notification changes and old-host compatibility.
- Debug simulator build passed. On the isolated iPhone 17 Pro/iOS 27 simulator, the explicit handover succeeded with public-city fixtures. Native Celsius and exact saved-place selection were verified.
- With the loopback web server stopped, a cold restart retained the native-selected European city, Celsius and 24-hour time. Native Places loaded and a saved city was renamed without a web document.
- After another restart with the web server restored, the existing weather and Family places screens displayed the native location, units and offline rename. A subsequent place selection from the existing screen committed through native storage and showed the correct Celsius forecast.
- Physical permission prompts, Watch delivery, full VoiceOver and family acceptance remain device-testing gates, not simulator claims.

## Release evidence — September 18, 2026

- Implementation: `3e8febf1f58120331a3c631dc3fa9b5de8af8dcb`, pushed to `main`.
- Web companion **3.0.412** deployed successfully in [Cloudflare deployment 35403976044](https://github.com/markdsparks/nearcast/actions/runs/35403976044). Live HTML references the owner adapter; its SHA-256 matches the committed file (`f11a78353ada3f5b34c6fdd96b7204dd0ac22ef917707d78406335c972628d2f`).
- Final Release simulator build passed. On isolated iPhone 17 Pro Max / iOS 27, Release **105** loaded the deployed companion, explicitly activated native storage, displayed “Saved on this iPhone,” and saved a 24-hour clock choice. Native hourly labels and the existing Settings screen both reflected it.
- The Mac locked during an additional existing-control interaction; that extra check was not completed. The earlier Pro offline-edit/restart/return checks and Pro Max handover/clock checks above were completed before the lock.
- Release preflight passed the complete portable and native shared-model suites, including the final protected-source-export tests. The signed archive validator passed app, widget, Watch app, complication, matching build-number, deep-link and metadata checks.
- `Nearcast-105.xcarchive` exported and uploaded successfully at **18:03 CDT**. Apple reported that the uploaded package was processing. Upload success is not a claim of completed Apple processing or physical-device acceptance.

Native preview remains opt-in. Next migration surface: Phase 3 native radar. Physical family/Watch/accessibility acceptance remains open.
