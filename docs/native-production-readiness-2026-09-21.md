# Native production readiness — September 21, 2026

Scope: read-only production readiness audit and local release checks. No push,
registration, production deployment, archive upload, or subscription deletion.

## Live evidence

The production `/api/watch/notifications/config` response at
2026-09-22T00:31:11Z reports APNs ready for `app.nearcast.ios`, R2 ready and
production evaluation enabled. It does **not** advertise `nativeOwnerScopes`.
The native client requires `nativeOwnerScopes: ["native-v1"]` before requesting
permission or registering. Therefore the current deployed backend cannot yet
enroll the new native Plans client, even though APNs configuration is ready.

The three most recent notification health workflow runs were successful. Latest:
https://github.com/markdsparks/nearcast/actions/runs/35666534027
This is operational health evidence, not proof of device receipt or native
registration compatibility. Latest successful app deployment inspected:
https://github.com/markdsparks/nearcast/actions/runs/35466364686
(commit `469b63fc1d51d7c00d9640896082afcdb3ccc957`).

## Release blockers

1. Release Info.plist does not enable `NearcastNativeOnlyExperience`. The
   current release gate deliberately enforces that old boundary.
2. `NativeLivingSkyFeature` returns false outside DEBUG. Promoting just the
   native root would still omit the reviewed immersive sky.
3. Local Worker changes implement native owner isolation and weekly/timezone
   behavior, but production does not yet advertise that capability. Deploy
   the reviewed backend changes before attempting native enrollment.
4. The migration is still a large dirty working tree with new untracked source,
   assets and tests. Produce a reviewed, identifiable release commit before
   using the normal deployment/archive pipelines; do not deploy the entire
   workspace ad hoc or silently omit new files.

## Validation

- Existing Release identity/delivery isolation gate passed (this validates the
  current configuration, not readiness of a promoted native Release).
- Native notification lifecycle, payload routing, owner-isolation and weekly
  evaluation tests passed.
- Full portable production suite passed.
- Full native-model suite passed, including native routing, notification
  lifecycle, Ask/Plans, companion publishing and Living Sky checks.

## Next implementation sequence

1. Explicitly promote native root and Living Sky for the production identity;
   update release assertions to require the intended configuration while
   preserving Dev bundle/App Group/APNs isolation.
2. Review and checkpoint the release source, then use the normal service
   deployment pipeline. Re-read config and operational health afterward.
3. Build/validate an actual Release archive, including phone, widget, Watch and
   complications, and distribute through TestFlight. Keep Dev installed.
4. Enroll one disposable future plan only after explicit user opt-in; verify a
   stored native receipt, then send one targeted canary to that exact device.
5. Verify locked-phone/Watch presentation and native plan tap routing. The
   existing canary defaults to Watching, so use a verified plan payload for
   the plan-routing check rather than treating a generic canary as proof.
6. Verify edit, opt-out/delete and receipt cleanup. Do not remove legacy
   subscriptions automatically. Complete stale/background acceptance before
   wider family rollout.

## Authorized promotion in progress

Release now explicitly enables the native-only root and Living Sky. The release
gate requires that promotion while retaining separate Dev identifiers and APNs
settings. Build number advanced to 134. Backend checkpoint `f409cd3` contains
only the reviewed notification Worker changes and their regression tests;
production deployment was dispatched from that checkpoint, not the dirty
workspace.

Backend deployment succeeded:
https://github.com/markdsparks/nearcast/actions/runs/35672734796
The live config at 2026-09-22T00:39:14Z now advertises `native-v1`, production
APNs and R2 ready. Post-deployment protected health also passed:
https://github.com/markdsparks/nearcast/actions/runs/35672840232
Unsigned promoted Release simulator build, full portable/native-model preflight,
signed archive and packaged-product validation all passed. Build 134 includes
native root, Living Sky and production delivery; Dev stays isolated.

Xcode's combined export/upload stalled at the App Store Connect version check.
Stopped that exact process, exported the same validated archive locally, then
uploaded `native/ios/build/export-testflight-134/Nearcast.ipa` with Apple's
altool and the existing API key. Apple returned `UPLOAD SUCCEEDED with no
errors`, delivery UUID `a0ac7f80-b07e-4588-ac5b-afb34c0761e4`. Processing and
tester availability must still be checked separately. No device was enrolled
and no notification was sent by this deployment.
