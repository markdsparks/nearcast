# Nearcast iOS

## Native Dev lane — current behavior

**Nearcast Dev** is now a side-by-side, native-only Debug lane. A normal Dev
launch starts the native root and must not create `NearcastWebModel` or a
`WKWebView`. It exercises the native weather repository, Places, Map, Ask,
Plans, widgets, and Watch companion independently from TestFlight.

`-nearcast-web` is a deliberate, process-only Debug recovery/migration escape
for investigating the retained compatibility host. It does not change a saved
preference and is not a normal product-testing path. Local web-server settings
apply only while that explicit compatibility escape is running.

Release/TestFlight deliberately remains on the established compatibility host
until all supported routes pass their native cutover gates. The Dev behavior
does not silently promote a new runtime to Release.

## Direction update — September 18, 2026

**September 20 update:** native is a fresh start, with no legacy import needed.
Existing native data stays intact. The normal Dev setup asks for the first
place and then uses native Places, Plans, Ask, and publication. See the
[cutover checkpoint](../../docs/native-cutover-checkpoint.md). The migration
paragraphs below document the earlier rollout; importing user data is no
longer an acceptance gate.

Nearcast is moving to a fully native main iPhone experience through the
[phased native migration plan](../../docs/native-migration-plan.md). Preserve
the forecast services, user records, notification selections, and native
Watch/widget/AI investments while each remaining domain is migrated with an
explicit owner and recovery path. No phase is complete merely because the
native Dev lane can display a screen.

## Retained compatibility host — Release and deliberate Debug escape

The older browser-backed host remains an operational compatibility path, not
the default Nearcast Dev experience:

- **Nearcast Dev / Debug** starts native-only. Use `-nearcast-web` only for a
  focused migration or recovery check.
- **Release/TestFlight** continues to load `https://getnearcast.app` until a
  separate promotion explicitly changes that behavior.
- Local HTTP allowances and the JavaScript bridge are retained for the
  explicit Debug compatibility escape; they are not dependencies of the
  native Dev journey.

## Working model during cutover

Nearcast should not wait on TestFlight for every product iteration, but the
two clients now have different jobs:

- **Website changes:** deploy and test the website as its own client. They do
  not prove the native Dev experience.
- **Native product changes:** run the native-only **Nearcast Dev** lane from
  Xcode/direct device first, then archive when a native release gate is met.
- **Compatibility checks:** invoke `-nearcast-web` intentionally and only to
  test migration/recovery behavior that has not yet been retired.

This keeps the website independently useful while making the native path the
place where native cutover work is proven.

## Private AI runtime

The native-only app now calls its native conversation/actions directly and
uses a deterministic forecast reader when the on-device model is unavailable.
Native dictation uses `NativeAskSpeechController`, stays on-device, and fills
an editable draft; it never auto-submits. The JavaScript bridge described
below belongs to the retained compatibility host, not normal native Ask.

Nearcast uses one JavaScript contract for private summaries and Plan Check
intent parsing, with Operon validating every model result before the product
uses it.

- On an eligible Apple Intelligence device running iOS 26 or later, the native
  bridge uses Apple's on-device system language model. No Nearcast model
  download is required.
- Other compatible browsers can opt in to a local Qwen3 0.6B WebLLM model.
- If neither runtime is available, deterministic forecast and planner features
  continue to work without AI.

The bridge exposes `NearcastNative.ai.availability()` and
`NearcastNative.ai.generate(request)`. Native requests are accepted only from
the trusted main Nearcast page; requests from subframes or arbitrary origins
are rejected. Apple's model availability must be tested on an eligible
physical device because it is unavailable in Simulator.

The bridge also exposes `NearcastNative.speech.start()`, `.stop()`, and
`.cancel()` for the Nearcast AI composer. Recognition is required to run on
device. Partial transcripts and throttled microphone levels arrive as
`nearcast-native-speech` events, so the web surface can show editable live
dictation and an audio-reactive waveform without receiving or storing audio.

## Recommended loops

Use three loops, from fastest to slowest.

1. Website loop

   Change `app.js`, `map.js`, `styles.css`, or other web files and test them
   in Safari/PWA. Release/TestFlight continues to load
   `https://getnearcast.app` until its explicit native promotion.

2. Native debug loop

   Use this for Swift, native permissions, native UI, widgets, Watch, Map,
   Ask, Plans, and cutover work. Run the **Nearcast Dev** scheme on Simulator
   or a connected iPhone; the ordinary session is native-only. Use
   `-nearcast-web` only when a specific compatibility test requires it.

3. TestFlight loop

   Use this for release milestones and installed-app behavior. TestFlight
   remains a separate compatibility lane until it receives an explicit native
   promotion; it does not gate every website tweak.

### Direct-device Nearcast Dev loop

For fast native testing without replacing TestFlight, use the isolated
**Nearcast Dev** build. It installs beside production with separate iPhone,
Widget, Watch, App Group, and deep-link identities. The one-time Apple setup,
map credential, and repeatable phone/Watch commands are in
[DEV_LANE_SETUP.md](DEV_LANE_SETUP.md).

## Apple Watch development

The repository includes a standalone `Nearcast Dev Watch` development scheme plus an automated
doctor/build/install/launch workflow. Start with:

```sh
scripts/nearcast-watch.sh doctor
```

Then run either:

```sh
scripts/nearcast-watch.sh simulator
scripts/nearcast-watch.sh device
```

The complete one-time Mac, iPhone, and Watch prerequisites are in
[`WATCH_SETUP.md`](WATCH_SETUP.md). Apple Account sign-in, device trust,
Developer Mode, and the first provisioning confirmation remain interactive
Apple security steps; the repeatable development loop is automated.

### Watch complications

The Watch app includes four WidgetKit choices with distinct jobs:

- `Nearcast Next`: the most meaningful ambient change as a gauge, symbol, or
  short shape trail.
- `Plan Check`: a large `GO`, `WATCH`, or `CHANGE` mark with a compact risk cue.
- `Rain Next`: a closed probability gauge or segmented rain bars with timing.
- `Nearcast Brief`: an adaptive visual instrument for the Smart Stack.

The three watch-face complications support circular, corner, rectangular, and
inline families. Ultra corners use curved labels and distinct rain/wind gauges;
weather trails use bars for rain, lines for wind and temperature, and symbols
for steady conditions. Plan Check supports the circular family, and every
surface deep-links to its matching `Brief`,
`Hours`, or `Plan` page in the Watch app. The app and complication extension
refresh weather directly from Open-Meteo when the Watch has network access.
Weather and plan freshness are tracked independently, forecast timelines advance
against absolute hourly timestamps, and stale or unavailable data is shown
explicitly instead of using believable fallback weather.

Run the backward-compatibility and freshness contract before Watch releases:

```sh
scripts/test-nearcast-watch-snapshot.sh
```

## Compatibility-only local web loop

From the repo root:

```sh
python3 -m http.server 4177
```

Then open:

```sh
open native/ios/Nearcast.xcodeproj
```

Run the `Nearcast Dev` scheme with the `-nearcast-web` launch argument only
when testing the retained compatibility host. The native-only Dev default does
not load this server. In that explicit compatibility session, the simulator
can load:

```text
http://127.0.0.1:4177
```

For a real iPhone, use the Mac's LAN IP instead:

```text
http://192.168.x.x:4177
```

Set that URL from native diagnostics in the explicit compatibility session.

## Production/TestFlight loop

Release builds always load:

```text
https://getnearcast.app
```

So the intended workflow is:

1. Ship web changes normally.
2. Open the TestFlight app and pull-to-refresh/relaunch.
3. Create a new TestFlight build only when the Swift shell or native capabilities change.

### When to make a TestFlight build

Do not use TestFlight as the normal product iteration loop. Release builds load
the production web app, so most UI/copy/map changes should ship through the web
deployment path and then be tested by relaunching the installed app.

Create a TestFlight build only when the change touches the native shell:

- Swift app wrapper behavior
- widgets or widget timeline data
- Live Activities
- APNs/native notification plumbing
- App Groups/shared native state
- app icons, entitlements, bundle IDs, signing, or Info.plist changes

### Golden path: local archive, manual signed upload

This is the preferred command-line path. It avoids the Xcode Cloud detour and
avoids the automatic export profile mismatch we hit during build `46`.

Prerequisites:

- `AppStoreConnect/AuthKey_8LM389Z6NR.p8` exists locally. This directory is
  ignored by git.
- The App Store Connect API key is still active:
  - Key ID: `8LM389Z6NR`
  - Issuer ID: `00459337-a0be-4634-9c5c-96ea253447e9`
- The local Mac has the Apple Distribution certificate installed.
- The app and widget distribution profiles are installed:
  - `Nearcast App Distribution`
  - `Nearcast Widget Distribution`
  - `Nearcast Watch Distribution`
  - `Nearcast Watch Complications Distribution V2`

For the normal release, use the automated archive, validation, and upload
command from the repository root after setting the next build number across all
targets:

```sh
scripts/nearcast-testflight.sh
```

The script refuses to continue if app, widget, and Watch build numbers differ,
if the API key is missing, or if the archive omits the Watch app or its icon
catalog. The explicit commands below remain useful for troubleshooting.

Before archiving, choose the next build number and increment every
`CURRENT_PROJECT_VERSION` value in:

```text
native/ios/Nearcast.xcodeproj/project.pbxproj
```

Keep the app, widget, and Watch targets on the same build number. App Store
Connect requires every upload for the same marketing version to have a higher
build number than the previous upload.

Verify the project is on one build number before archiving:

```sh
rg -n "CURRENT_PROJECT_VERSION = " native/ios/Nearcast.xcodeproj/project.pbxproj
```

Archive from the repo root:

```sh
BUILD=47

xcodebuild \
  -project native/ios/Nearcast.xcodeproj \
  -scheme Nearcast \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "native/ios/build/Nearcast-${BUILD}.xcarchive" \
  archive \
  -allowProvisioningUpdates
```

Before exporting or uploading, verify that the archive contains all three
products and that their build numbers match:

```sh
scripts/validate-nearcast-archive.sh "native/ios/build/Nearcast-${BUILD}.xcarchive"
```

This check is required for TestFlight builds. In particular, it prevents an
iPhone-only upload from silently omitting the Apple Watch app.

Upload the archive using the manual TestFlight export options and the API key:

```sh
BUILD=47

xcodebuild \
  -exportArchive \
  -archivePath "native/ios/build/Nearcast-${BUILD}.xcarchive" \
  -exportPath "native/ios/build/upload-testflight-${BUILD}" \
  -exportOptionsPlist native/ios/ExportOptions-TestFlightManual.plist \
  -allowProvisioningUpdates \
  -authenticationKeyPath /Users/markdsparks/Projects/weather-app/AppStoreConnect/AuthKey_8LM389Z6NR.p8 \
  -authenticationKeyID 8LM389Z6NR \
  -authenticationKeyIssuerID 00459337-a0be-4634-9c5c-96ea253447e9
```

The upload is done when the command prints:

```text
Uploaded Nearcast
** EXPORT SUCCEEDED **
```

After a successful upload:

1. Commit the build-number bump.
2. Push `main`.
3. Wait a few minutes for App Store Connect processing.
4. Open TestFlight and pull to refresh.

### Xcode Organizer fallback

Use local Xcode archives for signed TestFlight builds if the command-line upload
is unavailable:

1. Open `native/ios/Nearcast.xcodeproj`.
2. Select the `Nearcast` scheme.
3. Select `Any iOS Device (arm64)` or a plugged-in iPhone as the destination.
4. Confirm the build number is higher than the latest uploaded TestFlight build.
5. Use `Product > Archive`.
6. In Organizer, choose `Distribute App`, then App Store Connect/TestFlight.

Before archiving, make sure the app and widget targets use the correct Apple developer team and bundle identifiers for the App Store Connect app record.

The current native build number is managed in `native/ios/Nearcast.xcodeproj/project.pbxproj` as `CURRENT_PROJECT_VERSION`. Keep the app target and widget target on the same value. If App Store Connect rejects an upload with a duplicate build number, increment all `CURRENT_PROJECT_VERSION` entries and archive again.

### Avoid these slow paths

- Do not use Xcode Cloud for normal Nearcast builds. It adds queue time, consumes
  monthly build minutes, and duplicates what local archive upload already does.
- Do not use `native/ios/ExportOptions-TestFlightUpload.plist` for the normal
  CLI path. It uses automatic signing and can fail when Apple's generated
  profiles do not match the installed distribution certificate.
- Do not debug `altool` first. If `xcodebuild -exportArchive` with
  `ExportOptions-TestFlightManual.plist` works, that is the cleaner upload path.

### Troubleshooting

If the archive succeeds but upload fails with:

```text
Provisioning profile ... doesn't include signing certificate ...
```

then the upload is using the automatic signing export plist. Retry with:

```text
native/ios/ExportOptions-TestFlightManual.plist
```

If App Store Connect rejects a duplicate build number, increment all
`CURRENT_PROJECT_VERSION` entries and archive again.

If the upload command says the API key path is invalid, use the absolute path to
the `.p8` file. Relative paths can fail depending on how Xcode invokes the
transporter.

If the command succeeds but the build is not visible in TestFlight yet, wait for
App Store Connect processing. The upload is accepted before TestFlight finishes
processing the build.

### Local archive sanity check

To verify signing/buildability without uploading:

```sh
xcodebuild \
  -project native/ios/Nearcast.xcodeproj \
  -scheme Nearcast \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath native/ios/build/Nearcast.xcarchive \
  archive \
  -allowProvisioningUpdates
```

If this fails with local account or signing errors, fix signing in Xcode before
trying to upload.

## Build verification

```sh
xcodebuild \
  -project native/ios/Nearcast.xcodeproj \
  -scheme Nearcast \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  build
```

## Product stance

Do not port everything to Swift immediately. The web app remains the product lab. Native owns the platform surfaces that the web cannot do well:

- widget timelines and App Group state
- native notification permission and APNs routing
- Live Activities for active plan/storm windows
- App Intents and system search/shortcut hooks
- MLX/Core ML experiments behind feature flags
