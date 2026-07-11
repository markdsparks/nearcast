import assert from "node:assert/strict";
import {
  handleLiveActivityEndRequest,
  handleLiveActivityRegisterRequest,
  liveActivityForecastCandidate
} from "../workers/radar-capability.mjs";

const now = Date.parse("2026-07-11T12:00:00Z");
const forecast = {
  current: { precipitation: 0, weather_code: 2 },
  minutely_15: {
    time: [
      "2026-07-11T12:00:00Z",
      "2026-07-11T12:15:00Z",
      "2026-07-11T12:30:00Z"
    ],
    precipitation: [0, 0.02, 0.08],
    precipitation_probability: [12, 62, 84],
    weather_code: [2, 61, 95]
  }
};

const candidate = liveActivityForecastCandidate(forecast, now);
assert.equal(candidate?.ms, Date.parse("2026-07-11T12:15:00Z"));
assert.equal(candidate?.pop, 62);
assert.equal(candidate?.precision, "minutely");

const wetNow = liveActivityForecastCandidate({
  ...forecast,
  current: { precipitation: 0.04, weather_code: 61 }
}, now);
assert.equal(wetNow?.ms, now);

assert.equal(liveActivityForecastCandidate({
  current: { precipitation: 0, weather_code: 2 },
  minutely_15: {
    time: ["2026-07-11T12:15:00Z"],
    precipitation: [0],
    precipitation_probability: [20],
    weather_code: [2]
  }
}, now), null);

const records = new Map();
const env = {
  PLAN_WATCH_R2: {
    async put(key, value) { records.set(key, String(value)); },
    async get(key) {
      const value = records.get(key);
      return value == null ? null : { async json() { return JSON.parse(value); } };
    },
    async delete(key) { records.delete(key); }
  }
};
const registration = await handleLiveActivityRegisterRequest(new Request("https://getnearcast.app/api/live-activities/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    activityId: "activity-test-1",
    token: "a".repeat(64),
    environment: "production",
    bundleId: "app.nearcast.ios",
    placeName: "Maryville, Illinois",
    latitude: 38.72,
    longitude: -89.96,
    etaMinutes: 30,
    expiresAtEpoch: now / 1000 + 3600
  })
}), env);
assert.equal(registration.status, 200);
assert.equal(records.size, 1);

const ended = await handleLiveActivityEndRequest(new Request("https://getnearcast.app/api/live-activities/end", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ activityId: "activity-test-1" })
}), env);
assert.equal(ended.status, 200);
assert.equal(records.size, 0);

console.log("Live Activity forecast smoke tests passed.");
