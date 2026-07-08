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

Preferred path: use Xcode Cloud for signed TestFlight builds. It avoids local distribution certificate and App Store Connect account drift. See `docs/xcode-cloud.md`.

Manual local fallback from Xcode:

1. Open `native/ios/Nearcast.xcodeproj`.
2. Select the `Nearcast` scheme and a generic iOS device destination.
3. Use `Product > Archive`.
4. Distribute through App Store Connect/TestFlight.

Before archiving, make sure the app target uses the correct Apple developer team and bundle identifier for the App Store Connect app record.

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
