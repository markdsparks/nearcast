# Native fresh-start checkpoint — September 20, 2026

## Product decision

Start fresh rather than migrate browser places/plans. Preserve native data
already saved and leave old browser records untouched. Native Dev is the
normal testing lane; no hidden WebKit runtime is needed for its journeys.

## Implemented in this checkpoint

- First launch: choose/search a place, confirm, and enter owned native weather.
  No temporary browser-cache preview and no import requirement.
- Plans: native creation/review/edit/delete, explicit per-plan background
  notification enrollment, durable consent, serialized inventory sync, pending
  removal/retry status, weekly routines and place-local schedules.
- Ask: deterministic forecast fallback without AI inference, conversational
  follow-ups, on-device editable dictation, validated native navigation and
  confirmation before a place switch. Future-date radar requests go to hourly
  guidance instead of pretending that arbitrary radar forecasts exist.
- Companions: native plan and official-alert publication through the existing
  widget/Watch coordinator, with source freshness and ownership checks. A plan
  at another place gets schedule-only content until its forecast is available;
  it must not borrow Home weather.
- Live Activity: explicit start/update/end from Home’s More menu. Native
  evidence is a saved official-alert or hourly-thunder reading, not measured
  storm arrival. No invented ETA, motion, or automatic server tracking.
- Map: native enhanced radar and integrated forecast timeline. The experimental
  Storm Check / tap-to-check precipitation capability is removed from the app
  at the user's request; its isolated algorithm/tests remain parked for now.
  Official alerts and radar enhancement remain intact. No inferred lightning data.

## Notification safety and deployment boundary

Native enrollment uses `client.owner = native-v1`, a domain-separated server
subscription identity, and owner-verified receipts. Configuration must first
advertise `nativeOwnerScopes: [native-v1]`; an older deployed backend is blocked
before any write. Enrollment also requires configured native delivery,
storage, and an enabled evaluator. Registration is not proof of APNs arrival.

Plan choices stay local until explicit opt-in. Consent explains exactly what
is sent (title, place, schedule and device channel). Old-app watches are not
imported or deleted. People who enabled old notifications must turn them off
there if they want to avoid duplicate notices. Native deletion/opt-out only
removes the independent native registration. A lost registration response is
not treated as no registration: removal can derive the exact owner-scoped ID
from the retained channel. APNs token rotation retires that old native channel
before creating a new registration.

The existing Dev lane deliberately has remote delivery disabled. No production
deployment, real subscription, APNs send, or permission change is performed by
the test suites. Backend changes in `workers/radar-capability.mjs` must be
deployed through the normal service pipeline before enrollment is available.
Testing Dev pushes additionally needs a separately configured Dev APNs lane;
do not point its token at the production bundle configuration.

## Automated evidence

- Signed iPhone Dev build and iPhone 17 Pro Max iOS 27 simulator build pass.
- New native notification tests intercept every request and use ephemeral
  storage. They cover scope preflight, consent/denial, durable intent, lost
  replies, edit/delete races, foreground rechecks, token rotation, corruption,
  completed plans and in-progress multi-day schedules.
- Server ownership tests cover isolated registration/removal, timezone-aware
  urgent windows, weekly rollover and daylight-saving clock gaps.
- Native Ask fallback, voice source/lifecycle, companion content/publication,
  parked Storm Check algorithm and native route boundary tests are included in
  native CI. The parked algorithm passing does not mean the app offers it.
- Full `nearcast-ci.sh native-model` and `nearcast-ci.sh portable` pass for
  this checkpoint; `git diff --check` is clean.
- iPhone 17 Pro Max simulator walkthrough passed fresh city search/confirmation,
  preservation of an existing native weekly plan, native Plans detail, Ask’s
  no-model forecast answer, exact Tomorrow hourly navigation, and explicit
  Live Activity start/end. The simulator-created test activity was ended.
- The signed build installs to the physical iPhone Dev app. Launch was blocked
  by the locked iPhone, and the paired Watch connection timed out. Neither is
  evidence of a successful physical companion/background test.

## Gates before promoting Release/TestFlight

The [September 21 companion reliability checkpoint](native-companion-reliability.md)
records delivery/recovery and exact-expiry fixes, executable evidence, and
successful Dev installation/launch on both physical devices, and a partial
physical pass for the Dev widget and Watch weather/hourly/daily screens.
The subsequent location-provenance repair is installed in Dev. Physical
Maryville/Chicago and Fahrenheit/Celsius/clock switching passed on phone,
Dev widget and Watch, with original settings restored. Watch rain/empty-plan
routes and local plan delivery also passed. Complication face identity, travel,
and background recovery remain open. Phone plan
reopen/edit/delete passed, and the disposable QA plan was removed. After Watch
display recovery, its plan route returned Today rather than the deleted plan. Physical Ask
date grounding and a supplied-evidence contradiction repair were installed;
the tomorrow-afternoon walk question now passes on-device with the correct
September 22 evidence. This does not close the companion gate below. The portable dependency
check now validates an exact checked-in Operon requirement rather than a
generated workspace lockfile, and the full portable suite passes again.

1. Family walkthrough on iPhone 17 Pro and Pro Max: fresh setup, places,
   settings, daily/hourly navigation, Ask, create/edit/delete a plan, map.
2. Physical on-device model and microphone permission/cancellation checks.
3. Real WidgetKit and paired Ultra 2 delivery: cold launch, place/unit changes,
   new/deleted plans, phone asleep, Watch temporarily disconnected, stale data.
4. Explicitly approved notification canary after service deployment: opt in,
   edit, weekly rollover, closed-app delivery, tap routing, opt out; no
   duplicates with old watches. Verify evaluator health and delivery receipts.
5. Real Live Activity start, saved-reading/stale treatment, tap and end.
6. Only then deliberately promote native root/Living Sky to Release, archive,
   distribute via TestFlight, and remove dormant compatibility code in a
   separate change. Dev success alone does not mean these gates have passed.

## Optional Xweather follow-up, not a native-cutover requirement

The web app's StormScope mode is distinct from Nearcast's own enhanced radar.
The native Xweather adapter remains an isolated proof, not an active app layer.
Current recommendation: retain Nearcast radar as the default and assess observed
lightning as a separate overlay before considering a second radar mode. No paid
provider activation or service configuration was performed for this removal.

Native-use license permission was confirmed by the user. Future activation still
requires verification of the exact lightning product entitlement, credentials,
usage limits, foreground lifecycle and actual-device behavior. MapsGL layer
access and direct Weather API lightning access must not be assumed equivalent.
See `native-xweather-foundation.md` for the existing integration boundary.
