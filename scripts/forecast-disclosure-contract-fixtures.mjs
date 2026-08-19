const HOUR_MS = 60 * 60 * 1000;

export const disclosureNowMs = Date.parse("2026-08-19T15:00:00Z");
export const disclosurePlace = {
  key: "39.100|-89.950",
  name: "Maryville, Illinois"
};

export const disclosureClaim = {
  id: "precip:2026-08-19:0",
  kind: "precip-window",
  headline: "Rain likely this evening",
  startMs: Date.parse("2026-08-19T20:00:00Z"),
  endMs: Date.parse("2026-08-19T23:00:00Z")
};

const windClaim = {
  id: "wind:2026-08-19:0",
  kind: "wind",
  headline: "Wind picks up late this afternoon",
  startMs: Date.parse("2026-08-19T18:00:00Z"),
  endMs: Date.parse("2026-08-19T20:00:00Z"),
  canonical: { eventKind: "wind", windUnit: "mph" }
};

function confidence(options = {}) {
  const status = options.status || "aligned";
  const level = options.level || (status === "aligned" ? "high" : status === "mixed" ? "medium" : "low");
  const claim = options.claim || disclosureClaim;
  return {
    version: 1,
    generatedAtMs: disclosureNowMs,
    placeKey: disclosurePlace.key,
    window: {
      startMs: claim.startMs,
      endMs: claim.endMs
    },
    claim,
    level,
    headline: "Technical comparison",
    summary: "Technical comparison detail.",
    evidence: {
      agreement: {
        status,
        providersUsed: options.providersUsed ?? 3,
        providersExpected: options.providersExpected ?? 3,
        typeSupportCount: options.typeSupportCount ?? 3,
        expectedEventKind: options.expectedEventKind || "rain",
        timingStartMs: options.timingStartMs ?? claim.startMs,
        timingEndMs: options.timingEndMs ?? claim.startMs
      },
      evolution: {
        status: options.evolutionStatus || "stable",
        direction: options.evolutionDirection || null,
        deltaMs: options.evolutionDeltaMs ?? null,
        comparedRuns: options.comparedRuns ?? 2
      },
      observation: {
        status: options.observationStatus || "unavailable",
        source: options.observationSource || null,
        ageMs: options.observationAgeMs ?? null
      }
    },
    limitations: []
  };
}

export const disclosureContractFixtures = [
  {
    name: "aligned guidance stays silent and precise",
    input: {
      confidence: confidence()
    },
    expected: {
      mode: "silent",
      precision: "exact",
      actionable: false,
      reason: "settled",
      qualifier: null,
      technicalAvailable: true,
      timingStartMs: disclosureClaim.startMs,
      timingEndMs: disclosureClaim.endMs
    }
  },
  {
    name: "ordinary mixed timing broadens to a range without a warning",
    input: {
      confidence: confidence({
        status: "mixed",
        level: "medium",
        timingStartMs: disclosureClaim.startMs - HOUR_MS,
        timingEndMs: disclosureClaim.startMs + 2 * HOUR_MS
      })
    },
    expected: {
      mode: "soften",
      precision: "range",
      actionable: false,
      reason: "timing-varies",
      qualifier: null,
      technicalAvailable: true,
      timingStartMs: disclosureClaim.startMs - HOUR_MS,
      timingEndMs: disclosureClaim.startMs + 2 * HOUR_MS
    }
  },
  {
    name: "wind timing cannot inherit a precipitation onset range",
    input: {
      confidence: confidence({
        claim: windClaim,
        status: "mixed",
        level: "medium",
        expectedEventKind: "wind",
        timingStartMs: disclosureClaim.startMs,
        timingEndMs: disclosureClaim.endMs
      })
    },
    expected: {
      mode: "soften",
      precision: "range",
      actionable: false,
      reason: "timing-varies",
      qualifier: null,
      technicalAvailable: true,
      timingStartMs: windClaim.startMs,
      timingEndMs: windClaim.endMs
    }
  },
  {
    name: "ordinary wide spread broadens to a daypart without a warning",
    input: {
      confidence: confidence({
        status: "diverging",
        level: "low",
        timingStartMs: disclosureClaim.startMs - 2 * HOUR_MS,
        timingEndMs: disclosureClaim.startMs + 5 * HOUR_MS
      })
    },
    expected: {
      mode: "soften",
      precision: "daypart",
      actionable: false,
      reason: "timing-varies",
      qualifier: null,
      technicalAvailable: true,
      timingStartMs: disclosureClaim.startMs - 2 * HOUR_MS,
      timingEndMs: disclosureClaim.startMs + 5 * HOUR_MS
    }
  },
  {
    name: "decision-sensitive wide spread becomes a concise caution",
    input: {
      confidence: confidence({
        status: "diverging",
        level: "low",
        timingStartMs: disclosureClaim.startMs - 2 * HOUR_MS,
        timingEndMs: disclosureClaim.startMs + 5 * HOUR_MS
      }),
      decisionSensitive: true
    },
    expected: {
      mode: "caution",
      precision: "daypart",
      actionable: true,
      reason: "timing-varies",
      qualifier: "Keep the timing flexible for this decision.",
      technicalAvailable: true
    }
  },
  {
    name: "a saved canonical forecast asks for a refresh",
    input: {
      confidence: confidence(),
      canonical: { cacheFallback: true }
    },
    expected: {
      mode: "interrupt",
      precision: "exact",
      actionable: true,
      reason: "saved-forecast",
      qualifier: "Refresh before making a weather-sensitive decision.",
      technicalAvailable: true
    }
  },
  {
    name: "an old canonical forecast asks for a refresh",
    input: {
      confidence: confidence(),
      canonical: { ageMs: 2 * HOUR_MS }
    },
    expected: {
      mode: "interrupt",
      precision: "exact",
      actionable: true,
      reason: "saved-forecast",
      qualifier: "Refresh before making a weather-sensitive decision.",
      technicalAvailable: true
    }
  },
  {
    name: "a canonical forecast marked stale asks for a refresh",
    input: {
      confidence: confidence(),
      canonical: { stale: true }
    },
    expected: {
      mode: "interrupt",
      precision: "exact",
      actionable: true,
      reason: "saved-forecast",
      qualifier: "Refresh before making a weather-sensitive decision.",
      technicalAvailable: true
    }
  },
  {
    name: "an official alert interrupts the calm forecast",
    input: {
      confidence: confidence(),
      officialAlert: true
    },
    expected: {
      mode: "interrupt",
      precision: "exact",
      actionable: true,
      reason: "official-alert",
      qualifier: "An official alert affects this forecast window.",
      technicalAvailable: true
    }
  },
  {
    name: "an alert check failure remains explicit",
    input: {
      confidence: confidence(),
      alertState: "failed"
    },
    expected: {
      mode: "interrupt",
      precision: "exact",
      actionable: true,
      reason: "alerts-unavailable",
      qualifier: "Official alerts could not be checked.",
      technicalAvailable: true
    }
  },
  {
    name: "unavailable supplemental guidance does not undermine a healthy forecast",
    input: {},
    expected: {
      mode: "silent",
      precision: "exact",
      actionable: false,
      reason: "comparison-unavailable",
      qualifier: null,
      technicalAvailable: false,
      timingStartMs: null,
      timingEndMs: null
    }
  }
];

function providerSignal(id, options = {}) {
  return {
    id,
    status: "ready",
    placeKey: disclosurePlace.key,
    issuedAtMs: disclosureNowMs - 20 * 60 * 1000,
    precipitation: options.precipitation === null ? null : {
      kind: "rain",
      startMs: options.startMs ?? disclosureClaim.startMs,
      endMs: options.endMs ?? disclosureClaim.endMs
    },
    temperature: { min: 72, max: 81 },
    wind: { gustMax: 18 }
  };
}

export const observationContractFixtures = [
  {
    name: "clear radar describes now without disproving active precipitation guidance",
    input: {
      nowMs: disclosureNowMs,
      place: disclosurePlace,
      window: {
        startMs: disclosureNowMs - HOUR_MS,
        endMs: disclosureNowMs + 3 * HOUR_MS
      },
      claim: {
        ...disclosureClaim,
        startMs: disclosureNowMs - 30 * 60 * 1000,
        endMs: disclosureNowMs + 2 * HOUR_MS
      },
      providerSignals: [
        providerSignal("gfs", {
          startMs: disclosureNowMs - 30 * 60 * 1000,
          endMs: disclosureNowMs + 2 * HOUR_MS
        }),
        providerSignal("gem", {
          startMs: disclosureNowMs,
          endMs: disclosureNowMs + 2 * HOUR_MS
        }),
        providerSignal("icon", {
          startMs: disclosureNowMs,
          endMs: disclosureNowMs + 2 * HOUR_MS
        })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: {
        placeKey: disclosurePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: disclosureNowMs - 4 * 60 * 1000,
        phase: "clear"
      }
    },
    expected: {
      observationStatus: "not-confirmed",
      forbiddenConfidenceText: /disagree|conflict|mismatch/i
    }
  },
  {
    name: "wet radar conflicts with an active dry claim",
    input: {
      nowMs: disclosureNowMs,
      place: disclosurePlace,
      window: {
        startMs: disclosureNowMs - HOUR_MS,
        endMs: disclosureNowMs + 3 * HOUR_MS
      },
      claim: {
        id: "dry:2026-08-19:0",
        kind: "dry-window",
        headline: "Dry through early evening",
        startMs: disclosureNowMs - HOUR_MS,
        endMs: disclosureNowMs + 3 * HOUR_MS
      },
      providerSignals: [
        providerSignal("gfs", { precipitation: null }),
        providerSignal("gem", { precipitation: null }),
        providerSignal("icon", { precipitation: null })
      ],
      expectedProviders: ["gfs", "gem", "icon"],
      history: [],
      observation: {
        placeKey: disclosurePlace.key,
        status: "ready",
        source: "radar",
        observedAtMs: disclosureNowMs - 4 * 60 * 1000,
        phase: "active-rain"
      }
    },
    expected: {
      observationStatus: "conflict"
    }
  }
];

export const forbiddenDisclosureLanguage = /High confidence|Some uncertainty|Timing uncertain|Forecast and radar disagree|Still shifting|guidance|model families|diverging/i;
