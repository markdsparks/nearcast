# Nearcast Dev — direct iPhone and Watch lane

`Nearcast Dev` is a side-by-side, native-only development build for fast native
testing. A normal Dev launch starts the native root without constructing the
retained WebKit host. It is deliberately separate from the
production/TestFlight install: it has its own bundle IDs, App Group, URL
scheme, and on-device storage. Installing or removing it does not replace the
regular Nearcast app or its widgets.

The Dev lane is for the family’s iPhone 17 Pro Max and Apple Watch Ultra 2.
It is not a TestFlight build and it does not upload anything to App Store
Connect.

## What is isolated

| Surface | Production | Nearcast Dev |
| --- | --- | --- |
| iPhone app | `app.nearcast.ios` | `app.nearcast.ios.dev` |
| Widget | `app.nearcast.ios.widget` | `app.nearcast.ios.dev.widget` |
| Watch app | `app.nearcast.ios.watch` | `app.nearcast.ios.dev.watch` |
| Watch complications | `app.nearcast.ios.watch.complications` | `app.nearcast.ios.dev.watch.complications` |
| Shared App Group | `group.app.nearcast.ios` | `group.app.nearcast.ios.dev` |
| Deep-link scheme | `nearcast` | `nearcast-dev` |

The Dev build uses the production Nearcast weather service—not a loaded
production web app—so it remains useful away from the Mac. `-nearcast-web` is
a deliberate, process-only Debug escape for a focused migration/recovery
check. Only that explicit compatibility session may use native diagnostics to
point the retained web host at a local Mac server; ordinary Dev testing stays
native-only.

Remote plan notifications and server-driven Live Activity updates stay off in
Dev for now. That prevents duplicate alerts and keeps direct experiments from
registering against the production delivery channel. Local native UI and local
Live Activity behavior can still be tested.

## One-time Apple Developer setup

Do this in the Apple Developer portal while signed into Nearcast’s team
(`22PRZ6YK2P`). Xcode automatic signing can create the basic IDs, but the
App Group association is clearest and most reliable when confirmed here.

1. Register these explicit App IDs if they do not appear automatically:
   - `app.nearcast.ios.dev`
   - `app.nearcast.ios.dev.widget`
   - `app.nearcast.ios.dev.watch`
   - `app.nearcast.ios.dev.watch.complications`
2. Create the App Group `group.app.nearcast.ios.dev`.
3. Attach that App Group to all four Dev App IDs.
4. Enable Push Notifications for the Dev iPhone App ID. The Dev lane does not
   send server notifications yet, but the capability must match the app’s
   signed entitlement.
5. In Xcode, open `native/ios/Nearcast.xcodeproj`, select each target, and
   confirm **Automatically manage signing** is on for team `22PRZ6YK2P`.
   Xcode may ask to register the connected devices or create development
   provisioning profiles—approve those normal Apple prompts.

Do not change the production App IDs or production App Group while doing this.

## One-time device setup

1. Connect the iPhone 17 Pro Max to the Mac by cable, unlock it, and choose
   **Trust This Computer**.
2. In Xcode, open **Window > Devices and Simulators** and let the iPhone
   finish preparing. Keep the paired Apple Watch Ultra 2 unlocked, nearby,
   connected over Bluetooth/Wi-Fi, and preferably charging.
3. Turn on Developer Mode on both devices and restart them when iOS/watchOS
   asks. Apple documents the device flow in
   [Enabling Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/).
4. Make sure Xcode is signed into the Nearcast team and has an Apple
   Development signing certificate.

After the first cable install, enable **Connect via network** for the iPhone
in Device Hub. That makes repeat direct-device builds much faster at home.

## Run the Dev lane

From the repository root, start with the non-mutating health check:

```sh
bash scripts/nearcast-dev.sh doctor
```

Then build, install, and launch both side-by-side apps:

```sh
bash scripts/nearcast-dev.sh all
```

You can run either surface independently:

```sh
bash scripts/nearcast-dev.sh phone
bash scripts/nearcast-dev.sh watch
```

For a first Watch install, use `all` (or install the iPhone app first): Apple
Watch needs the matching **Nearcast Dev** phone companion already present.

The defaults target the current family test pair:

```text
iPhone 17 Pro Max: 00008150-001E705802F0401C
Apple Watch Ultra 2: 00008310-000378683A7BA01E
```

Pass different identifiers after the command if the test hardware changes.
The script defaults to `Nearcast Dev Performance` and the `DevPerformance`
configuration: optimized Swift/C weather calculations with the exact Debug
bundle IDs, entitlements, native-only flag, App Group, service endpoints, and
disabled remote delivery. It does not attach the debugger on launch; symbols
remain available for Instruments. `Nearcast Dev` / `Debug` remains available
for source-level stepping (`NEARCAST_DEV_CONFIGURATION=Debug`).

Both modes use automatic signing. The script never cleans data, removes an app, touches the
TestFlight installation, or uploads a build.

## Map credential for Dev

The native map must receive an explicitly approved Dev credential rather than
reuse the production bundle identity. Add this worker secret before testing the
Dev map:

```text
CARTO_BASEMAP_IOS_DEV_KEY
```

Its CARTO restrictions must permit `app.nearcast.ios.dev`. If the current
native CARTO key can be allowlisted for the Dev bundle ID, it may hold the same
value only after that vendor-side restriction is updated. Otherwise create a
dedicated least-privilege Dev key. Add the value as the GitHub Actions secret
with the same name, then run **Deploy Cloudflare app** (or set it directly in
the Worker dashboard). The map configuration endpoint accepts only the fixed
`ios-dev` client; it does not accept arbitrary bundle IDs.

## First-test checklist

- Confirm **Nearcast Dev** appears beside the TestFlight Nearcast app.
- Confirm the Dev widget and Watch app show Dev-owned data rather than the
  production app’s saved state.
- Open a native map, pan/zoom, and confirm the Dev credential works.
- Exercise direct native screens, Ask, a local Live Activity, the widget, and
  the Watch app.
- Keep TestFlight installed and verify it still opens its original location,
  plans, widgets, Watch surface, and notification settings unchanged.

For the broader Watch preparation details, see
[WATCH_SETUP.md](WATCH_SETUP.md). Apple’s general direct-device build and
signing flow is documented in
[Building and running an app](https://developer.apple.com/documentation/xcode/building-and-running-an-app?changes=_9&language=objc).
