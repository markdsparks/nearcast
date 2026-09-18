# Ask Nearcast device release gate

## Scope

The capability-aware adapter builds with Xcode 26.6. It uses existing public
Foundation Models APIs, including token counting on iOS 26.4 and later, and
therefore follows the installed default system model on newer supported OSes.
No iOS 27-only Dynamic Profile or Private Cloud Compute integration is enabled.
No cloud request, new permission, notification behavior, or Home card is added.

Portable tests check orchestration contracts, not language-model accuracy.
Simulator compilation is not a substitute for a supported physical iPhone.
Do not describe the new model as validated until this gate has been run.

## Procedure

Run each flow five times from a new chat on an eligible older supported OS and
the target iOS 27 device. Record OS, hardware, runtime context capacity, outcome,
time to first visible progress, total latency, and wrong-clarification count.
Keep transcripts local; never upload family places or plan contents as analytics.
Use forecast dates actually available at test time; expected dates must be
resolved in the requested place's time zone, not the tester's time zone.

| Flow | Required outcome |
| --- | --- |
| Switch to Maryville, Illinois | Correct place, no unnecessary clarification |
| Switch to Nokomis and show the map | Correct resolved place AND map opens |
| Switch to Hardin, Kentucky, then show next Tuesday hourly | Kentucky, correct Tuesday, hourly opens |
| Show Maryville's forecast next Wednesday | Selected day's view, not generic Home |
| Show hourly; answer “Now” if asked | Opens today's relevant hours, no clarification loop |
| Check a walk tomorrow 6–8 PM; then “What about the following day?” | Place, activity, and clock window retained; date advances |
| Check a plan in Kentucky; explicitly change to Illinois | Explicit place overrides old context |
| Ask about pickup without supplying its time | Ask for the missing time; do not invent a family schedule |
| Camp Tuesday noon through Thursday evening | One continuous span, all covered days evaluated |
| New chat after discussing a trip | No stale trip place/window leaks into the new conversation |
| A long compound command with state/date near its end | Preserved in full or explicitly rejected; never partly executed |
| Ask for a forecast only | No plan saved, watch enabled, or notification permission requested |
| Disable Apple Intelligence / model not downloaded | Actionable availability message, normal weather remains usable |
| Cancel during planning and during skill execution | No later navigation from a cancelled turn; no automatic replay |
| Simulate model failure after a place switch | Partial completion acknowledged; no duplicate mutation |
| Long context / unsupported language / busy model | Correct failure category, not a generic missing-information question |

## Acceptance

- No wrong-state navigation, wrong-date navigation, invented weather numbers,
  unrequested watches, or duplicate actions in this suite.
- All displayed facts resolve to current host weather evidence.
- Compare completion and clarification rates against the prior build; investigate
  every regression rather than relying on Apple's general benchmark claims.
- Review latency on the oldest supported family device and under Low Power Mode.
- TestFlight distribution requires a new native build. This checklist is pending
  physical-device execution, not a report of completed model evaluations.
