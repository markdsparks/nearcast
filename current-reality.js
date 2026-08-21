(function attachNearcastCurrentReality(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NearcastCurrentReality = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function currentRealityFactory() {
  "use strict";

  const MAX_AGE_MS = 45 * 60 * 1000;
  const CLOSE_STATION_KM = 25;
  const TWO_STATION_KM = 50;
  const MAX_SPREAD_F = 4;
  const SINGLE_STATION_CAP_F = 3;
  const MULTI_STATION_CAP_F = 5;
  const MIN_USEFUL_DELTA_F = 0.7;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function celsiusToUnit(value, unit) {
    const celsius = finite(value);
    if (celsius === null) return null;
    return /c/i.test(String(unit || ""))
      ? celsius
      : celsius * 9 / 5 + 32;
  }

  function weightedMean(items) {
    let total = 0;
    let weight = 0;
    items.forEach((item) => {
      const value = finite(item?.value);
      const distance = Math.max(0, finite(item?.distanceKm) ?? 999);
      const ageMinutes = Math.max(0, finite(item?.ageMs) ?? MAX_AGE_MS) / 60000;
      if (value === null) return;
      // Distance matters more than a few minutes of age, but neither is hidden.
      const itemWeight = 1 / Math.pow(1 + distance / 12, 2) / (1 + ageMinutes / 30);
      total += value * itemWeight;
      weight += itemWeight;
    });
    return weight > 0 ? total / weight : null;
  }

  function observationLabel(count) {
    return count === 1 ? "nearby observation" : `${count} nearby observations`;
  }

  function normalizeStations(input = {}, nowMs = Date.now()) {
    return (Array.isArray(input.stations) ? input.stations : [])
      .map((station) => {
        const observedAtMs = finite(station?.observedAtMs ?? station?.timestamp);
        const ageMs = observedAtMs === null ? null : Math.max(0, nowMs - observedAtMs);
        const temperatureC = finite(station?.temperatureC);
        const distanceKm = finite(station?.distanceKm);
        return {
          id: String(station?.id || ""),
          name: String(station?.name || station?.id || "Nearby station"),
          distanceKm,
          observedAtMs,
          ageMs,
          temperatureC,
          relativeHumidity: finite(station?.relativeHumidity),
          windSpeedMps: finite(station?.windSpeedMps),
          windGustMps: finite(station?.windGustMps),
          provider: String(station?.provider || "NWS")
        };
      })
      .filter((station) => station.temperatureC !== null && station.distanceKm !== null && station.observedAtMs !== null && station.ageMs <= MAX_AGE_MS)
      .filter((station) => station.distanceKm <= TWO_STATION_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm || a.ageMs - b.ageMs);
  }

  // This is deliberately a calibration, never a station replacement. A nearby
  // report can reveal a local model bias, but it cannot prove conditions at a
  // person's exact location.
  function currentRealityPresentation(input = {}) {
    const nowMs = finite(input.nowMs) ?? Date.now();
    const unit = input.unit || "fahrenheit";
    const modelTemperature = finite(input?.current?.temperature_2m);
    const modelApparent = finite(input?.current?.apparent_temperature);
    const stations = normalizeStations(input.observations, nowMs);
    const close = stations.filter((station) => station.distanceKm <= CLOSE_STATION_KM);
    const usable = stations.length >= 2 ? stations : close.slice(0, 1);

    if (modelTemperature === null || !usable.length) {
      return {
        status: "estimated",
        basis: "modeled-current",
        stations: [],
        reason: stations.length ? "model-current-unavailable" : "nearby-observations-unavailable"
      };
    }

    const temperatures = usable.map((station) => ({
      ...station,
      value: celsiusToUnit(station.temperatureC, unit)
    })).filter((station) => station.value !== null);
    const values = temperatures.map((station) => station.value);
    const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    const qualifies = (temperatures.length >= 2 || close.length >= 1) && spread <= MAX_SPREAD_F;
    if (!qualifies) {
      return {
        status: "estimated",
        basis: "modeled-current",
        stations: temperatures,
        reason: spread > MAX_SPREAD_F ? "nearby-observations-disagree" : "nearby-observations-too-distant"
      };
    }

    const observedTemperature = weightedMean(temperatures);
    const cap = temperatures.length >= 2 ? MULTI_STATION_CAP_F : SINGLE_STATION_CAP_F;
    const rawAdjustment = observedTemperature - modelTemperature;
    const adjustment = clamp(rawAdjustment, -cap, cap);
    const applyCalibration = Math.abs(adjustment) >= MIN_USEFUL_DELTA_F;
    const freshest = temperatures.reduce((latest, station) => (
      !latest || station.observedAtMs > latest.observedAtMs ? station : latest
    ), null);
    const nearest = temperatures[0];
    const sourceCount = temperatures.length;
    const calibratedTemperature = applyCalibration ? modelTemperature + adjustment : modelTemperature;
    const calibratedApparent = applyCalibration && modelApparent !== null
      ? modelApparent + adjustment
      : modelApparent;

    return {
      status: applyCalibration ? "localized" : "corroborated",
      basis: applyCalibration ? "localized-nearby-observations" : "modeled-current",
      source: "nearby-observations",
      temperature_2m: calibratedTemperature,
      apparent_temperature: calibratedApparent,
      modelTemperature,
      observedTemperature,
      adjustment,
      applied: applyCalibration,
      stationCount: sourceCount,
      stationLabel: observationLabel(sourceCount),
      nearestStation: nearest ? {
        id: nearest.id,
        name: nearest.name,
        distanceKm: nearest.distanceKm,
        observedAtMs: nearest.observedAtMs,
        provider: nearest.provider
      } : null,
      observedAtMs: freshest?.observedAtMs ?? null,
      ageMs: freshest?.ageMs ?? null,
      spread,
      stations: temperatures
    };
  }

  return {
    MAX_AGE_MS,
    currentRealityPresentation,
    normalizeStations
  };
}));
