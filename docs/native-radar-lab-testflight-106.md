# Native Radar Lab — build 106

An **opt-in engineering checkpoint**, not the finished native map. The regular Map remains unchanged. Build 105's native Places/Settings ownership is preserved; no new permission, notification target, family-data export, weather provider or server endpoint is introduced.

## Where to test

**Menu → Native weather preview → Settings → Experimental → Open Radar Lab.** Native storage activation is not required. Close the lab with its top-right X to return to Settings.

The lab deliberately uses a fixed public location in **Maryville, Illinois**, with a coordinate grid instead of a street basemap. It does not follow your current city. This lets us test the native renderer without prematurely replacing the everyday map or activating production basemap credentials.

## This testing round

On both iPhone 17 Pro and Pro Max / iOS 27:

1. **Move around:** pan, pinch to zoom, then tap the target icon. The view should recenter on Maryville. Check that the map responds smoothly and the controls stay readable.
2. **Radar:** drag the timeline, then play/pause. The selected time should match the available source frame. Playback intentionally stops at gaps and at the end; it must not jump into a different kind of forecast.
3. **Compare modes:** select **6h rain total**. These are six-hour accumulated amounts, **not a moving-storm forecast**. Select **Fixtures** and try 1/2/3: the asymmetric images are synthetic, visibly labeled “not weather,” with corner markers to help spot reversed or misaligned imagery. Check for flickering or a map-position jump when switching.
4. **Leave and return:** close while playing, reopen, and background/resume the app. Also try larger text and temporary airplane mode. Missing imagery must never be described as clear weather. The ordinary Map should still work exactly as before.

The info button provides source meaning, timestamps, an independent lab-only 12/24-hour clock, diagnostic text, and full SDK notices. You do not need to interpret diagnostics to report a problem—send a screenshot and the action that caused it.

## Boundaries

- Exact source-time selection and numerical fixtures have automated coverage. Compilation or a process launch does not prove visual correctness, touch behavior, memory use or physical-device performance.
- Mac visual QA was unavailable because the Mac was locked. This early TestFlight round is explicitly requested so device testing can begin before that QA. No visual acceptance is claimed.
- Native street maps, current-place routing, live enhanced numeric rendering, radar/forecast continuity, global fallback, satellite/aerial and the rest of the production map's layers are still migration work. Keep using normal Map for everyday weather decisions.
- Widgets, Apple Watch and existing notification behavior are unchanged. Native radar is not promoted to a default destination.

## Release evidence

- Complete portable and native shared-model regression suites passed, including the 122-assertion radar timeline and matched synthetic numerical fixtures.
- Release simulator build and signed iPhone/widget/Watch archive compiled successfully. Build 106 installed and its app process launched on isolated iPhone 17 Pro and Pro Max / iOS 27 simulators. These are not visual or interaction checks.
- Archive validation caught incorrect simulator platform metadata in the official, checksum-verified MapLibre 6.31.0 device framework. Its Mach-O binary targets iOS correctly. The release preparation step corrects only the known platform fields in the **archived copy**, then re-signs the framework and containing app. SDK downloads/caches and executable code are not patched; signatures, entitlements, executable text, privacy and bundled notices are checked separately. Unknown SDK versions/platforms fail closed.
- The archive gate requires valid device platform metadata and Mach-O slices, embedded signature, runtime linkage, privacy manifest and all lab resources, and confirms that widgets/Watch do not embed or link the SDK.

### Upload — September 18, 2026

- Implementation `f8921d0` pushed to `main`. Web companion remains 3.0.412; no web deployment was required.
- The full release pipeline reran portable/native checks, produced the signed archive, applied the guarded packaging correction and passed the expanded archive validator. Original SDK/app copies and signing comparison evidence are retained outside the archive for recovery/audit.
- Apple accepted **0.1.0 (106)** at **21:02 CDT**; Xcode reported `EXPORT SUCCEEDED` and “Uploaded package is processing.” Apple processing and family acceptance were not yet verified.
- Non-blocking upload warning: the upstream MapLibre archive lacks the matching framework dSYM (`668B439A-23D0-3BE7-B1DB-42CC0634389E`). Upload succeeded, but SDK-internal crash symbolication will be limited until matching upstream symbols are obtained. No replacement symbols were fabricated; address this before native radar becomes the default.
- Standalone diagnostic build also passed after sharing its view with the main app. Visual/gesture acceptance remains pending, as described above.
