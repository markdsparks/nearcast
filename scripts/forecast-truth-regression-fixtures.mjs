const hour = 60 * 60 * 1000;

export const hourBoundaryFixtures = [
  {
    name: "the current hourly row remains live immediately before the boundary",
    currentTime: "2026-08-14T10:59:59",
    hourlyTimes: [
      "2026-08-14T10:00",
      "2026-08-14T11:00",
      "2026-08-14T12:00"
    ],
    expectedIndex: 0,
    expectedCurrentFlags: [true, false, false]
  },
  {
    name: "the new hourly row becomes live exactly on the boundary",
    currentTime: "2026-08-14T11:00:00",
    hourlyTimes: [
      "2026-08-14T10:00",
      "2026-08-14T11:00",
      "2026-08-14T12:00"
    ],
    expectedIndex: 1,
    expectedCurrentFlags: [false, true, false]
  },
  {
    name: "the live clock advances the current marker after a retained response",
    currentTime: "2026-08-14T10:48:00",
    wallTime: "2026-08-14T11:05:00",
    hourlyTimes: [
      "2026-08-14T10:00",
      "2026-08-14T11:00",
      "2026-08-14T12:00"
    ],
    expectedIndex: 1,
    expectedCurrentFlags: [false, true, false]
  }
];

export const sourceTaxonomyFixtures = [
  {
    name: "NWS thunder wording plus active radar is likely, not observed lightning",
    display: {
      code: 95,
      rawCode: 61,
      pop: 80,
      hourlyIndex: 0,
      convective: {
        level: "likely",
        source: "nws-hourly-radar",
        shortForecast: "Showers And Thunderstorms"
      }
    },
    nowPrecip: { isWetNow: true },
    precipTruth: {
      phase: "active",
      visualCode: 61,
      label: "Light rain",
      source: "radar-current",
      confidence: "observed"
    },
    expected: { source: "nws-hourly-radar", confidence: "likely", short: /thunderstorms likely.*nws.*radar/i }
  },
  {
    name: "radar-observed rain outranks the model",
    display: { code: 61, rawCode: 3, pop: 8, hourlyIndex: 0 },
    nowPrecip: { isWetNow: true },
    precipTruth: {
      phase: "active",
      visualCode: 61,
      label: "Light rain",
      source: "radar-current",
      confidence: "observed"
    },
    expected: { source: "radar-current", confidence: "observed", short: /radar/i }
  },
  {
    name: "15-minute current precipitation remains model-nowcast truth",
    display: { code: 61, rawCode: 61, pop: 80, hourlyIndex: 0 },
    nowPrecip: { isWetNow: true, nowcast: {} },
    precipTruth: {
      phase: "active",
      visualCode: 61,
      label: "Light rain",
      source: "modeled-15-minute",
      confidence: "forecast"
    },
    expected: { source: "modeled-15-minute", confidence: "forecast", short: /15-minute forecast/i }
  },
  {
    name: "nearby radar never becomes rain over the selected place",
    display: { code: 2, rawCode: 2, pop: 25, hourlyIndex: 0 },
    nowPrecip: { isWetNow: false },
    precipTruth: {
      phase: "nearby",
      label: "Rain",
      detail: "Rain is close by on radar, but not over this place yet.",
      source: "radar-nearby",
      confidence: "nearby"
    },
    expected: { source: "radar-nearby", confidence: "nearby", short: /nearby.*radar/i }
  },
  {
    name: "a low-confidence precipitation code is identified as gated hourly data",
    display: { code: 3, rawCode: 61, pop: 4, hourlyIndex: 0 },
    nowPrecip: { isWetNow: false },
    precipTruth: { phase: "dry", source: "dry", confidence: "forecast" },
    expected: { source: "gated-hourly", confidence: "mixed", short: /low precip confidence/i }
  }
];

export const remainingDayFixture = {
  data: {
    utc_offset_seconds: 0,
    current: { time: "2026-08-14T14:00", temperature_2m: 82, apparent_temperature: 83, weather_code: 2, is_day: 1 },
    daily: {
      time: ["2026-08-13", "2026-08-14", "2026-08-15"],
      weather_code: [0, 2, 1],
      temperature_2m_max: [999, 88, 80],
      temperature_2m_min: [-99, 66, 62],
      precipitation_probability_max: [0, 10, 15],
      sunset: ["2026-08-13T20:00", "2026-08-14T20:00", "2026-08-15T19:59"]
    },
    hourly: {
      time: [
        "2026-08-14T14:00",
        "2026-08-14T15:00",
        "2026-08-14T16:00",
        "2026-08-14T17:00",
        "2026-08-14T18:00",
        "2026-08-14T19:00",
        "2026-08-14T20:00",
        "2026-08-14T21:00",
        "2026-08-14T22:00"
      ],
      temperature_2m: [82, 85, 88, 87, 84, 80, 76, 72, 69],
      apparent_temperature: [83, 86, 89, 88, 85, 81, 76, 72, 69],
      weather_code: [2, 2, 2, 2, 2, 2, 2, 2, 2],
      cloud_cover: [55, 55, 58, 58, 60, 62, 65, 65, 60],
      precipitation: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      precipitation_probability: [0, 0, 0, 5, 5, 10, 10, 10, 10],
      wind_speed_10m: [3, 4, 5, 5, 5, 4, 4, 3, 3],
      wind_gusts_10m: [5, 6, 7, 8, 8, 7, 6, 5, 5],
      is_day: [1, 1, 1, 1, 1, 1, 0, 0, 0]
    }
  },
  truth: { code: 2, isDay: true, display: { nowCode: 2 } },
  expected: {
    kicker: "This afternoon's outlook",
    text: /partly cloudy for the rest of the day.*cooling toward 62°F overnight/i,
    excludes: /999|-99/
  },
  daylightCases: [
    { time: "2026-08-14T19:00", isDay: true, expectedKicker: "This evening's outlook" },
    { time: "2026-08-14T19:00", isDay: false, expectedKicker: "Tonight's outlook" }
  ]
};

export const dailyPresentationFixtures = [
  {
    name: "elapsed rain does not define the rest of today's daily icon",
    now: "2026-08-14T14:30:00",
    dayIndex: 0,
    data: {
      utc_offset_seconds: 0,
      current: { time: "2026-08-14T14:30:00", temperature_2m: 78, weather_code: 1, is_day: 1 },
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weather_code: [61, 1],
        precipitation_probability_max: [85, 5],
        precipitation_sum: [0.6, 0]
      },
      hourly: {
        time: [
          "2026-08-14T08:00", "2026-08-14T09:00", "2026-08-14T10:00",
          "2026-08-14T14:00", "2026-08-14T15:00", "2026-08-14T16:00",
          "2026-08-14T17:00", "2026-08-14T18:00"
        ],
        temperature_2m: [68, 69, 70, 78, 79, 79, 77, 75],
        apparent_temperature: [68, 69, 70, 78, 79, 79, 77, 75],
        weather_code: [61, 63, 61, 1, 1, 1, 1, 1],
        cloud_cover: [95, 95, 90, 24, 22, 20, 20, 25],
        precipitation_probability: [85, 80, 70, 5, 5, 5, 5, 5],
        precipitation: [0.2, 0.25, 0.15, 0, 0, 0, 0, 0],
        wind_speed_10m: [7, 8, 8, 6, 6, 5, 5, 4],
        wind_gusts_10m: [12, 14, 13, 9, 9, 8, 8, 7],
        is_day: [1, 1, 1, 1, 1, 1, 1, 1]
      }
    },
    elapsedIndices: [0, 1, 2],
    expected: {
      code: 1,
      family: "partly-cloudy",
      timing: "",
      precipPrimary: false,
      precipSustained: false,
      precipNote: ""
    }
  },
  {
    name: "one low-POP modeled amount remains a low rain cue instead of the daily icon",
    now: "2026-08-14T14:00:00",
    dayIndex: 1,
    data: {
      utc_offset_seconds: 0,
      current: { time: "2026-08-14T14:00:00", temperature_2m: 80, weather_code: 2, is_day: 1 },
      current_units: { precipitation: "inch" },
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weather_code: [2, 61],
        precipitation_probability_max: [5, 21],
        precipitation_sum: [0, 0.15]
      },
      hourly: {
        time: [
          "2026-08-15T08:00", "2026-08-15T09:00", "2026-08-15T10:00",
          "2026-08-15T11:00", "2026-08-15T12:00", "2026-08-15T13:00"
        ],
        temperature_2m: [67, 70, 73, 75, 77, 79],
        apparent_temperature: [67, 70, 73, 75, 77, 79],
        weather_code: [2, 2, 2, 61, 2, 2],
        cloud_cover: [55, 58, 62, 70, 65, 58],
        precipitation_probability: [5, 8, 10, 21, 8, 5],
        precipitation: [0, 0, 0, 0.15, 0, 0],
        wind_speed_10m: [4, 5, 5, 6, 6, 5],
        wind_gusts_10m: [7, 8, 8, 10, 9, 8],
        is_day: [1, 1, 1, 1, 1, 1]
      }
    },
    expected: {
      code: 2,
      family: "partly-cloudy",
      timing: "",
      precipPrimary: false,
      precipSustained: false,
      precipAmountPrimary: false,
      precipNote: "Low rain chance"
    }
  },
  {
    name: "sustained afternoon storms remain the daily identity with timing",
    now: "2026-08-14T14:00:00",
    dayIndex: 1,
    data: {
      utc_offset_seconds: 0,
      current: { time: "2026-08-14T14:00:00", temperature_2m: 81, weather_code: 1, is_day: 1 },
      daily: {
        time: ["2026-08-14", "2026-08-15"],
        weather_code: [1, 95],
        precipitation_probability_max: [5, 80],
        precipitation_sum: [0, 0.7]
      },
      hourly: {
        time: [
          "2026-08-15T06:00", "2026-08-15T09:00", "2026-08-15T12:00",
          "2026-08-15T15:00", "2026-08-15T16:00", "2026-08-15T17:00",
          "2026-08-15T18:00"
        ],
        temperature_2m: [66, 72, 80, 84, 81, 78, 76],
        apparent_temperature: [66, 72, 82, 88, 84, 80, 77],
        weather_code: [1, 1, 2, 95, 95, 95, 3],
        cloud_cover: [20, 25, 50, 90, 95, 95, 85],
        precipitation_probability: [5, 8, 15, 70, 80, 65, 25],
        precipitation: [0, 0, 0, 0.15, 0.35, 0.2, 0],
        wind_speed_10m: [4, 5, 7, 12, 15, 13, 9],
        wind_gusts_10m: [7, 9, 12, 25, 32, 28, 18],
        is_day: [1, 1, 1, 1, 1, 1, 1]
      }
    },
    expected: {
      code: 95,
      family: "storm",
      timing: /Storms after 3 PM/i,
      precipPrimary: true,
      precipSustained: true,
      precipNote: ""
    }
  }
];

export const pmStormFixture = {
  name: "an afternoon storm callout names the first meaningful PM hour",
  hours: [
    { time: "2026-08-14T06:00", temp: 66, feels: 66, pop: 5, gust: 8, uv: 0, code: 0 },
    { time: "2026-08-14T10:00", temp: 77, feels: 79, pop: 10, gust: 10, uv: 5, code: 1 },
    { time: "2026-08-14T13:00", temp: 84, feels: 88, pop: 25, gust: 14, uv: 7, code: 2 },
    { time: "2026-08-14T16:00", temp: 82, feels: 86, pop: 65, gust: 28, uv: 3, code: 3, stormPotential: true },
    { time: "2026-08-14T19:00", temp: 75, feels: 76, pop: 45, gust: 20, uv: 0, code: 3 }
  ],
  expected: { signalLabel: "Storm timing", signalValue: /4 PM/i, text: /Storms.*near 4 PM/i }
};

export const snowLanguageFixture = {
  name: "snow remains snow in the canonical day story",
  hours: [
    { time: "2026-12-18T06:00", temp: 29, feels: 22, pop: 70, forecastPop: 70, popAvailable: true, gust: 18, uv: 0, code: 71 },
    { time: "2026-12-18T10:00", temp: 31, feels: 24, pop: 80, forecastPop: 80, popAvailable: true, gust: 21, uv: 1, code: 73 },
    { time: "2026-12-18T14:00", temp: 32, feels: 25, pop: 65, forecastPop: 65, popAvailable: true, gust: 22, uv: 1, code: 71 },
    { time: "2026-12-18T19:00", temp: 27, feels: 19, pop: 40, forecastPop: 40, popAvailable: true, gust: 19, uv: 0, code: 71 }
  ],
  expected: { text: /snow/i, excludes: /\brain\b/i }
};

export const staleCacheFixture = {
  savedAt: Date.UTC(2026, 7, 14, 12, 0, 0),
  checkedAt: Date.UTC(2026, 7, 14, 14, 30, 0),
  reason: "forecast-fetch-failed",
  expected: {
    source: "cache-fallback",
    cacheFallback: true,
    ageMs: 2.5 * hour,
    tone: "stale",
    headline: /Using an older saved forecast/i,
    trigger: /Using saved forecast/i,
    freshness: /Checked 3 hrs ago/i
  }
};

const dryRemoteForecast = {
  utc_offset_seconds: 0,
  current_units: { temperature_2m: "°F", precipitation: "inch" },
  current: {
    time: "2026-08-14T14:00",
    interval: 900,
    temperature_2m: 78,
    apparent_temperature: 78,
    relative_humidity_2m: 42,
    precipitation: 0,
    weather_code: 1,
    cloud_cover: 18,
    wind_speed_10m: 5,
    wind_gusts_10m: 8,
    wind_direction_10m: 180,
    is_day: 1
  },
  hourly: {
    time: [
      "2026-08-14T14:00", "2026-08-14T15:00", "2026-08-14T16:00",
      "2026-08-14T17:00", "2026-08-14T18:00"
    ],
    temperature_2m: [78, 79, 80, 79, 77],
    apparent_temperature: [78, 79, 80, 79, 77],
    relative_humidity_2m: [42, 41, 40, 42, 45],
    weather_code: [1, 1, 1, 1, 1],
    cloud_cover: [18, 16, 15, 18, 20],
    precipitation_probability: [0, 0, 0, 0, 0],
    precipitation: [0, 0, 0, 0, 0],
    wind_speed_10m: [5, 5, 6, 6, 5],
    wind_gusts_10m: [8, 8, 9, 9, 8],
    is_day: [1, 1, 1, 1, 1]
  },
  daily: {
    time: ["2026-08-14", "2026-08-15"],
    weather_code: [1, 1],
    temperature_2m_max: [80, 81],
    temperature_2m_min: [62, 63],
    precipitation_probability_max: [0, 0],
    precipitation_sum: [0, 0],
    uv_index_max: [6, 6],
    sunrise: ["2026-08-14T06:10", "2026-08-15T06:11"],
    sunset: ["2026-08-14T19:55", "2026-08-15T19:54"]
  }
};

export const crossPlaceTruthFixture = {
  activeForecast: { placeKey: "active-place" },
  activePlace: { id: "active-place", name: "Rain City" },
  activeRadar: {
    phase: "active",
    confidence: "observed",
    intensity: "moderate",
    placeId: "active-place"
  },
  remoteForecast: dryRemoteForecast,
  remotePlace: { id: "remote-place", name: "Dry Town" },
  expected: {
    dailyCode: 1,
    dailyFamily: "partly-cloudy",
    aiSky: "Mostly clear",
    aiNowcast: /no precipitation/i,
    forbiddenSource: "radar-current"
  }
};

export const activePrecipAiFixture = {
  forecast: dryRemoteForecast,
  place: { id: "active-rain-place", name: "Rain City" },
  truth: {
    code: 61,
    nowCode: 61,
    sceneCode: 61,
    label: "Light rain",
    isDay: true,
    rainChance: 100,
    nowPrecip: { isWetNow: true, code: 61, label: "Light rain", source: "radar-current" },
    precip: {
      phase: "active",
      isWetNow: true,
      label: "Light rain",
      visualCode: 61,
      source: "radar-current",
      basis: "observed"
    },
    source: "radar-current"
  },
  expected: {
    nowcast: /rain.*(?:now|observed)/i,
    excludes: /dry/i
  }
};
