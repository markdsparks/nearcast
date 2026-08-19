#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planWatchBackgroundMaterialEvent,
  planWatchCanonicalEventForBackgroundEvaluation
} from "../workers/radar-capability.mjs";

const require = createRequire(import.meta.url);
const truth = require("../weather-truth.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [planner, worker] = await Promise.all([
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "workers/radar-capability.mjs"), "utf8")
]);

const at = (hour) => Date.UTC(2030, 6, 5, hour);
const rainEvent = {
  id: "precip:2030-07-05:0",
  kind: "rain",
  headline: "Rain likely 7–11 AM",
  support: null,
  likelihood: "likely",
  chance: 72,
  basis: "forecast",
  source: "hourly-forecast",
  startAt: at(7),
  peakStartAt: at(7),
  peakEndAt: at(11),
  endAt: at(11),
  timing: "7–11 AM"
};
const stormEvent = {
  ...rainEvent,
  headline: "Rain likely 7–11 AM",
  support: "Storms likely 9–11 AM",
  peakStartAt: at(9)
};
const planSnapshot = (materialEvent, extra = {}) => ({
  title: "Morning walk",
  targetDate: "2030-07-05",
  startHour: 8,
  endHour: 12,
  rainChance: 72,
  gustMax: 14,
  feelsMax: 78,
  tempUnit: "°F",
  windUnit: "mph",
  score: 58,
  materialEventReady: true,
  materialEvent,
  ...extra
});

assert.equal(
  truth.planBriefingReason({ stats: { materialEvent: stormEvent, stormPotential: true, rainChance: 72 } }),
  "Rain likely 7–11 AM · Storms likely 9–11 AM",
  "Agenda and plan verdicts lead with the exact canonical event instead of a generic storm label"
);

const strengthened = truth.planWeatherChange(planSnapshot(rainEvent), planSnapshot(stormEvent));
assert.equal(strengthened?.type, "plan-event-storm");
assert.equal(strengthened?.notify, true);
assert.match(strengthened?.title || "", /Rain likely 7–11 AM/);
assert.match(strengthened?.body || "", /Storms likely 9–11 AM/);

const movedEarlier = truth.planWeatherChange(
  planSnapshot(rainEvent),
  planSnapshot({ ...rainEvent, headline: "Rain likely 5–9 AM", startAt: at(5), endAt: at(9), timing: "5–9 AM" })
);
assert.equal(movedEarlier?.type, "plan-event-timing");
assert.equal(movedEarlier?.notify, true);
assert.equal(movedEarlier?.receipt?.metric?.label, "Event timing");

const legacyBaseline = { ...planSnapshot(null) };
delete legacyBaseline.materialEvent;
delete legacyBaseline.materialEventReady;
assert.equal(
  truth.planWeatherChange(legacyBaseline, planSnapshot(stormEvent)),
  null,
  "adopting the contract does not create a one-time migration notification"
);
assert.equal(
  truth.planWeatherChange(
    planSnapshot({ ...rainEvent, authority: "nearcast-app", policyVersion: 1 }),
    planSnapshot({ ...stormEvent, authority: "background-open-meteo", policyVersion: 1 })
  ),
  null,
  "two different event authors cannot reinterpret each other as a canonical storm or timing change"
);

const canonicalCandidate = truth.planWeatherNotificationCandidate(
  { id: "walk", title: "Morning walk" },
  { snapshot: planSnapshot(stormEvent) },
  strengthened
);
assert.match(canonicalCandidate.notification.title, /Rain likely 7–11 AM/);
assert.match(canonicalCandidate.notification.body, /Storms likely 9–11 AM/);

const forecast = {
  utc_offset_seconds: 0,
  hourly: {
    time: [
      "2030-07-05T06:00", "2030-07-05T07:00", "2030-07-05T08:00", "2030-07-05T09:00",
      "2030-07-05T10:00", "2030-07-05T11:00", "2030-07-05T12:00", "2030-07-05T13:00"
    ],
    weather_code: [3, 61, 61, 95, 95, 3, 3, 3],
    precipitation_probability: [10, 68, 72, 76, 70, 24, 12, 8],
    precipitation: [0, 0.04, 0.08, 0.2, 0.12, 0, 0, 0],
    wind_gusts_10m: [9, 11, 12, 18, 16, 12, 10, 9]
  }
};
const workerPlan = {
  targetDate: "2030-07-05",
  startHour: 8,
  endHour: 12
};
const workerEvent = planWatchBackgroundMaterialEvent(workerPlan, forecast, "fahrenheit");
assert.equal(workerEvent?.id, "precip:2030-07-05:0");
assert.equal(workerEvent?.kind, "rain", "the onset stays rain when storms begin later");
assert.match(workerEvent?.headline || "", /^Rain likely 7–11 AM$/);
assert.match(workerEvent?.support || "", /^Storms likely 9–11 AM$/);
assert.equal(workerEvent?.startAt, at(7), "the complete event is retained even when the plan starts after onset");
assert.equal(workerEvent?.endAt, at(11));
assert.equal(
  planWatchBackgroundMaterialEvent({ targetDate: "2030-07-05", startHour: 12, endHour: 14 }, forecast),
  null,
  "events outside the exact plan window do not become plan truth"
);

const canonicalForWorker = {
  ...stormEvent,
  authority: "nearcast-app",
  policyVersion: 1
};
assert.deepEqual(
  planWatchCanonicalEventForBackgroundEvaluation({ ...workerPlan, canonicalEvent: canonicalForWorker }, forecast, "fahrenheit", workerEvent),
  canonicalForWorker,
  "background evaluation may reuse exact app copy only when independent evidence agrees"
);
const rawThunderOnly = {
  ...workerEvent,
  kind: "storm",
  headline: "Storms likely 7–11 AM",
  support: null,
  authority: "background-open-meteo"
};
assert.equal(
  planWatchCanonicalEventForBackgroundEvaluation({
    ...workerPlan,
    canonicalEvent: { ...rainEvent, authority: "nearcast-app", policyVersion: 1 }
  }, forecast, "fahrenheit", rawThunderOnly),
  null,
  "a raw thunder code cannot override app convective gating that kept the event as ordinary rain"
);

assert.match(planner, /material_event: materialEvent/, "Operon artifacts carry canonical event identity and timing");
assert.match(planner, /materialEvent\s*\n\s*};/, "plan-window stats carry the canonical event into Agenda and watch evaluation");
assert.match(planner, /function nearcastCompatibleWindowArtifact[\s\S]*samePlanPlace[\s\S]*executeNearcastPlaceNavigationSkill[\s\S]*nearcastViewArtifacts\(type, place, context, retainedWindow\)/, "opening a live map retains a compatible day/time artifact for the next agent turn");
assert.match(planner, /canonicalEvent,[\s\S]*lastKnown:/, "notification registration sends app-authored event truth separately from its comparison baseline");
assert.match(worker, /canonicalEvent: normalizePlanWatchMaterialEvent\(value\.canonicalEvent\)/, "remote watch registration preserves app-authored event truth");
assert.match(worker, /if \(canonicalEvent\) result\.materialEvent = canonicalEvent/, "remote watch copy uses exact app truth only after an independent compatibility check");
assert.match(worker, /materialEvent: normalizePlanWatchMaterialEvent\(value\.materialEvent\)/, "registered and stored watch baselines preserve canonical events");
assert.doesNotMatch(planner, /APNs server setup before it can send/, "family-facing notification health no longer exposes infrastructure jargon");

console.log("Material event surfaces smoke passed.");
