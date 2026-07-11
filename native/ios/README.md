# Nearcast iOS

This is the native iOS platform layer for Nearcast. It intentionally starts thin:

- `Debug` loads a local Nearcast web server by default.
- `Release` always loads `https://getnearcast.app`.
- A native debug sheet lets you switch local/production, change the local URL, and reload the web app.
- Local HTTP allowances are Debug-only; Release uses the production HTTPS app surface.
- A JavaScript bridge is installed as `window.NearcastNative.postMessage(payload)` for future native surfaces.

The current goal is to preserve the fast web iteration loop while giving us a clean place for iOS-only capabilities: widgets, APNs, Live Activities, App Intents, and later local ML experiments.

## Working model

Nearcast should not wait on TestFlight for every product iteration. The native app is a stable iOS shell around the live Nearcast web app:

- Web/product changes: deploy the web app, then refresh or relaunch the installed native app.
- Native shell changes: run locally from Xcode first, then archive to TestFlight when the shell behavior changes.
- Platform features: add native modules behind the bridge, but keep the first user-facing surface in the web app until the native capability is clearly better.

This keeps the daily loop fast while still moving toward a real iOS app.

## Recommended loops

Use three loops, from fastest to slowest.

1. Web loop

   Change `app.js`, `map.js`, `styles.css`, or other web files. Test in Safari/PWA and in the Debug native shell pointed at the local server. When good, deploy the web app. Existing TestFlight installs should see the change because Release loads `https://getnearcast.app`.

2. Native debug loop

   Use this when changing Swift, the bridge, native permissions, or iOS-only UI. Run the `Nearcast` scheme from Xcode on Simulator or a plugged-in iPhone. Debug builds can switch between local and production from the native debug sheet.

3. TestFlight loop

   Use this for native shell milestones: app identity/signing changes, notification/APNs work, widgets, Live Activities, App Intents, or anything that needs real installed-app behavior. TestFlight should validate the shell, not gate every web UI tweak.

## Apple Watch development

The repository includes a standalone `NearcastWatch` target plus an automated
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

The Watch app includes three WidgetKit complication choices:

- `Nearcast Next`: adapts to the most important upcoming weather signal.
- `Plan Check`: keeps the currently watched plan and verdict visible.
- `Rain Next`: shows rain timing, peak chance, and a compact four-hour trend.

They support the Ultra-friendly circular, corner, rectangular, and inline
families where appropriate. The complication extension refreshes directly from
Open-Meteo when the Watch has network access, falls back to the latest snapshot
sent by the paired iPhone, and explicitly marks data older than two hours.

## Fast local loop

From the repo root:

```sh
python3 -m http.server 4177
```

Then open:

```sh
open native/ios/Nearcast.xcodeproj
```

Run the `Nearcast` scheme on an iOS simulator. The simulator can load:

```text
http://127.0.0.1:4177
```

For a real iPhone, use the Mac's LAN IP instead:

```text
http://192.168.x.x:4177
```

Set that URL from the native debug sheet in the app.

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
