import assert from "node:assert/strict";
import { handleCurrentRealityRequest } from "../workers/radar-capability.mjs";

const originalFetch = globalThis.fetch;
const now = Date.parse("2026-08-21T18:00:00Z");
const calls = [];
globalThis.fetch = async (request, init = {}) => {
  const url = String(request);
  calls.push({ url, headers: new Headers(init.headers || {}) });
  if (url.includes("/points/")) {
    return Response.json({
      properties: { observationStations: "https://api.weather.gov/gridpoints/LSX/1,1/stations" }
    });
  }
  if (url.endsWith("/stations")) {
    return Response.json({
      features: [
        { id: "KAAA", geometry: { coordinates: [-89.95, 38.72] }, properties: { stationIdentifier: "KAAA", name: "Alpha" } },
        { id: "KBBB", geometry: { coordinates: [-89.8, 38.75] }, properties: { stationIdentifier: "KBBB", name: "Bravo" } }
      ]
    });
  }
  if (url.includes("/stations/KAAA/observations/latest")) {
    return Response.json({ properties: {
      timestamp: new Date(now - 5 * 60 * 1000).toISOString(),
      temperature: { value: 21 }, relativeHumidity: { value: 62 },
      windSpeed: { value: 3 }, windGust: { value: 5 }, provider: "MADIS"
    } });
  }
  if (url.includes("/stations/KBBB/observations/latest")) {
    return Response.json({ properties: {
      timestamp: new Date(now - 8 * 60 * 1000).toISOString(),
      temperature: { value: 21.3 }, relativeHumidity: { value: 60 },
      windSpeed: { value: 2 }, provider: "MADIS"
    } });
  }
  throw new Error(`Unexpected ${url}`);
};

try {
  const response = await handleCurrentRealityRequest(new Request("https://getnearcast.app/api/observations/current?lat=38.7201&lon=-89.9501"), {}, {});
  assert.equal(response.status, 200, "current-reality endpoint is available without account state");
  const body = await response.json();
  assert.equal(body.status, "ready", "NWS observations return a supplemental ready state");
  assert.equal(body.stations.length, 2, "only the nearest station reports are returned");
  assert.equal(body.stations[0].id, "KAAA", "station identity is normalized");
  assert.equal(body.stations[0].temperatureC, 21, "station temperatures stay in source units for client-side unit conversion");
  assert.ok(body.stations.every((station) => Number.isFinite(station.distanceKm)), "distance is included for honest presentation");
  assert.ok(calls.every((call) => call.headers.get("User-Agent")?.includes("Nearcast")), "NWS requests carry Nearcast's identifying user agent");

  const invalid = await handleCurrentRealityRequest(new Request("https://getnearcast.app/api/observations/current?lat=nope&lon=-89"), {}, {});
  assert.equal(invalid.status, 400, "invalid coordinates do not reach NWS");
  assert.equal((await invalid.json()).status, "unsupported", "invalid requests stay explicitly unsupported");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS  current reality worker proxy and privacy contract");
