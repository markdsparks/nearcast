# Xcode Cloud for Nearcast

Nearcast should use Xcode Cloud for signed TestFlight builds and local Xcode for fast native iteration.

## Why

Local command-line export is brittle because it depends on this Mac having an App Store Connect account session and an Apple Distribution identity available to `xcodebuild`. Xcode Cloud moves archive, export, signing, and TestFlight delivery into Apple's environment with managed signing.

## Recommended workflow

Use three loops:

1. Web/product changes
   - Ship the web app normally.
   - Release native builds load `https://getnearcast.app`, so installed TestFlight users get the web change after refresh/relaunch.

2. Native debug changes
   - Run `native/ios/Nearcast.xcodeproj` locally from Xcode.
   - Use Debug to point the native shell at a local web server when needed.

3. Native release/TestFlight changes
   - Commit and push to `main`.
   - Run the Xcode Cloud workflow.
   - Distribute the archive to internal TestFlight.

## App Store Connect setup

Create one workflow for the Nearcast app:

- Repository: `markdsparks/nearcast`
- Branch: `main`
- Project: `native/ios/Nearcast.xcodeproj`
- Scheme: `Nearcast`
- Environment: latest stable Xcode unless a project change requires a pinned version
- Action: Archive
- Distribution: Internal TestFlight
- Signing: Automatic / managed signing

Start with manual workflow runs. Enable automatic runs later only if native changes become frequent enough to justify the compute.

## Trigger policy

Run Xcode Cloud when a commit changes any of:

- `native/ios/**`
- `ci_scripts/**`
- native-facing web bridge behavior in `app.js`
- service worker/version references needed for native release behavior

Do not run Xcode Cloud for ordinary CSS/layout/web-only iterations unless they need a fresh native shell.

## Build numbers

App Store Connect requires each uploaded build number to be higher than any previously uploaded build for the same app version.

Xcode Cloud can use its own next-build-number counter. If a cloud archive fails with:

```text
The bundle version must be higher than the previously uploaded version.
```

open the workflow in Xcode Cloud and set the next build number above the latest uploaded TestFlight build. For Nearcast, the API helper can show recent uploads:

```sh
node scripts/xcode-cloud.mjs builds \
  --key-id=8LM389Z6NR \
  --issuer-id=00459337-a0be-4634-9c5c-96ea253447e9 \
  --key-file=AppStoreConnect/AuthKey_8LM389Z6NR.p8
```

Nearcast avoids this by using a timestamp-style committed Xcode build number, because Xcode Cloud's App Store Connect preparation can validate the bundle version before repository scripts affect archive metadata.

Use a UTC timestamp-style build number such as:

```text
202607080507
```

This is intentionally larger than any normal local/TestFlight build number and should keep cloud uploads monotonic without hunting for Apple's hidden next-build-number field.

The helper script can still stamp this value in CI or during local testing:

```sh
NEARCAST_FORCE_CI_BUILD_NUMBER=1 \
NEARCAST_CI_BUILD_NUMBER=202607080507 \
ci_scripts/nearcast_stamp_build_number.sh
```

That command mutates `native/ios/Nearcast.xcodeproj/project.pbxproj`, so only run it locally when you intend to inspect, commit, or discard the generated build-number change.

## Pre-build scripts

Xcode Cloud reads scripts from the repository-level `ci_scripts` directory.

- `ci_post_clone.sh` prints build environment details and stamps a CI-only build number before archive preparation.
- `ci_pre_xcodebuild.sh` validates the app and widget plist files before the archive step.
- `nearcast_stamp_build_number.sh` owns the timestamp build-number workaround.

Keep these scripts intentionally boring. They should catch native packaging mistakes without depending on optional tools like Node or npm in Apple's build environment.

## Local fallback

Local archive should remain useful for compile verification:

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

If local export fails with `No Accounts` or `No signing certificate "iOS Distribution" found`, use Xcode Cloud rather than debugging local signing unless local export itself is required.

## Local API trigger

The App Store Connect API can trigger the Xcode Cloud workflow without relying on a local distribution certificate.

Keep the private key outside git. The repo ignores `AppStoreConnect/`, so this local path is safe for development:

```sh
AppStoreConnect/AuthKey_8LM389Z6NR.p8
```

List configured products and workflows:

```sh
node scripts/xcode-cloud.mjs list \
  --key-id=8LM389Z6NR \
  --issuer-id=00459337-a0be-4634-9c5c-96ea253447e9 \
  --key-file=AppStoreConnect/AuthKey_8LM389Z6NR.p8
```

Trigger the default workflow:

```sh
node scripts/xcode-cloud.mjs trigger \
  --workflow-name=Default \
  --key-id=8LM389Z6NR \
  --issuer-id=00459337-a0be-4634-9c5c-96ea253447e9 \
  --key-file=AppStoreConnect/AuthKey_8LM389Z6NR.p8
```

Poll a build run:

```sh
node scripts/xcode-cloud.mjs status \
  --build-id=<build-run-id> \
  --key-id=8LM389Z6NR \
  --issuer-id=00459337-a0be-4634-9c5c-96ea253447e9 \
  --key-file=AppStoreConnect/AuthKey_8LM389Z6NR.p8
```
