const FIXTURE_TIME = "2026-08-19T10:15";

function forecast(overrides = {}) {
  const precipitationProbability = overrides.precipitationProbability || [2, 78, 35];
  const precipitation = overrides.precipitation || [0, 0.12, 0.04];
  const weatherCode = overrides.weatherCode || [61, 61, 95];
  const cloudCover = overrides.cloudCover || [92, 94, 88];
  return {
    fixturePlaceId: overrides.placeId || "maryville-il",
    utc_offset_seconds: 0,
    timezone: "America/Chicago",
    current: {
      time: FIXTURE_TIME,
      temperature_2m: 73,
      apparent_temperature: 74,
      weather_code: overrides.currentCode ?? 3,
      wind_speed_10m: 7,
      wind_gusts_10m: 11,
      is_day: 1
    },
    hourly: {
      time: [
        "2026-08-19T10:00",
        "2026-08-19T11:00",
        "2026-08-19T12:00"
      ],
      temperature_2m: [73, 74, 75],
      apparent_temperature: [74, 75, 77],
      weather_code: weatherCode,
      cloud_cover: cloudCover,
      precipitation_probability: precipitationProbability,
      precipitation,
      wind_speed_10m: [7, 8, 9],
      wind_gusts_10m: [11, 14, 17],
      uv_index: [2, 3, 4],
      is_day: [1, 1, 1]
    },
    daily: {
      time: ["2026-08-19"],
      weather_code: [95],
      precipitation_probability_max: [78],
      precipitation_sum: [0.16],
      temperature_2m_max: [82],
      temperature_2m_min: [68]
    }
  };
}

function truth(data, precip, overrides = {}) {
  return {
    data,
    current: data.current,
    code: overrides.code ?? precip?.visualCode ?? data.current.weather_code,
    nowCode: overrides.nowCode ?? precip?.visualCode ?? data.current.weather_code,
    label: overrides.label || precip?.label || "Cloudy",
    isDay: true,
    source: overrides.source || precip?.source || "modeled-current",
    display: {
      rawCode: data.hourly.weather_code[0],
      pop: data.hourly.precipitation_probability[0],
      precip: data.hourly.precipitation[0],
      stormPotential: Boolean(overrides.convective)
    },
    precip,
    convective: overrides.convective || null
  };
}

export function activeRadarLowPopFixture() {
  const data = forecast({
    precipitationProbability: [2, 78, 35],
    precipitation: [0, 0.12, 0.04],
    weatherCode: [61, 61, 95]
  });
  return {
    name: "active radar remains an observation while the earlier hourly guidance stays at 2%",
    data,
    truth: truth(data, {
      phase: "active",
      visualCode: 61,
      textCode: 61,
      label: "Light rain",
      source: "radar-current",
      confidence: "observed",
      basis: "observed",
      chance: 2,
      detail: "Light rain is observed over this place now."
    }, { code: 61, nowCode: 61, label: "Light rain", source: "radar-current" }),
    expected: {
      forecastPop: 2,
      displayMode: "observed-now",
      displayLabel: /rain now/i,
      ariaLabel: /observed/i,
      detail: /2%/i,
      observed: true
    }
  };
}

export function radarClearHighPopFixture() {
  const data = forecast({
    precipitationProbability: [82, 78, 35],
    precipitation: [0, 0.12, 0.04],
    weatherCode: [61, 61, 95]
  });
  return {
    name: "radar clear does not turn an 82% hourly forecast into an observation",
    data,
    truth: truth(data, {
      phase: "likely-this-hour",
      visualCode: 3,
      label: "Rain",
      source: "hourly-forecast",
      confidence: "forecast",
      chance: 82,
      detail: "Rain remains likely this hour, but radar is not wet over this place yet."
    }, { code: 3, nowCode: 3, label: "Cloudy", source: "hourly-forecast" }),
    expected: {
      forecastPop: 82,
      displayMode: "forecast-probability",
      displayLabel: /82%/i,
      observed: false
    }
  };
}

export function nearbyRadarFixture() {
  const data = forecast({
    precipitationProbability: [18, 78, 35],
    weatherCode: [3, 61, 95]
  });
  return {
    name: "nearby radar stays nearby and never becomes precipitation over the selected place",
    data,
    truth: truth(data, {
      phase: "nearby",
      visualCode: 3,
      label: "Rain",
      source: "radar-nearby",
      confidence: "nearby",
      chance: 18,
      detail: "Rain is close by on radar, but not over this place yet."
    }, { code: 3, nowCode: 3, label: "Cloudy", source: "radar-nearby" }),
    expected: {
      forecastPop: 18,
      displayMode: "radar-nearby",
      displayLabel: /nearby/i,
      observed: false
    }
  };
}

export function highPopNoRadarFixture() {
  const data = forecast({
    precipitationProbability: [76, 78, 35],
    precipitation: [0.08, 0.12, 0.04],
    weatherCode: [61, 61, 95]
  });
  return {
    name: "high probability without radar evidence remains explicitly forecast guidance",
    data,
    truth: truth(data, {
      phase: "likely-this-hour",
      visualCode: 61,
      label: "Rain",
      source: "modeled-15-minute",
      confidence: "forecast",
      chance: 76,
      detail: "The near-term forecast calls for rain this hour."
    }, { code: 61, nowCode: 61, label: "Rain", source: "modeled-15-minute" }),
    expected: {
      forecastPop: 76,
      displayMode: "forecast-probability",
      displayLabel: /76%/i,
      observed: false
    }
  };
}

export function nwsThunderFixtures() {
  const wetData = forecast({ precipitationProbability: [64, 78, 35] });
  const dryData = forecast({
    precipitationProbability: [40, 78, 35],
    precipitation: [0, 0.12, 0.04],
    weatherCode: [61, 61, 95]
  });
  return [
    {
      name: "NWS thunder wording plus wet radar can be likely while rain remains the only observation",
      data: wetData,
      truth: truth(wetData, {
        phase: "active",
        visualCode: 61,
        label: "Light rain",
        source: "radar-current",
        confidence: "observed",
        chance: 64,
        detail: "Light rain is observed over this place now."
      }, {
        code: 95,
        nowCode: 95,
        label: "Thunderstorms likely",
        source: "nws-hourly-radar",
        convective: {
          level: "likely",
          label: "Thunderstorms likely",
          source: "nws-hourly-radar",
          basis: "forecast-supported"
        }
      }),
      expected: {
        code: 95,
        forecastPop: 64,
        displayMode: "observed-now",
        displayLabel: /rain now/i,
        observed: true,
        observationLabel: /rain/i
      }
    },
    {
      name: "NWS thunder wording without wet radar remains possible forecast evidence",
      data: dryData,
      truth: truth(dryData, {
        phase: "possible-this-hour",
        visualCode: 3,
        label: "Rain",
        source: "hourly-forecast",
        confidence: "forecast",
        chance: 40
      }, {
        code: 3,
        nowCode: 3,
        label: "Cloudy",
        source: "nws-hourly",
        convective: {
          level: "possible",
          label: "Thunder possible",
          source: "nws-hourly",
          basis: "forecast"
        }
      }),
      expected: {
        code: 3,
        forecastPop: 40,
        displayMode: "forecast-probability",
        observed: false
      }
    }
  ];
}

export function crossPlaceFixture() {
  const selectedData = forecast({
    placeId: "park-hills-mo",
    precipitationProbability: [4, 20, 30],
    weatherCode: [2, 3, 61],
    currentCode: 2
  });
  const foreignData = forecast({
    placeId: "maryville-il",
    precipitationProbability: [92, 85, 80],
    weatherCode: [65, 95, 95]
  });
  return {
    name: "a late radar truth from the prior place cannot repaint the newly selected place",
    selectedData,
    foreignTruth: truth(foreignData, {
      phase: "active",
      visualCode: 65,
      label: "Heavy rain",
      source: "radar-current",
      confidence: "observed",
      chance: 92
    }, { code: 65, nowCode: 65, label: "Heavy rain", source: "radar-current" }),
    expected: {
      forecastPop: 4,
      observed: false,
      excludesLabel: /rain/i
    }
  };
}

export const forecastTruthContractFixtures = [
  activeRadarLowPopFixture,
  radarClearHighPopFixture,
  nearbyRadarFixture,
  highPopNoRadarFixture
];
