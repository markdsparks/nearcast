# Nearcast iOS

This is the native iOS platform layer for Nearcast. It intentionally starts thin:

- `Debug` loads a local Nearcast web server by default.
- `Release` always loads `https://getnearcast.app`.
- A native debug sheet lets you switch local/production, change the local URL, and reload the web app.
- Local HTTP allowances are Debug-only; Release uses the production HTTPS app surface.
- A JavaScript bridge is installed as `window.NearcastNative.postMessage(payload)` for future native surfaces.

The current goal is to preserve the fast web iteration loop while giving us a clean place for iOS-only capabilities: widgets, APNs, Live Activities, App Intents, and later local ML experiments.

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
