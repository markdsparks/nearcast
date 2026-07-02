import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const truth = require("../weather-truth.js");

const units = { temp: "°F", wind: "mph", precip: "in" };

assert.equal(globalThis.NearcastWeatherTruth, truth);

const heatWatch = {
  tone: "watch",
  alertTone: "warning",
  primaryReason: "Extreme Heat Warning overlaps that window",
  alert: { event: "Extreme Heat Warning" },
  units,
  stats: {
    feelsMin: 92,
    feelsAvg: 96,
    feelsMax: 101,
    tempMin: 86,
    tempMax: 93,
    uvMax: 7,
    rainChanceMin: 0,
    rainChance: 7,
    gustMax: 22
  }
};

assert.equal(truth.planWatchRiskKind(heatWatch), "heat");
assert.equal(truth.planWatchLabel(heatWatch), "Plan around heat");
assert.match(truth.planWatchActionText(heatWatch), /shade, water, cooling breaks/i);
assert.deepEqual(truth.planContextSignalRows(heatWatch).map(row => row.label), ["Feels", "Temp", "UV"]);
assert.equal(truth.planContextSignalRows(heatWatch)[0].value, "92°F-101°F");
const heatTruth = truth.planWeatherTruth({ ...heatWatch, score: 82, status: "ready" });
assert.equal(heatTruth.verdict, "High-risk");
assert.equal(heatTruth.tone, "watch");
assert.equal(heatTruth.riskKind, "heat");
assert.equal(heatTruth.label, "Plan around heat");
assert.equal(heatTruth.notification.eligible, false);
assert.equal(heatTruth.notification.signal, "warning");
assert.deepEqual(heatTruth.signalRows.map(row => row.label), ["Feels", "Temp", "UV"]);
assert.deepEqual(heatTruth.receiptLines.map(row => row.label), ["Alert", "Feels", "Temp", "UV"]);
assert.match(heatTruth.receipt, /Alert: Extreme Heat Warning overlaps this window/);
assert.match(heatTruth.receipt, /Feels: 92°F-101°F/);

const rainWatch = {
  tone: "watch",
  primaryReason: "72% rain chance during the plan",
  units,
  stats: {
    rainChanceMin: 20,
    rainChance: 72,
    precipTotal: 0.23,
    gustMax: 18,
    feelsAvg: 74,
    tempMin: 71,
    tempMax: 78
  }
};

assert.equal(truth.planWatchRiskKind(rainWatch), "rain");
assert.equal(truth.planWatchLabel(rainWatch), "Expect rain");
assert.match(truth.planWatchActionText(rainWatch), /rain gear/i);
assert.deepEqual(truth.planContextSignalRows(rainWatch).map(row => row.label), ["Rain", "Amount", "Gusts"]);
assert.equal(truth.planContextSignalRows(rainWatch)[0].value, "20-72%");
assert.equal(truth.planContextSignalRows(rainWatch)[1].value, "0.2 in total");
assert.deepEqual(truth.planWeatherReceiptLines(rainWatch).map(row => row.label), ["Signal", "Rain", "Amount", "Gusts"]);

const windWatch = {
  tone: "caution",
  primaryReason: "gusts near 31 mph",
  units,
  stats: {
    gustMax: 31,
    windMin: 13,
    windMax: 22,
    rainChanceMin: 0,
    rainChance: 12,
    feelsAvg: 67
  }
};

assert.equal(truth.planWatchRiskKind(windWatch), "wind");
assert.equal(truth.planWatchLabel(windWatch), "Wind may matter");
assert.match(truth.planWatchActionText(windWatch), /Secure loose items/i);
assert.deepEqual(truth.planContextSignalRows(windWatch).map(row => row.label), ["Gusts", "Wind", "Rain"]);
assert.equal(truth.planContextSignalRows(windWatch)[0].value, "Peak 31 mph");

const celsiusHeatWatch = {
  tone: "caution",
  units: { temp: "°C", wind: "km/h", precip: "mm" },
  stats: {
    feelsAvg: 32,
    feelsMax: 34,
    tempMin: 29,
    tempMax: 31,
    gustMax: 20,
    rainChance: 5,
    precipTotal: 0
  }
};
assert.equal(truth.planWatchRiskKind(celsiusHeatWatch), "heat");

const goodWatch = {
  tone: "good",
  primaryReason: "weather looks manageable",
  units,
  stats: {
    rainChanceMin: 0,
    rainChance: 7,
    feelsMin: 72,
    feelsAvg: 75,
    feelsMax: 78,
    tempMin: 72,
    tempMax: 78,
    gustMax: 11,
    uvMax: 3
  }
};

assert.equal(truth.planWatchRiskKind(goodWatch), "good");
assert.equal(truth.planWatchLabel(goodWatch), "Looks good");
assert.equal(truth.planWatchActionText(goodWatch), "");
assert.equal(truth.planWatchReason(goodWatch), "Weather looks manageable");
assert.deepEqual(truth.planContextSignalRows(goodWatch).map(row => row.label), ["Rain", "Feels", "Gusts"]);
const goodTruth = truth.planWeatherTruth({ ...goodWatch, score: 91, status: "ready" });
assert.equal(goodTruth.verdict, "Looks good");
assert.equal(goodTruth.tone, "good");
assert.equal(goodTruth.notification.eligible, false);
assert.deepEqual(goodTruth.receiptLines.map(row => row.label), ["Signal", "Rain", "Feels", "Gusts"]);

assert.equal(truth.planVerdict(44, ""), "Not ideal");
assert.match(truth.planAdvice({ stormPotential: true }, null, 40), /delay or indoor/i);
assert.equal(truth.weatherTruthAlertTone({ event: "Severe Thunderstorm Warning" }), "warning");
assert.equal(truth.weatherTruthAlertTone({ severity: "Severe" }), "warning");

const baselinePlan = {
  title: "4th Party",
  targetDate: "2026-07-03",
  startHour: 15,
  endHour: 20,
  rainChance: 20,
  gustMax: 18,
  feelsMax: 91,
  tempUnit: "°F",
  windUnit: "mph",
  score: 82
};
const rainChange = truth.planWeatherChange(baselinePlan, { ...baselinePlan, rainChance: 72, score: 58 });
assert.equal(rainChange.type, "plan-rain");
assert.equal(rainChange.notify, true);
assert.match(rainChange.body, /Rain now 72%/);

const drierChange = truth.planWeatherChange({ ...baselinePlan, rainChance: 72 }, { ...baselinePlan, rainChance: 28 });
assert.equal(drierChange.type, "plan-rain");
assert.equal(drierChange.notify, false);

const heatChange = truth.planWeatherChange(baselinePlan, { ...baselinePlan, feelsMax: 101, score: 52 });
assert.equal(heatChange.type, "plan-heat");
assert.equal(heatChange.tone, "watch");
assert.equal(heatChange.notify, true);
assert.match(heatChange.body, /101°F/);

const windChange = truth.planWeatherChange(baselinePlan, { ...baselinePlan, gustMax: 31, score: 61 });
assert.equal(windChange.type, "plan-wind");
assert.equal(windChange.notify, true);

const alertChange = truth.planWeatherChange(baselinePlan, { ...baselinePlan, alertTone: "warning", alertEvent: "Extreme Heat Warning" });
assert.equal(alertChange.type, "plan-alert");
assert.equal(alertChange.notify, true);
assert.match(alertChange.body, /Extreme Heat Warning/);

const noMeaningfulChange = truth.planWeatherChange(baselinePlan, { ...baselinePlan, rainChance: 25, gustMax: 20, feelsMax: 93, score: 79 });
assert.equal(noMeaningfulChange, null);

const changedTruth = truth.planWeatherTruth({ ...rainWatch, score: 58, status: "ready", change: rainChange });
assert.equal(changedTruth.notification.eligible, true);
assert.equal(changedTruth.notification.signal, "plan-rain");

const sharedCurrentState = truth.planWeatherWatchCurrentState(
  {
    id: "party-1",
    title: "4th Party",
    targetDate: "2026-07-03",
    startHour: 15,
    endHour: 20
  },
  heatWatch.stats,
  { event: "Extreme Heat Warning", severity: "Severe" },
  "fahrenheit"
);
assert.equal(sharedCurrentState.tone, "watch");
assert.equal(sharedCurrentState.label, "Plan around heat");
assert.match(sharedCurrentState.receipt, /Extreme Heat Warning/);
assert.equal(sharedCurrentState.snapshot.alertTone, "warning");
assert.equal(sharedCurrentState.snapshot.riskKind, "heat");

const sharedInitialChange = truth.planWeatherWatchStateChange({}, sharedCurrentState);
assert.equal(sharedInitialChange.type, "plan-alert");
assert.equal(sharedInitialChange.notify, true);
assert.equal(sharedInitialChange.updateBaseline, true);

const sharedLastKnown = truth.planWeatherLastKnownFromState(
  { id: "party-1", targetDate: "2026-07-03", startHour: 15, endHour: 20 },
  sharedCurrentState,
  sharedInitialChange,
  "2026-07-02T12:00:00.000Z"
);
assert.equal(sharedLastKnown.signal, "plan-alert");
assert.equal(sharedLastKnown.checkedAt, "2026-07-02T12:00:00.000Z");
assert.match(sharedLastKnown.receipt, /Feels: 92°F-101°F/);

const sharedCandidate = truth.planWeatherNotificationCandidate(
  { id: "party 1", title: "4th Party" },
  sharedCurrentState,
  sharedInitialChange
);
assert.equal(sharedCandidate.type, "plan-alert");
assert.equal(sharedCandidate.notification.tag, "nearcast-plan-party-1");
assert.match(sharedCandidate.notification.body, /Extreme Heat Warning/);

const sharedBaselineChange = truth.planWeatherWatchStateChange({}, truth.planWeatherWatchCurrentState(
  {
    id: "quiet-1",
    title: "Quiet plan",
    targetDate: "2026-07-05",
    startHour: 10,
    endHour: 12
  },
  goodWatch.stats,
  null,
  "fahrenheit"
));
assert.equal(sharedBaselineChange.type, "baseline");
assert.equal(sharedBaselineChange.notify, false);

const longText = "This plan has a very long context sentence that should remain readable without clipping inside the watched plan surface.";
const compactText = truth.planWatchCompactText(longText, 42);
assert.ok(compactText.endsWith("..."));
assert.ok(compactText.length <= 42);
assert.match(compactText, /very long context/);

console.log("weather-truth fixtures passed");
