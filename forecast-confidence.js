(function initNearcastForecastConfidence(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.NearcastForecastConfidence = api;
    root.forecastConfidencePresentation = api.forecastConfidencePresentation;
    root.forecastDisclosurePresentation = api.forecastDisclosurePresentation;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createNearcastForecastConfidence() {
  "use strict";

  const HOUR_MS = 60 * 60 * 1000;
  const OBSERVATION_FRESH_MS = 15 * 60 * 1000;
  const OBSERVATION_DELAYED_MS = 35 * 60 * 1000;
  const PRECIP_KINDS = new Set(["precip", "precipitation", "precip-window", "rain", "storm", "snow"]);

  function finite(value) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function median(values) {
    const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function range(values) {
    const clean = values.map(finite).filter((value) => value !== null);
    return clean.length ? Math.max(...clean) - Math.min(...clean) : null;
  }

  function normalizePlaceKey(place) {
    return String(place?.key || place?.placeKey || "").trim();
  }

  function normalizeWindow(window, claim, nowMs) {
    const startMs = finite(window?.startMs) ?? finite(claim?.startMs) ?? nowMs;
    const endMs = finite(window?.endMs) ?? finite(claim?.endMs) ?? (startMs + 24 * HOUR_MS);
    return { startMs, endMs: Math.max(startMs, endMs) };
  }

  function normalizeClaim(claim, window) {
    const kind = String(claim?.kind || "forecast-window").trim().toLowerCase();
    return {
      id: String(claim?.id || `${kind}:${window.startMs}:${window.endMs}`),
      kind,
      headline: String(claim?.headline || "The highlighted forecast window").trim(),
      startMs: finite(claim?.startMs) ?? window.startMs,
      endMs: finite(claim?.endMs) ?? window.endMs,
      canonical: claim?.canonical && typeof claim.canonical === "object"
        ? {
            eventKind: String(claim.canonical.eventKind || "").toLowerCase(),
            windUnit: String(claim.canonical.windUnit || claim.canonical.unit || "").trim()
          }
        : null
    };
  }

  function overlaps(lhsStart, lhsEnd, rhsStart, rhsEnd) {
    const startA = finite(lhsStart);
    const endA = finite(lhsEnd);
    const startB = finite(rhsStart);
    const endB = finite(rhsEnd);
    if ([startA, endA, startB, endB].some((value) => value === null)) return false;
    return startA < endB && endA > startB;
  }

  function isPrecipClaim(claim) {
    const kind = String(claim?.kind || "");
    return PRECIP_KINDS.has(kind) || /rain|storm|snow|precip/i.test(kind);
  }

  function isDryClaim(claim) {
    return claim.kind === "dry-window" || /\bdry\b/i.test(claim.kind);
  }

  function precipitationFamily(value) {
    const kind = String(value || "").toLowerCase();
    if (/storm|thunder/.test(kind)) return "storm";
    if (/snow|sleet/.test(kind)) return "snow";
    if (/ice|freez/.test(kind)) return "ice";
    if (/rain|drizzle|shower|precip/.test(kind)) return "rain";
    return kind;
  }

  function signalSupportsEventKind(signal, claim) {
    if (!isPrecipClaim(claim) || !signal?.precipitation) return true;
    const expected = precipitationFamily(claim?.canonical?.eventKind);
    if (!expected || expected === "rain" || expected === "precip-window") return true;
    return precipitationFamily(signal.precipitation.kind) === expected;
  }

  function signalSupportsClaim(signal, claim) {
    const precip = signal?.precipitation;
    if (isDryClaim(claim)) {
      return !precip || !overlaps(precip.startMs, precip.endMs, claim.startMs, claim.endMs);
    }
    if (isPrecipClaim(claim)) {
      if (!precip) return false;
      const kind = String(precip.kind || "precipitation").toLowerCase();
      if (claim.kind === "snow" && !/snow|sleet|ice/.test(kind)) return false;
      return overlaps(
        finite(precip.startMs) ?? claim.startMs,
        finite(precip.endMs) ?? claim.endMs,
        claim.startMs - 6 * HOUR_MS,
        claim.endMs + 6 * HOUR_MS
      );
    }
    if (claim.kind === "temperature") return finite(signal?.temperature?.min) !== null || finite(signal?.temperature?.max) !== null;
    if (claim.kind === "wind") return finite(signal?.wind?.gustMax) !== null;
    return true;
  }

  function agreementForClaim(signals, expectedProviders, claim, window, nowMs) {
    const starts = signals.map((signal) => signal?.precipitation?.startMs).map(finite).filter((value) => value !== null);
    const precipitationTimingApplies = isPrecipClaim(claim);
    const tempMins = signals.map((signal) => signal?.temperature?.min).map(finite).filter((value) => value !== null);
    const tempMaxes = signals.map((signal) => signal?.temperature?.max).map(finite).filter((value) => value !== null);
    const gustValues = signals.map((signal) => signal?.wind?.gustMax).map(finite).filter((value) => value !== null);
    const supportCount = signals.filter((signal) => signalSupportsClaim(signal, claim)).length;
    const typeSupportCount = signals.filter((signal) => signalSupportsClaim(signal, claim) && signalSupportsEventKind(signal, claim)).length;
    const used = signals.length;
    // Precipitation onset is evidence only for precipitation claims. A wet
    // forecast must never move an unrelated wind or temperature event.
    const timingRangeMs = precipitationTimingApplies && starts.length >= 2 ? range(starts) : null;
    const medianStartMs = precipitationTimingApplies && starts.length ? median(starts) : null;
    const canonicalDeltaMs = medianStartMs === null ? null : medianStartMs - Number(claim.startMs);
    const comparableTempRanges = [range(tempMins), range(tempMaxes)].filter((value) => value !== null);
    const tempRange = comparableTempRanges.length ? Math.max(...comparableTempRanges) : null;
    const gustRange = gustValues.length >= 2 ? range(gustValues) : null;
    const leadMs = Math.max(0, Number(claim.startMs) - Number(nowMs));
    const nearTerm = leadMs < 24 * HOUR_MS;
    const alignedTimingMs = nearTerm ? 2 * HOUR_MS : 4 * HOUR_MS;
    const mixedTimingMs = nearTerm ? 4 * HOUR_MS : 6 * HOUR_MS;
    let status = "unavailable";

    if (used) {
      if (used < expectedProviders.length) status = "limited";
      else if (isPrecipClaim(claim)) {
        if (supportCount !== used || starts.length !== used) status = "diverging";
        else if ((timingRangeMs ?? 0) <= alignedTimingMs && Math.abs(canonicalDeltaMs ?? 0) <= alignedTimingMs) status = "aligned";
        else if ((timingRangeMs ?? 0) <= mixedTimingMs && Math.abs(canonicalDeltaMs ?? 0) <= mixedTimingMs) status = "mixed";
        else status = "diverging";
        if (status === "aligned" && typeSupportCount < used) status = typeSupportCount >= Math.ceil(used / 2) ? "mixed" : "diverging";
      } else if (isDryClaim(claim)) {
        status = supportCount === used ? "aligned" : supportCount >= Math.ceil(used / 2) ? "mixed" : "diverging";
      } else if (claim.kind === "temperature") {
        status = (tempRange ?? Infinity) <= (nearTerm ? 4 : 6) ? "aligned" : tempRange <= 8 ? "mixed" : "diverging";
      } else if (claim.kind === "wind") {
        status = (gustRange ?? Infinity) <= (nearTerm ? 8 : 12) ? "aligned" : gustRange <= (nearTerm ? 16 : 20) ? "mixed" : "diverging";
      } else {
        status = supportCount === used ? "aligned" : "mixed";
      }
    }

    return {
      status,
      providersUsed: used,
      providersExpected: expectedProviders.length,
      providerIds: signals.map((signal) => String(signal.id || "guidance")),
      supportCount,
      typeSupportCount,
      expectedEventKind: precipitationFamily(claim?.canonical?.eventKind) || null,
      timingRangeMs,
      timingToleranceMs: alignedTimingMs,
      timingStartMs: precipitationTimingApplies && starts.length ? Math.min(...starts) : null,
      timingEndMs: precipitationTimingApplies && starts.length ? Math.max(...starts) : null,
      canonicalDeltaMs,
      tempRange,
      windRange: gustRange,
      gustRange,
      wetVotes: signals.filter((signal) => Boolean(signal?.precipitation)).length,
      totalVotes: used
    };
  }

  function evolutionForClaim(history, placeKey, claim, agreement) {
    const relevant = (Array.isArray(history) ? history : [])
      .filter((item) => String(item?.placeKey || "") === placeKey)
      .filter((item) => finite(item?.checkedAtMs ?? item?.checkedAt) !== null)
      .sort((a, b) => finite(a.checkedAtMs ?? a.checkedAt) - finite(b.checkedAtMs ?? b.checkedAt));
    // Evolution compares Nearcast's canonical claim across runs. Model-family
    // agreement is separate evidence and must never masquerade as a change in
    // the canonical forecast itself.
    const currentStart = finite(claim.startMs);
    const previous = relevant
      .map((item) => finite(item.precipitationStartMs ?? item.precipStartMs ?? item.eventStartMs))
      .filter((value) => value !== null)
      .at(-1);

    if (!isPrecipClaim(claim) || previous === undefined || currentStart === null) {
      return { status: "learning", direction: null, deltaMs: null, comparedRuns: relevant.length };
    }
    const deltaMs = currentStart - previous;
    if (Math.abs(deltaMs) < 90 * 60 * 1000) {
      return { status: "stable", direction: null, deltaMs, comparedRuns: relevant.length };
    }
    return {
      status: "shifted",
      direction: deltaMs > 0 ? "later" : "earlier",
      deltaMs,
      comparedRuns: relevant.length
    };
  }

  function observationForClaim(observation, placeKey, claim, nowMs) {
    if (!observation || String(observation.placeKey || "") !== placeKey) {
      return { status: "unavailable", source: null, ageMs: null };
    }
    const observedAtMs = finite(observation.observedAtMs);
    const ageMs = observedAtMs === null ? null : Math.max(0, nowMs - observedAtMs);
    if (observation.status !== "ready" || ageMs === null || ageMs > OBSERVATION_DELAYED_MS) {
      return { status: "unavailable", source: observation.source || null, ageMs };
    }
    if (ageMs > OBSERVATION_FRESH_MS) {
      return { status: "delayed", source: observation.source || null, ageMs };
    }
    const phase = String(observation.phase || "").toLowerCase();
    const active = /active|rain|snow|precip/.test(phase) && !/clear/.test(phase);
    const clear = /clear|dry/.test(phase);
    const claimActiveNow = claim.startMs <= nowMs && claim.endMs > nowMs;
    if (isPrecipClaim(claim) && claimActiveNow) {
      if (active) return { status: "confirmed", source: observation.source || "radar", ageMs };
      // A clear radar frame says what is happening now; it cannot disprove a
      // forecast event that may begin later in the highlighted window. Keep
      // that distinction as evidence instead of manufacturing a conflict.
      if (clear) return { status: "not-confirmed", source: observation.source || "radar", ageMs };
    }
    if (isDryClaim(claim) && claimActiveNow && clear) return { status: "confirmed", source: observation.source || "radar", ageMs };
    if (isDryClaim(claim) && claimActiveNow && active) return { status: "conflict", source: observation.source || "radar", ageMs };
    return { status: "not-applicable", source: observation.source || "radar", ageMs };
  }

  function confidenceLevel(agreement, evolution, observation, options = {}) {
    if (!agreement.providersUsed) return "unavailable";
    if (observation.status === "conflict" || agreement.status === "diverging") return "low";
    if (agreement.providersUsed < agreement.providersExpected || agreement.providersUsed < 3) return agreement.providersUsed >= 2 ? "medium" : "low";
    if (agreement.status === "mixed" || evolution.status === "shifted" || options.cacheFallback || options.guidanceStatus === "stale") return "medium";
    return agreement.status === "aligned" ? "high" : "medium";
  }

  function durationPhrase(ms) {
    const hours = Math.round(Math.abs(Number(ms) || 0) / HOUR_MS);
    if (!hours) return "less than an hour";
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  function headlineFor(level, agreement, observation, evolution) {
    if (level === "unavailable") return "Confidence unavailable";
    if (observation.status === "conflict") return "Forecast and radar disagree";
    if (
      agreement.typeSupportCount < agreement.providersUsed &&
      ["storm", "snow", "ice"].includes(agreement.expectedEventKind)
    ) {
      return agreement.expectedEventKind === "storm" ? "Storm confidence limited" : "Precipitation type uncertain";
    }
    if (agreement.status === "diverging") return Number.isFinite(agreement.timingRangeMs) ? "Timing uncertain" : "Forecast still settling";
    if (evolution.status === "shifted") return `Forecast shifted ${evolution.direction}`;
    if (level === "high") return "High confidence";
    if (level === "medium") return "Some uncertainty";
    return "Limited confidence";
  }

  function summaryFor(level, claim, agreement, evolution, observation) {
    if (level === "unavailable") return "Nearcast could not compare enough independent guidance for this forecast window.";
    if (observation.status === "conflict") return `Radar does not confirm ${claim.headline.toLowerCase()} right now.`;
    if (evolution.status === "shifted") {
      return `${claim.headline} shifted ${evolution.direction} by about ${durationPhrase(evolution.deltaMs)}.`;
    }
    if (isPrecipClaim(claim) && agreement.timingRangeMs !== null) {
      if (
        ["mixed", "diverging"].includes(agreement.status) &&
        Math.abs(Number(agreement.canonicalDeltaMs) || 0) > Number(agreement.timingToleranceMs || 2 * HOUR_MS)
      ) {
        const direction = agreement.canonicalDeltaMs > 0 ? "later" : "earlier";
        return `Independent guidance places this weather about ${durationPhrase(agreement.canonicalDeltaMs)} ${direction} than the highlighted time.`;
      }
      if (agreement.status === "aligned") return `${agreement.providersUsed} independent forecasts align on ${claim.headline.toLowerCase()}.`;
      if (agreement.typeSupportCount < agreement.providersUsed && ["storm", "snow", "ice"].includes(agreement.expectedEventKind)) {
        if (agreement.expectedEventKind === "storm") {
          return `${agreement.providersUsed} forecasts support precipitation near this time; ${agreement.typeSupportCount} also signal thunderstorms.`;
        }
        return `Guidance supports precipitation near this time but differs on whether it will be ${agreement.expectedEventKind}.`;
      }
      const noun = /storm|thunder/i.test(claim.headline) ? "Storm"
        : /snow|ice/i.test(claim.headline) ? "Wintry weather"
          : "Rain";
      return `${noun} start times differ by about ${durationPhrase(agreement.timingRangeMs)} across guidance.`;
    }
    if (isDryClaim(claim) && agreement.status === "aligned") return `${agreement.providersUsed} independent forecasts support ${claim.headline.toLowerCase()}.`;
    if (claim.kind === "temperature" && agreement.tempRange !== null) return `${claim.headline} spans about ${Math.round(agreement.tempRange)}° across guidance.`;
    if (claim.kind === "wind" && agreement.gustRange !== null) {
      const unit = claim?.canonical?.windUnit;
      return unit
        ? `${claim.headline} spans about ${Math.round(agreement.gustRange)} ${unit} across guidance.`
        : "Models differ on the strongest gusts during this window.";
    }
    return `${agreement.supportCount} of ${agreement.providersUsed} available forecasts support ${claim.headline.toLowerCase()}.`;
  }

  function forecastConfidencePresentation(options) {
    const nowMs = finite(options?.nowMs) ?? Date.now();
    const placeKey = normalizePlaceKey(options?.place);
    const roughWindow = normalizeWindow(options?.window, options?.claim, nowMs);
    const claim = normalizeClaim(options?.claim, roughWindow);
    const window = normalizeWindow(roughWindow, claim, nowMs);
    const expectedProviders = [...new Set((options?.expectedProviders || ["gfs", "gem", "icon"]).map(String))];
    const signals = (Array.isArray(options?.providerSignals) ? options.providerSignals : [])
      .filter((signal) => String(signal?.placeKey || "") === placeKey)
      .filter((signal) => signal?.status === "ready")
      .filter((signal) => expectedProviders.includes(String(signal?.id || "")))
      .sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
    const agreement = agreementForClaim(signals, expectedProviders, claim, window, nowMs);
    const evolution = evolutionForClaim(options?.history, placeKey, claim, agreement);
    const observation = observationForClaim(options?.observation, placeKey, claim, nowMs);
    const level = confidenceLevel(agreement, evolution, observation, {
      cacheFallback: Boolean(options?.canonical?.cacheFallback),
      guidanceStatus: String(options?.guidanceStatus || "")
    });
    const limitations = [];
    if (agreement.providersUsed < agreement.providersExpected) {
      limitations.push(`Only ${agreement.providersUsed} of ${agreement.providersExpected} independent guidance sources were available.`);
    }
    if (agreement.status === "mixed") limitations.push("Independent guidance supports the broad signal but differs on the exact timing or intensity.");
    if (agreement.status === "diverging") limitations.push("Available guidance does not agree closely on this forecast window.");
    if (
      ["mixed", "diverging"].includes(agreement.status) &&
      Math.abs(Number(agreement.canonicalDeltaMs) || 0) > Number(agreement.timingToleranceMs || 2 * HOUR_MS)
    ) {
      limitations.push("Independent guidance places the weather outside Nearcast's highlighted timing window.");
    }
    if (
      isPrecipClaim(claim) &&
      ["storm", "snow", "ice"].includes(agreement.expectedEventKind) &&
      agreement.typeSupportCount < agreement.providersUsed
    ) {
      limitations.push(`The model comparison agrees more strongly on precipitation timing than on the exact ${agreement.expectedEventKind} type.`);
    }
    if (evolution.status === "shifted") limitations.push(`The forecast moved ${evolution.direction} across recent updates.`);
    if (observation.status === "conflict") limitations.push("The latest radar observation does not confirm the near-term forecast at this place.");
    if (observation.status === "delayed") limitations.push("The latest observation is delayed and cannot verify what is happening now.");
    if (options?.canonical?.cacheFallback) limitations.push("Nearcast is using a saved canonical forecast while a live refresh is unavailable.");
    if (options?.guidanceStatus === "stale") limitations.push("The comparison uses earlier guidance because a live model comparison was unavailable.");
    if (!agreement.providersUsed) limitations.push("Not enough independent guidance was available to compare.");

    return {
      version: 1,
      generatedAtMs: nowMs,
      placeKey,
      window,
      claim,
      level,
      headline: headlineFor(level, agreement, observation, evolution),
      summary: summaryFor(level, claim, agreement, evolution, observation),
      evidence: { agreement, evolution, observation },
      limitations
    };
  }

  // Confidence is an internal editorial signal. Product surfaces consume this
  // smaller disclosure contract so ordinary model spread changes the precision
  // of the forecast instead of asking people to reconcile providers themselves.
  function forecastDisclosurePresentation(options = {}) {
    const confidence = options.confidence && typeof options.confidence === "object"
      ? options.confidence
      : null;
    const claim = confidence?.claim || options.claim || null;
    const agreement = confidence?.evidence?.agreement || {};
    const evolution = confidence?.evidence?.evolution || {};
    const observation = confidence?.evidence?.observation || {};
    const cacheFallback = Boolean(options?.canonical?.cacheFallback);
    const stale = Boolean(options?.canonical?.stale) || Number(options?.canonical?.ageMs) >= 90 * 60 * 1000;
    const officialAlert = Boolean(options.officialAlert);
    const alertCheckFailed = String(options.alertState || "") === "failed";
    const decisionSensitive = Boolean(options.decisionSensitive);
    const hazardRelevant = Boolean(options.hazardRelevant);
    const status = String(agreement.status || "unavailable");
    const shifted = evolution.status === "shifted";
    const observedConflict = observation.status === "conflict";
    const typeSpread = Number(agreement.providersUsed) > 0 &&
      Number(agreement.typeSupportCount) < Number(agreement.providersUsed) &&
      ["storm", "snow", "ice"].includes(String(agreement.expectedEventKind || ""));

    let mode = "silent";
    let precision = "exact";
    let actionable = false;
    let reason = "settled";
    let qualifier = null;

    if (officialAlert) {
      mode = "interrupt";
      actionable = true;
      reason = "official-alert";
      qualifier = "An official alert affects this forecast window.";
    } else if (cacheFallback || stale) {
      mode = "interrupt";
      actionable = true;
      reason = "saved-forecast";
      qualifier = "Refresh before making a weather-sensitive decision.";
    } else if (alertCheckFailed) {
      mode = "interrupt";
      actionable = true;
      reason = "alerts-unavailable";
      qualifier = "Official alerts could not be checked.";
    } else if (status === "diverging" || confidence?.level === "low") {
      mode = decisionSensitive || hazardRelevant ? "caution" : "soften";
      precision = "daypart";
      actionable = decisionSensitive || hazardRelevant;
      reason = typeSpread ? "weather-type-varies" : "timing-varies";
      qualifier = decisionSensitive
        ? "Keep the timing flexible for this decision."
        : typeSpread ? "Precipitation is more likely than one exact type." : null;
    } else if (status === "mixed" || confidence?.level === "medium" || shifted || observedConflict || typeSpread) {
      mode = decisionSensitive && (shifted || observedConflict || typeSpread) ? "caution" : "soften";
      precision = "range";
      actionable = mode === "caution";
      reason = observedConflict ? "conditions-changed"
        : shifted ? "timing-moved"
          : typeSpread ? "weather-type-varies" : "timing-varies";
      qualifier = actionable
        ? observedConflict ? "Current conditions may affect this decision."
          : shifted ? "The expected timing changed enough to affect this decision."
            : "Leave some flexibility around the start time."
        : null;
    } else if (!confidence || confidence.level === "unavailable") {
      // Supplemental comparison can be unavailable while the canonical
      // forecast remains healthy. That is not a user-facing failure.
      reason = "comparison-unavailable";
    }

    const comparisonTimingApplies = isPrecipClaim(claim);
    const timingStartMs = (comparisonTimingApplies ? finite(agreement.timingStartMs) : null) ?? finite(claim?.startMs);
    const timingEndMs = precision === "exact"
      ? (finite(claim?.endMs) ?? timingStartMs)
      : ((comparisonTimingApplies ? finite(agreement.timingEndMs) : null) ?? finite(claim?.endMs) ?? timingStartMs);

    return {
      version: 1,
      mode,
      precision,
      actionable,
      reason,
      qualifier,
      claim,
      window: confidence?.window || (claim ? { startMs: claim.startMs, endMs: claim.endMs } : null),
      timingStartMs,
      timingEndMs,
      technicalAvailable: Boolean(confidence)
    };
  }

  return {
    forecastConfidencePresentation,
    forecastDisclosurePresentation,
    agreementForClaim,
    evolutionForClaim,
    observationForClaim
  };
});
