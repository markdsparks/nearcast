const HOUR_MS = 60 * 60 * 1000;

export const confidenceNowMs = Date.parse("2026-08-19T15:00:00Z");
export const confidencePlace = {
  key: "39.100|-89.950",
  name: "Maryville, Illinois"
};

export const confidenceWindow = {
  startMs: Date.parse("2026-08-19T15:00:00Z"),
  endMs: Date.parse("2026-08-20T15:00:00Z")
};

export const confidenceClaim = {
  id: "precip:2026-08-19:0",
  kind: "precip-window",
  headline: "Rain likely this evening",
  startMs: Date.parse("2026-08-19T20:00:00Z"),
  endMs: Date.parse("2026-08-19T23:00:00Z")
};

function signal(id, options = {}) {
  const startMs = options.startMs ?? Date.parse("2026-08-19T20:00:00Z");
  const endMs = options.endMs ?? startMs + 3 * HOUR_MS;
  return {
    id,
    status: options.status || "ready",
    placeKey: options.placeKey || confidencePlace.key,
    issuedAtMs: options.issuedAtMs ?? confidenceNowMs - 20 * 60 * 1000,
    precipitation: options.precipitation === null ? null : {
      kind: options.kind || "rain",
      startMs,
      endMs
    },
    temperature: options.temperature === null ? null : {
      min: options.tempMin ?? 72,
      max: options.tempMax ?? 81
    },
    wind: options.wind === null ? null : {
      gustMax: options.gustMax ?? 19
    }
  };
}

export const confidenceContractFixtures = [
  {
    name: "three independent dry signals support a scoped dry window",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        id: "dry:2026-08-19:0",
        kind: "dry-window",
        headline: "Dry through early evening",
        startMs: confidenceNowMs,
        endMs: Date.parse("2026-08-19T19:00:00Z")
      },
      providerSignals: [
        signal("gfs", { precipitation: null }),
        signal("gem", { precipitation: null }),
        signal("icon", { precipitation: null })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: {
        placeKey: confidencePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: confidenceNowMs - 5 * 60 * 1000,
        phase: "clear"
      }
    },
    expected: {
      level: "high",
      agreementStatus: "aligned",
      providersUsed: 3,
      providersExpected: 3,
      observationStatus: "confirmed",
      summary: /dry|agree|align|guidance/i
    }
  },
  {
    name: "independent guidance converges on one usable rain window",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs", { startMs: Date.parse("2026-08-19T20:00:00Z"), tempMax: 81 }),
        signal("gem", { startMs: Date.parse("2026-08-19T20:30:00Z"), tempMax: 80 }),
        signal("icon", { startMs: Date.parse("2026-08-19T21:00:00Z"), tempMax: 82 })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "high",
      agreementStatus: "aligned",
      providersUsed: 3,
      providersExpected: 3,
      timingRangeMs: HOUR_MS,
      tempRange: 2,
      summary: /agree|align|around|between/i
    }
  },
  {
    name: "wide precipitation timing spread is described as uncertain",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs", { startMs: Date.parse("2026-08-19T18:00:00Z") }),
        signal("gem", { startMs: Date.parse("2026-08-19T21:00:00Z") }),
        signal("icon", { startMs: Date.parse("2026-08-19T23:00:00Z") })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "low",
      agreementStatus: "diverging",
      providersUsed: 3,
      providersExpected: 3,
      timingRangeMs: 5 * HOUR_MS,
      headline: /timing|uncertain|range/i
    }
  },
  {
    name: "models agreeing with each other but not the canonical time cannot earn high confidence",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs", { startMs: Date.parse("2026-08-20T03:00:00Z") }),
        signal("gem", { startMs: Date.parse("2026-08-20T03:30:00Z") }),
        signal("icon", { startMs: Date.parse("2026-08-20T04:00:00Z") })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "low",
      agreementStatus: "diverging",
      headline: /timing|uncertain/i,
      summary: /later|highlighted/i,
      limitations: /outside|timing window/i
    }
  },
  {
    name: "rain-only model guidance cannot claim high confidence in a thunderstorm identity",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        ...confidenceClaim,
        headline: "Storms likely this evening",
        canonical: { eventKind: "storm" }
      },
      providerSignals: [
        signal("gfs", { kind: "rain" }),
        signal("gem", { kind: "rain", startMs: Date.parse("2026-08-19T20:30:00Z") }),
        signal("icon", { kind: "rain", startMs: Date.parse("2026-08-19T21:00:00Z") })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "low",
      agreementStatus: "diverging",
      summary: /precipitation|thunderstorm/i,
      limitations: /exact storm type|precipitation timing|type/i
    }
  },
  {
    name: "forecast evolution reports a material later shift without false precision",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        ...confidenceClaim,
        startMs: Date.parse("2026-08-19T22:30:00Z"),
        endMs: Date.parse("2026-08-20T01:30:00Z")
      },
      providerSignals: [
        signal("gfs", { startMs: Date.parse("2026-08-19T22:00:00Z") }),
        signal("gem", { startMs: Date.parse("2026-08-19T22:30:00Z") }),
        signal("icon", { startMs: Date.parse("2026-08-19T23:00:00Z") })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [
        {
          placeKey: confidencePlace.key,
          checkedAtMs: confidenceNowMs - 6 * HOUR_MS,
          precipitationStartMs: Date.parse("2026-08-19T20:00:00Z")
        },
        {
          placeKey: confidencePlace.key,
          checkedAtMs: confidenceNowMs - 3 * HOUR_MS,
          precipitationStartMs: Date.parse("2026-08-19T20:30:00Z")
        }
      ],
      observation: null
    },
    expected: {
      evolutionStatus: "shifted",
      evolutionDirection: "later",
      evolutionDeltaMs: 2 * HOUR_MS,
      comparedRuns: 2,
      summary: /later|shift/i
    }
  },
  {
    name: "fresh radar can verify the forecast without pretending to observe lightning",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        ...confidenceClaim,
        startMs: confidenceNowMs - 30 * 60 * 1000,
        endMs: confidenceNowMs + 2 * HOUR_MS
      },
      providerSignals: [
        signal("gfs", {
          kind: "rain",
          startMs: confidenceNowMs - 30 * 60 * 1000,
          endMs: confidenceNowMs + 2 * HOUR_MS
        }),
        signal("gem", {
          kind: "rain",
          startMs: confidenceNowMs,
          endMs: confidenceNowMs + 2 * HOUR_MS
        })
      ],
      expectedProviders: ["gfs", "gem"],
      history: [],
      observation: {
        placeKey: confidencePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: confidenceNowMs - 5 * 60 * 1000,
        phase: "active-rain"
      }
    },
    expected: {
      observationStatus: "confirmed",
      observationSource: "radar",
      observationAgeMs: 5 * 60 * 1000,
      forbiddenText: /lightning observed|observed thunder/i
    }
  },
  {
    name: "fresh clear radar exposes a near-term mismatch instead of claiming confidence",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        ...confidenceClaim,
        startMs: confidenceNowMs - 30 * 60 * 1000,
        endMs: confidenceNowMs + HOUR_MS
      },
      providerSignals: [
        signal("gfs", { startMs: confidenceNowMs - HOUR_MS, endMs: confidenceNowMs + HOUR_MS }),
        signal("gem", { startMs: confidenceNowMs - 30 * 60 * 1000, endMs: confidenceNowMs + HOUR_MS })
      ],
      expectedProviders: ["gfs", "gem"],
      history: [],
      observation: {
        placeKey: confidencePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: confidenceNowMs - 4 * 60 * 1000,
        phase: "clear"
      }
    },
    expected: {
      level: "low",
      observationStatus: "conflict",
      limitations: /radar|observation|not.*confirm|mismatch/i
    }
  },
  {
    name: "delayed radar is disclosed but cannot verify the current forecast",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: {
        ...confidenceClaim,
        startMs: confidenceNowMs - 30 * 60 * 1000,
        endMs: confidenceNowMs + HOUR_MS
      },
      providerSignals: [
        signal("gfs", { startMs: confidenceNowMs - 30 * 60 * 1000, endMs: confidenceNowMs + HOUR_MS }),
        signal("gem", { startMs: confidenceNowMs, endMs: confidenceNowMs + HOUR_MS }),
        signal("icon", { startMs: confidenceNowMs, endMs: confidenceNowMs + 2 * HOUR_MS })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: {
        placeKey: confidencePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: confidenceNowMs - 20 * 60 * 1000,
        phase: "active-rain"
      }
    },
    expected: {
      observationStatus: "delayed",
      observationSource: "radar",
      observationAgeMs: 20 * 60 * 1000,
      limitations: /radar|delay|old|minute/i
    }
  },
  {
    name: "partial provider failure is explicit and cannot earn high confidence",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs"),
        signal("gem", { status: "failed", precipitation: null, temperature: null, wind: null }),
        signal("icon", { status: "stale" })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      allowedLevels: ["low"],
      agreementStatus: "limited",
      providersUsed: 1,
      providersExpected: 3,
      limitations: /source|provider|guidance|available|stale/i
    }
  },
  {
    name: "two aligned independent models are capped at medium confidence",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs"),
        signal("gem", { startMs: Date.parse("2026-08-19T20:30:00Z") }),
        signal("icon", { status: "failed", precipitation: null, temperature: null, wind: null })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "medium",
      agreementStatus: "limited",
      providersUsed: 2,
      providersExpected: 3,
      limitations: /source|provider|guidance|available/i
    }
  },
  {
    name: "a saved canonical forecast cannot be labeled high confidence",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      canonical: { cacheFallback: true },
      providerSignals: [
        signal("gfs"),
        signal("gem", { startMs: Date.parse("2026-08-19T20:30:00Z") }),
        signal("icon", { startMs: Date.parse("2026-08-19T21:00:00Z") })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "medium",
      agreementStatus: "aligned",
      providersUsed: 3,
      providersExpected: 3,
      limitations: /saved|cache|live refresh/i
    }
  },
  {
    name: "no usable provider guidance returns unavailable rather than synthetic certainty",
    input: {
      nowMs: confidenceNowMs,
      place: confidencePlace,
      window: confidenceWindow,
      claim: confidenceClaim,
      providerSignals: [
        signal("gfs", { status: "failed", precipitation: null, temperature: null, wind: null }),
        signal("gem", { status: "missing", precipitation: null, temperature: null, wind: null }),
        signal("icon", { status: "failed", precipitation: null, temperature: null, wind: null })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: null
    },
    expected: {
      level: "unavailable",
      agreementStatus: "unavailable",
      providersUsed: 0,
      providersExpected: 3,
      limitations: /unavailable|not enough|could not compare/i
    }
  }
];

export const crossPlaceIsolationFixture = {
  base: {
    nowMs: confidenceNowMs,
    place: confidencePlace,
    window: confidenceWindow,
    claim: confidenceClaim,
    providerSignals: [
      signal("gfs"),
      signal("gem", { startMs: Date.parse("2026-08-19T20:30:00Z") })
    ],
    expectedProviders: ["gfs", "gem"],
    history: [{
      placeKey: confidencePlace.key,
      checkedAtMs: confidenceNowMs - 3 * HOUR_MS,
      precipitationStartMs: Date.parse("2026-08-19T20:00:00Z")
    }],
    observation: null
  },
  foreignSignal: signal("foreign-model", {
    placeKey: "38.620|-90.200",
    startMs: Date.parse("2026-08-20T06:00:00Z")
  }),
  foreignHistory: {
    placeKey: "38.620|-90.200",
    checkedAtMs: confidenceNowMs - HOUR_MS,
    precipitationStartMs: Date.parse("2026-08-20T09:00:00Z")
  },
  foreignObservation: {
    placeKey: "38.620|-90.200",
    status: "ready",
    source: "radar",
    observedAtMs: confidenceNowMs - 2 * 60 * 1000,
    phase: "active-rain"
  }
};

export const confidenceForbiddenKeys = [
  "score",
  "confidenceScore",
  "confidencePercent",
  "probability",
  "probabilityPercent"
];
