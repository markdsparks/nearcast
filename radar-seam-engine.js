/*
 * Nearcast radar seam engine
 *
 * A small, pure motion-nowcast primitive for joining fresh MRMS textures to
 * model guidance without pretending the two products form one continuous
 * animation. The engine estimates one conservative translational motion
 * vector from recent observed frames, advects the latest observation through
 * +60 minutes, and can phase-align the first HRRR frame before gradually
 * releasing that correction.
 *
 * This is deliberately a classic script/CommonJS module so the PWA,
 * WKWebView, workers, and Node smoke tests can all use the same implementation.
 * It performs no I/O, owns no timers, never mutates input textures, and bounds
 * every search and allocation. Data-quality failures return `unavailable`
 * results with no synthetic frames (fail closed).
 */
(function installNearcastRadarSeam(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NearcastRadarSeam = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNearcastRadarSeamApi() {
  "use strict";

  const VERSION = "0.1.0";
  const DEFAULT_LEADS_MINUTES = Object.freeze([15, 30, 45, 60]);
  const MAX_TEXTURE_PIXELS = 1_048_576;
  const MAX_OBSERVED_FRAMES = 8;
  const MAX_OBSERVED_INPUT_FRAMES = 32;
  const MAX_FORECAST_FRAMES = 12;
  const MAX_SHIFT_PIXELS = 32;
  const MAX_LEAD_MINUTES = 90;
  const MAX_SAMPLES_PER_CANDIDATE = 6_000;
  const MIN_SIGNAL_PIXELS = 16;

  function estimateMotion(input = {}, options = {}) {
    const normalized = normalizeObservedInput(input, options);
    if (!normalized.ok) return unavailable(normalized.reason, normalized.details);
    const { frames, width, height, threshold } = normalized;
    const pairLimit = clampInteger(options.pairCount, 3, 1, MAX_OBSERVED_FRAMES - 1);
    const pairs = [];
    const selectedPairs = selectMotionFramePairs(frames, pairLimit, options);

    for (const selected of selectedPairs) {
      const older = selected.older;
      const newer = selected.newer;
      const intervalMinutes = (newer.timeMs - older.timeMs) / 60_000;
      if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 45) continue;
      const pair = estimatePairTranslation(older.data, newer.data, width, height, {
        ...options,
        threshold
      });
      if (pair.status !== "ready") continue;
      pairs.push(Object.freeze({
        ...pair,
        intervalMinutes,
        olderValidTime: older.validTime,
        newerValidTime: newer.validTime,
        velocityX: pair.dx / intervalMinutes,
        velocityY: pair.dy / intervalMinutes
      }));
    }

    const minimumPairs = clampInteger(options.minimumPairs, 1, 1, 3);
    if (pairs.length < minimumPairs) {
      return unavailable("insufficient-trackable-frame-pairs", {
        usablePairs: pairs.length,
        requiredPairs: minimumPairs
      });
    }

    // Longer, still-recent lags resolve slow sub-pixel motion more reliably
    // than adjacent ~5-minute MRMS pairs. The square-root weight avoids one
    // long pair overwhelming the consistency check.
    const weights = pairs.map((pair) =>
      Math.max(0.01, pair.confidence * Math.sqrt(pair.intervalMinutes / 10))
    );
    const velocityX = weightedMedian(pairs.map((pair) => pair.velocityX), weights);
    const velocityY = weightedMedian(pairs.map((pair) => pair.velocityY), weights);
    const speed = Math.hypot(velocityX, velocityY);
    const maximumVelocity = clampNumber(options.maximumVelocityPixelsPerMinute, 1.5, 0.05, 4);
    if (!Number.isFinite(speed) || speed > maximumVelocity) {
      return unavailable("motion-outside-safe-bounds", {
        speedPixelsPerMinute: finite(speed),
        maximumVelocityPixelsPerMinute: maximumVelocity
      });
    }

    let weightedResidual = 0;
    let weightTotal = 0;
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index];
      const residual = Math.hypot(
        pair.velocityX - velocityX,
        pair.velocityY - velocityY
      ) * pair.intervalMinutes;
      weightedResidual += residual * weights[index];
      weightTotal += weights[index];
    }
    const meanResidualPixels = weightTotal ? weightedResidual / weightTotal : Infinity;
    const residualAllowance = Math.max(0.75, speed * 8);
    const consistency = clamp01(1 - meanResidualPixels / (residualAllowance * 2));
    const pairConfidence = weightedMean(pairs.map((pair) => pair.confidence), weights);
    const confidence = clamp01(pairConfidence * (0.68 + consistency * 0.32));
    const minimumConfidence = clampNumber(options.minimumMotionConfidence, 0.5, 0.25, 0.9);

    if (consistency < clampNumber(options.minimumConsistency, 0.25, 0, 0.9)) {
      return unavailable("inconsistent-observed-motion", {
        consistency,
        meanResidualPixels,
        usablePairs: pairs.length
      });
    }
    if (confidence < minimumConfidence) {
      return unavailable("low-motion-confidence", { confidence, minimumConfidence });
    }

    const latest = frames[frames.length - 1];
    return Object.freeze({
      status: "ready",
      velocityX,
      velocityY,
      pixelsPerMinuteX: velocityX,
      pixelsPerMinuteY: velocityY,
      speedPixelsPerMinute: speed,
      directionDegrees: speed > 0.001
        ? normalizeDegrees(Math.atan2(velocityX, -velocityY) * 180 / Math.PI)
        : null,
      confidence,
      confidenceLevel: confidenceLevel(confidence),
      consistency,
      meanResidualPixels,
      observedSpanMinutes: Math.max(...pairs.map((pair) => pair.intervalMinutes)),
      observedFrameCount: normalized.usedFrameCount,
      discardedObservedFrameCount: normalized.inputFrameCount - normalized.usedFrameCount,
      anchorValidTime: latest.validTime,
      width,
      height,
      threshold,
      pairs: Object.freeze(pairs)
    });
  }

  function selectMotionFramePairs(frames, pairLimit, options) {
    const latest = frames[frames.length - 1];
    const configured = Array.isArray(options.motionLagMinutes)
      ? options.motionLagMinutes
      : [10, 20, 30];
    const desiredLags = [...new Set(configured
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 2 && value <= 45))]
      .sort((a, b) => a - b)
      .slice(0, pairLimit);
    const lags = desiredLags.length ? desiredLags : [10, 20, 30].slice(0, pairLimit);
    const tolerance = clampNumber(options.motionLagToleranceMinutes, 6, 1, 12);
    const selected = [];
    const usedTimes = new Set();

    for (const desiredLag of lags) {
      let best = null;
      for (let index = 0; index < frames.length - 1; index += 1) {
        const older = frames[index];
        const actualLag = (latest.timeMs - older.timeMs) / 60_000;
        if (actualLag <= 0 || actualLag > 45 || usedTimes.has(older.timeMs)) continue;
        const distance = Math.abs(actualLag - desiredLag);
        if (distance > tolerance || (best && distance >= best.distance)) continue;
        best = { older, newer: latest, actualLag, distance };
      }
      if (!best) continue;
      usedTimes.add(best.older.timeMs);
      selected.push(best);
    }

    // A short history should still be usable. Choose its longest valid pair
    // as a conservative fallback, while full histories remain anchored near
    // 10/20/30 minutes rather than consecutive frames.
    if (!selected.length && frames.length >= 2) {
      for (let index = 0; index < frames.length - 1; index += 1) {
        const actualLag = (latest.timeMs - frames[index].timeMs) / 60_000;
        if (actualLag > 0 && actualLag <= 45) {
          selected.push({ older: frames[index], newer: latest, actualLag, distance: 0 });
          break;
        }
      }
    }
    return selected.slice(0, pairLimit);
  }

  function generateNowcast(input = {}, options = {}) {
    const normalized = normalizeObservedInput(input, options);
    if (!normalized.ok) return unavailable(normalized.reason, normalized.details);
    const motion = input.motion?.status === "ready"
      ? validateSuppliedMotion(input.motion, normalized, options)
      : estimateMotion({ frames: normalized.frames }, options);
    if (motion.status !== "ready") return unavailable(motion.reason, motion.details);

    const latest = normalized.frames[normalized.frames.length - 1];
    const targets = normalizeTargets({
      targetValidTimes: input.targetValidTimes ?? options.targetValidTimes,
      leadsMinutes: input.leadsMinutes ?? options.leadsMinutes
    }, latest.timeMs);
    if (!targets.ok) return unavailable(targets.reason, targets.details);
    const maximumLead = targets.values[targets.values.length - 1].leadMinutes;
    const maximumDx = motion.velocityX * maximumLead;
    const maximumDy = motion.velocityY * maximumLead;
    const minimumCoverage = clampNumber(options.minimumAdvectedCoverage, 0.58, 0.35, 0.95);
    const maximumCoverage = translatedCoverage(
      normalized.width,
      normalized.height,
      maximumDx,
      maximumDy
    );
    if (maximumCoverage < minimumCoverage) {
      return unavailable("nowcast-leaves-observed-domain", {
        leadMinutes: maximumLead,
        coverage: maximumCoverage,
        minimumCoverage
      });
    }

    const frames = [];
    for (const target of targets.values) {
      const { leadMinutes, targetValidTime } = target;
      const dx = motion.velocityX * leadMinutes;
      const dy = motion.velocityY * leadMinutes;
      const coverage = translatedCoverage(normalized.width, normalized.height, dx, dy);
      const horizonFactor = 1 - 0.28 * (leadMinutes / maximumLead);
      const confidence = clamp01(motion.confidence * coverage * horizonFactor);
      frames.push(Object.freeze({
        kind: "observed-nowcast",
        provider: "nearcast-radar-seam",
        sourceProvider: "mrms-advection",
        validTime: targetValidTime,
        targetValidTime,
        anchorValidTime: latest.validTime,
        leadMinutes,
        width: normalized.width,
        height: normalized.height,
        data: translateTexture(latest.data, normalized.width, normalized.height, dx, dy, {
          interpolation: options.interpolation,
          intensityScale: 1
        }),
        displacementX: dx,
        displacementY: dy,
        coverage,
        confidence,
        confidenceLevel: confidenceLevel(confidence)
      }));
    }

    return Object.freeze({
      status: "ready",
      anchorValidTime: latest.validTime,
      motion,
      confidence: motion.confidence,
      confidenceLevel: motion.confidenceLevel,
      leadsMinutes: Object.freeze(targets.values.map((target) => target.leadMinutes)),
      targets: Object.freeze(targets.values),
      frames: Object.freeze(frames)
    });
  }

  function estimateForecastCorrection(input = {}, options = {}) {
    const normalized = normalizeCorrectionInput(input, options);
    if (!normalized.ok) return unavailable(normalized.reason, normalized.details);
    const { reference, forecast, width, height, threshold } = normalized;
    const translation = estimatePairTranslation(forecast.data, reference.data, width, height, {
      ...options,
      threshold,
      minimumPairScore: options.minimumAlignmentScore ?? 0.28,
      minimumPairConfidence: options.minimumAlignmentConfidence ?? 0.36
    });
    if (translation.status !== "ready") {
      return unavailable("forecast-alignment-unreliable", {
        alignmentReason: translation.reason,
        alignmentDetails: translation.details
      });
    }

    const intensity = estimateIntensityScale(
      forecast.data,
      reference.data,
      width,
      height,
      translation.dx,
      translation.dy,
      threshold,
      options
    );
    if (!intensity.ok) {
      return unavailable("forecast-intensity-overlap-insufficient", intensity.details);
    }

    const motion = input.motion?.status === "ready" ? input.motion : null;
    const speedSquared = motion
      ? motion.velocityX * motion.velocityX + motion.velocityY * motion.velocityY
      : 0;
    const phaseLagMinutes = speedSquared > 0.0001
      ? clampNumber(
        (translation.dx * motion.velocityX + translation.dy * motion.velocityY) / speedSquared,
        0,
        -MAX_LEAD_MINUTES,
        MAX_LEAD_MINUTES
      )
      : null;
    const confidence = clamp01(translation.confidence * (0.75 + intensity.confidence * 0.25));

    return Object.freeze({
      status: "ready",
      dx: translation.dx,
      dy: translation.dy,
      phaseOffsetX: translation.dx,
      phaseOffsetY: translation.dy,
      phaseLagMinutes,
      intensityScale: intensity.scale,
      confidence,
      confidenceLevel: confidenceLevel(confidence),
      overlap: translation.overlap,
      precipOverlap: translation.precipOverlap,
      score: translation.score,
      anchorValidTime: forecast.validTime,
      referenceValidTime: reference.validTime,
      width,
      height
    });
  }

  function applyForecastCorrection(input = {}, correction = {}, options = {}) {
    const frame = normalizeFrame(input.frame || input, "forecast", options);
    if (!frame.ok) return unavailable(frame.reason, frame.details);
    if (correction?.status !== "ready") {
      return unavailable("forecast-correction-unavailable");
    }
    if (![correction.dx, correction.dy, correction.intensityScale, correction.confidence].every(Number.isFinite)) {
      return unavailable("forecast-correction-values-invalid");
    }
    const anchorTimeMs = parseTime(correction.anchorValidTime);
    const validTimeMs = frame.frame.timeMs;
    if (!Number.isFinite(anchorTimeMs) || !Number.isFinite(validTimeMs)) {
      return unavailable("forecast-correction-time-invalid");
    }
    const decayMinutes = clampNumber(options.correctionDecayMinutes, 75, 15, 180);
    const elapsedMinutes = Math.max(0, (validTimeMs - anchorTimeMs) / 60_000);
    const decay = clamp01(1 - elapsedMinutes / decayMinutes);
    const dx = correction.dx * decay;
    const dy = correction.dy * decay;
    const intensityScale = 1 + (correction.intensityScale - 1) * decay;
    const data = decay <= 0.0001
      ? frame.frame.data
      : translateTexture(
        frame.frame.data,
        frame.frame.width,
        frame.frame.height,
        dx,
        dy,
        { interpolation: options.interpolation, intensityScale }
      );
    return Object.freeze({
      status: "ready",
      kind: "forecast-phase-corrected",
      provider: "nearcast-radar-seam",
      validTime: frame.frame.validTime,
      targetValidTime: frame.frame.validTime,
      width: frame.frame.width,
      height: frame.frame.height,
      data,
      correctionFactor: decay,
      displacementX: dx,
      displacementY: dy,
      intensityScale,
      confidence: clamp01(correction.confidence * (0.7 + decay * 0.3)),
      sourceFrame: input.frame || input
    });
  }

  function buildSeam(input = {}, options = {}) {
    const observedFrames = input.observedFrames || input.frames || [];
    const nowcast = generateNowcast({
      frames: observedFrames,
      leadsMinutes: input.leadsMinutes,
      targetValidTimes: input.targetValidTimes,
      motion: input.motion
    }, options);
    if (nowcast.status !== "ready") {
      return unavailable(nowcast.reason, nowcast.details);
    }

    const forecastFrames = normalizeForecastFrames(input.forecastFrames || [], options);
    let forecastCorrection = unavailable("forecast-not-provided");
    let correctedForecastFrames = Object.freeze([]);
    let compositeFrames = composeSeamFrames(nowcast.frames, [], forecastCorrection, options);
    let preferredFrames = compositeFrames;
    if (forecastFrames.ok && forecastFrames.frames.length) {
      const normalizedObserved = normalizeObservedInput({ frames: observedFrames }, options);
      const latestObservedMs = parseTime(nowcast.anchorValidTime);
      const maximumAnchorLead = clampNumber(options.maximumAlignmentLeadMinutes, 90, 5, MAX_LEAD_MINUTES);
      const anchorForecast = forecastFrames.frames.find((frame) => {
        const lead = (frame.timeMs - latestObservedMs) / 60_000;
        return lead >= 0 && lead <= maximumAnchorLead;
      });
      if (anchorForecast) {
        const anchorLead = (anchorForecast.timeMs - latestObservedMs) / 60_000;
        if (normalizedObserved.ok) {
          const latestObserved = normalizedObserved.frames[normalizedObserved.frames.length - 1];
          const forecastGridMatches = forecastFrames.frames.every((frame) =>
            frame.width === latestObserved.width && frame.height === latestObserved.height
          );
          if (!forecastGridMatches) {
            forecastCorrection = unavailable("forecast-grid-does-not-match-observed-grid");
          } else {
            const referenceData = translateTexture(
              latestObserved.data,
              latestObserved.width,
              latestObserved.height,
              nowcast.motion.velocityX * anchorLead,
              nowcast.motion.velocityY * anchorLead,
              { interpolation: options.interpolation, intensityScale: 1 }
            );
            forecastCorrection = estimateForecastCorrection({
              referenceFrame: {
                data: referenceData,
                width: latestObserved.width,
                height: latestObserved.height,
                validTime: anchorForecast.validTime
              },
              forecastFrame: anchorForecast,
              motion: nowcast.motion
            }, options);
            if (forecastCorrection.status === "ready") {
              const corrected = [];
              for (const frame of forecastFrames.frames) {
                const result = applyForecastCorrection({ frame }, forecastCorrection, options);
                if (result.status !== "ready") {
                  corrected.length = 0;
                  forecastCorrection = unavailable("forecast-correction-application-failed", {
                    validTime: frame.validTime,
                    reason: result.reason
                  });
                  break;
                }
                corrected.push(result);
              }
              correctedForecastFrames = Object.freeze(corrected);
              compositeFrames = composeSeamFrames(
                nowcast.frames,
                correctedForecastFrames,
                forecastCorrection,
                options
              );
              preferredFrames = mergePreferredFrames(compositeFrames, correctedForecastFrames);
            }
          }
        }
      } else {
        forecastCorrection = unavailable("forecast-anchor-outside-nowcast-window");
      }
    } else if (!forecastFrames.ok) {
      forecastCorrection = unavailable(forecastFrames.reason, forecastFrames.details);
    }

    return Object.freeze({
      status: "ready",
      anchorValidTime: nowcast.anchorValidTime,
      motion: nowcast.motion,
      nowcastFrames: nowcast.frames,
      targets: nowcast.targets,
      forecastCorrection,
      correctedForecastFrames,
      compositeFrames,
      preferredFrames,
      handoffFrames: preferredFrames,
      confidence: nowcast.confidence,
      confidenceLevel: nowcast.confidenceLevel
    });
  }

  function mergePreferredFrames(compositeFrames, correctedForecastFrames) {
    const byTime = new Map();
    for (const frame of correctedForecastFrames) byTime.set(parseTime(frame.validTime), frame);
    for (const frame of compositeFrames) byTime.set(parseTime(frame.validTime), frame);
    return Object.freeze([...byTime.values()].sort((a, b) => parseTime(a.validTime) - parseTime(b.validTime)));
  }

  function composeSeamFrames(nowcastFrames = [], correctedForecastFrames = [], correction = {}, options = {}) {
    if (!Array.isArray(nowcastFrames) || nowcastFrames.length > 6) {
      throw codedError("RADAR_SEAM_NOWCAST_FRAMES_INVALID", "Nowcast frames exceed the seam composition budget.");
    }
    if (!Array.isArray(correctedForecastFrames) || correctedForecastFrames.length > MAX_FORECAST_FRAMES) {
      throw codedError("RADAR_SEAM_FORECAST_FRAMES_INVALID", "Forecast frames exceed the seam composition budget.");
    }
    const forecastByTime = new Map(correctedForecastFrames.map((frame) => [parseTime(frame.validTime), frame]));
    const blendStart = clampNumber(options.forecastBlendStartMinutes, 15, 0, MAX_LEAD_MINUTES - 1);
    const blendComplete = Math.max(
      blendStart + 1,
      clampNumber(options.forecastBlendCompleteMinutes, 75, blendStart + 1, 180)
    );
    return Object.freeze(nowcastFrames.map((observedFrame) => {
      const forecastFrame = forecastByTime.get(parseTime(observedFrame.targetValidTime || observedFrame.validTime));
      const forecastWeight = forecastFrame
        ? smoothstep(clamp01((observedFrame.leadMinutes - blendStart) / (blendComplete - blendStart)))
        : 0;
      const observedWeight = 1 - forecastWeight;
      const width = observedFrame.width;
      const height = observedFrame.height;
      const data = forecastFrame
        ? blendTextures(observedFrame.data, forecastFrame.data, width, height, forecastWeight)
        : observedFrame.data.slice();
      const correctionConfidence = correction?.status === "ready"
        ? correction.confidence
        : observedFrame.confidence;
      const confidence = clamp01(
        observedFrame.confidence * observedWeight + correctionConfidence * forecastWeight
      );
      return Object.freeze({
        kind: forecastFrame ? "radar-seam-blend" : "observed-nowcast",
        provider: "nearcast-radar-seam",
        sourceProvider: forecastFrame ? "mrms-hrrr-seam" : "mrms-advection",
        validTime: observedFrame.targetValidTime || observedFrame.validTime,
        targetValidTime: observedFrame.targetValidTime || observedFrame.validTime,
        anchorValidTime: observedFrame.anchorValidTime,
        leadMinutes: observedFrame.leadMinutes,
        width,
        height,
        data,
        confidence,
        confidenceLevel: confidenceLevel(confidence),
        blend: Object.freeze({
          observedWeight,
          forecastWeight,
          forecastAvailable: Boolean(forecastFrame),
          correctionFactor: forecastFrame?.correctionFactor ?? 0
        }),
        observedFrame,
        forecastFrame: forecastFrame || null
      });
    }));
  }

  function blendTextures(observed, forecast, width, height, forecastWeight) {
    if (!(observed instanceof Uint8Array) || !(forecast instanceof Uint8Array) ||
        observed.length !== width * height || forecast.length !== width * height) {
      throw codedError("RADAR_SEAM_BLEND_TEXTURE_INVALID", "Blend textures do not share the declared dimensions.");
    }
    if (width * height > MAX_TEXTURE_PIXELS) {
      throw codedError("RADAR_SEAM_TEXTURE_TOO_LARGE", "Blend texture exceeds the radar seam pixel budget.");
    }
    const weight = clamp01(forecastWeight);
    const observedWeight = 1 - weight;
    const output = new Uint8Array(observed.length);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = clampByte(Math.round(observed[index] * observedWeight + forecast[index] * weight));
    }
    return output;
  }

  function estimatePairTranslation(source, target, width, height, options = {}) {
    if (!(source instanceof Uint8Array) || !(target instanceof Uint8Array) || source.length !== target.length) {
      return unavailable("pair-textures-invalid");
    }
    const threshold = clampInteger(options.threshold, 8, 1, 254);
    const maximumShift = clampInteger(
      options.maximumShiftPixels,
      Math.min(24, Math.floor(Math.min(width, height) * 0.2)),
      1,
      MAX_SHIFT_PIXELS
    );
    const sampleStride = clampInteger(
      options.sampleStride,
      Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES_PER_CANDIDATE))),
      1,
      16
    );
    const minimumActiveSamples = clampInteger(
      options.minimumActiveSamples,
      Math.max(MIN_SIGNAL_PIXELS, Math.ceil(width * height / (sampleStride * sampleStride) * 0.001)),
      8,
      10_000
    );
    const activeSource = countSignal(source, width, height, threshold, sampleStride);
    const activeTarget = countSignal(target, width, height, threshold, sampleStride);
    if (activeSource < minimumActiveSamples || activeTarget < minimumActiveSamples) {
      return unavailable("insufficient-precipitation-signal", {
        activeSource,
        activeTarget,
        minimumActiveSamples
      });
    }

    const candidates = [];
    const coarseStep = maximumShift >= 10 ? 2 : 1;
    for (let dy = -maximumShift; dy <= maximumShift; dy += coarseStep) {
      for (let dx = -maximumShift; dx <= maximumShift; dx += coarseStep) {
        candidates.push(scoreTranslation(source, target, width, height, dx, dy, {
          threshold,
          sampleStride,
          minimumActiveSamples
        }));
      }
    }
    candidates.sort(compareCandidate);
    const coarseBest = candidates[0];
    if (!coarseBest || !Number.isFinite(coarseBest.score)) {
      return unavailable("translation-search-empty");
    }
    if (coarseStep > 1) {
      for (let dy = Math.max(-maximumShift, coarseBest.dy - 2); dy <= Math.min(maximumShift, coarseBest.dy + 2); dy += 1) {
        for (let dx = Math.max(-maximumShift, coarseBest.dx - 2); dx <= Math.min(maximumShift, coarseBest.dx + 2); dx += 1) {
          if ((dx - coarseBest.dx) % coarseStep === 0 && (dy - coarseBest.dy) % coarseStep === 0) continue;
          candidates.push(scoreTranslation(source, target, width, height, dx, dy, {
            threshold,
            sampleStride,
            minimumActiveSamples
          }));
        }
      }
      candidates.sort(compareCandidate);
    }

    const best = candidates[0];
    const runnerUp = candidates.find((candidate) =>
      Math.max(Math.abs(candidate.dx - best.dx), Math.abs(candidate.dy - best.dy)) > 2
    );
    const zero = candidates.find((candidate) => candidate.dx === 0 && candidate.dy === 0)
      || scoreTranslation(source, target, width, height, 0, 0, {
        threshold,
        sampleStride,
        minimumActiveSamples
      });
    const ambiguityGap = runnerUp && Number.isFinite(runnerUp.score)
      ? Math.max(0, best.score - runnerUp.score)
      : best.score;
    const ambiguity = clamp01(ambiguityGap / 0.08);
    const improvement = Number.isFinite(zero.score) ? Math.max(0, best.score - zero.score) : best.score;
    const scoreQuality = clamp01((best.score - 0.2) / 0.7);
    const signalQuality = clamp01(Math.min(activeSource, activeTarget) / (minimumActiveSamples * 4));
    const confidence = clamp01(
      scoreQuality * 0.48 +
      best.precipOverlap * 0.18 +
      best.overlap * 0.10 +
      ambiguity * 0.14 +
      signalQuality * 0.10
    );
    const minimumScore = clampNumber(options.minimumPairScore, 0.36, 0.15, 0.9);
    const minimumConfidence = clampNumber(options.minimumPairConfidence, 0.42, 0.2, 0.9);
    const minimumAmbiguity = clampNumber(options.minimumAmbiguity, 0.035, 0, 0.3);

    const minimumGeometricOverlap = clampNumber(options.minimumPairGeometricOverlap, 0.68, 0.5, 0.95);
    if (best.score < minimumScore || best.precipOverlap < 0.12 || best.overlap < minimumGeometricOverlap) {
      return unavailable("pair-similarity-too-low", {
        score: best.score,
        precipOverlap: best.precipOverlap,
        geometricOverlap: best.overlap,
        minimumScore
      });
    }
    if (ambiguity < minimumAmbiguity) {
      return unavailable("translation-ambiguous", {
        ambiguity,
        ambiguityGap,
        bestScore: best.score,
        runnerUpScore: runnerUp?.score ?? null
      });
    }
    if (confidence < minimumConfidence) {
      return unavailable("pair-confidence-too-low", { confidence, minimumConfidence });
    }

    return Object.freeze({
      status: "ready",
      dx: best.dx,
      dy: best.dy,
      score: best.score,
      confidence,
      confidenceLevel: confidenceLevel(confidence),
      overlap: best.overlap,
      precipOverlap: best.precipOverlap,
      ambiguity,
      ambiguityGap,
      improvementOverStationary: improvement,
      activeSource,
      activeTarget,
      sampleStride
    });
  }

  function scoreTranslation(source, target, width, height, dx, dy, options) {
    const xStart = Math.max(0, -dx);
    const xEnd = Math.min(width, width - dx);
    const yStart = Math.max(0, -dy);
    const yEnd = Math.min(height, height - dy);
    if (xStart >= xEnd || yStart >= yEnd) return invalidCandidate(dx, dy);
    let unionIntensity = 0;
    let sharedIntensity = 0;
    let sourceActive = 0;
    let targetActive = 0;
    let sharedActive = 0;
    let sampled = 0;
    for (let y = yStart; y < yEnd; y += options.sampleStride) {
      const sourceRow = y * width;
      const targetRow = (y + dy) * width;
      for (let x = xStart; x < xEnd; x += options.sampleStride) {
        const a = source[sourceRow + x];
        const b = target[targetRow + x + dx];
        const aActive = a >= options.threshold;
        const bActive = b >= options.threshold;
        sampled += 1;
        if (!aActive && !bActive) continue;
        if (aActive) sourceActive += 1;
        if (bActive) targetActive += 1;
        if (aActive && bActive) sharedActive += 1;
        sharedIntensity += Math.min(aActive ? a : 0, bActive ? b : 0);
        unionIntensity += Math.max(aActive ? a : 0, bActive ? b : 0);
      }
    }
    const activeUnion = sourceActive + targetActive - sharedActive;
    if (activeUnion < options.minimumActiveSamples || !unionIntensity) return invalidCandidate(dx, dy);
    const intensityIou = sharedIntensity / unionIntensity;
    const dice = sourceActive + targetActive ? 2 * sharedActive / (sourceActive + targetActive) : 0;
    const precipOverlap = activeUnion ? sharedActive / activeUnion : 0;
    const overlap = sampled / Math.ceil(width / options.sampleStride) / Math.ceil(height / options.sampleStride);
    return {
      dx,
      dy,
      score: intensityIou * 0.72 + dice * 0.28,
      intensityIou,
      precipOverlap,
      overlap: clamp01(overlap),
      activeUnion
    };
  }

  function estimateIntensityScale(source, target, width, height, dx, dy, threshold, options) {
    const stride = clampInteger(options.intensitySampleStride, 1, 1, 8);
    const ratios = [];
    const xStart = Math.max(0, -dx);
    const xEnd = Math.min(width, width - dx);
    const yStart = Math.max(0, -dy);
    const yEnd = Math.min(height, height - dy);
    for (let y = yStart; y < yEnd; y += stride) {
      for (let x = xStart; x < xEnd; x += stride) {
        const a = source[y * width + x];
        const b = target[(y + dy) * width + x + dx];
        if (a < threshold || b < threshold) continue;
        ratios.push(b / a);
      }
    }
    const minimumSamples = clampInteger(options.minimumIntensitySamples, 24, 8, 5_000);
    if (ratios.length < minimumSamples) {
      return { ok: false, details: { samples: ratios.length, minimumSamples } };
    }
    ratios.sort((a, b) => a - b);
    const low = ratios[Math.floor(ratios.length * 0.15)];
    const high = ratios[Math.floor(ratios.length * 0.85)];
    const trimmed = ratios.filter((ratio) => ratio >= low && ratio <= high);
    const median = trimmed[Math.floor(trimmed.length / 2)];
    const scale = clampNumber(median, 1, 0.65, 1.5);
    const spread = high - low;
    return {
      ok: true,
      scale,
      samples: ratios.length,
      confidence: clamp01(1 - spread / 1.2)
    };
  }

  function translateTexture(source, width, height, dx, dy, options = {}) {
    if (!(source instanceof Uint8Array) || source.length !== width * height) {
      throw codedError("RADAR_SEAM_TEXTURE_INVALID", "Texture dimensions do not match its byte length.");
    }
    if (width * height > MAX_TEXTURE_PIXELS) {
      throw codedError("RADAR_SEAM_TEXTURE_TOO_LARGE", "Texture exceeds the radar seam pixel budget.");
    }
    const output = new Uint8Array(source.length);
    const scale = clampNumber(options.intensityScale, 1, 0.5, 2);
    const interpolation = options.interpolation === "nearest" ? "nearest" : "bilinear";
    for (let y = 0; y < height; y += 1) {
      const sourceY = y - dy;
      if (sourceY < 0 || sourceY > height - 1) continue;
      for (let x = 0; x < width; x += 1) {
        const sourceX = x - dx;
        if (sourceX < 0 || sourceX > width - 1) continue;
        const value = interpolation === "nearest"
          ? source[Math.round(sourceY) * width + Math.round(sourceX)]
          : bilinearSample(source, width, height, sourceX, sourceY);
        output[y * width + x] = clampByte(Math.round(value * scale));
      }
    }
    return output;
  }

  function bilinearSample(source, width, height, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const top = source[y0 * width + x0] * (1 - fx) + source[y0 * width + x1] * fx;
    const bottom = source[y1 * width + x0] * (1 - fx) + source[y1 * width + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  }

  function normalizeObservedInput(input, options) {
    const supplied = Array.isArray(input.frames)
      ? input.frames
      : Array.isArray(input.observedFrames) ? input.observedFrames : [];
    if (supplied.length < 2) return { ok: false, reason: "at-least-two-observed-frames-required" };
    if (supplied.length > MAX_OBSERVED_INPUT_FRAMES) {
      return {
        ok: false,
        reason: "observed-input-exceeds-bounded-history",
        details: { supplied: supplied.length, maximum: MAX_OBSERVED_INPUT_FRAMES }
      };
    }
    const ordered = supplied.map((frame, index) => {
      const timeMs = parseTime(frame?.validTime ?? frame?.observedAt ?? frame?.timestamp);
      return { frame, index, timeMs };
    });
    if (ordered.some((item) => !Number.isFinite(item.timeMs))) {
      return { ok: false, reason: "observed-time-invalid" };
    }
    ordered.sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
    const bounded = ordered.slice(-MAX_OBSERVED_FRAMES).map((item) => item.frame);
    const frames = [];
    for (let index = 0; index < bounded.length; index += 1) {
      const result = normalizeFrame(bounded[index], `observed[${index}]`, options);
      if (!result.ok) return result;
      frames.push(result.frame);
    }
    frames.sort((a, b) => a.timeMs - b.timeMs);
    for (let index = 1; index < frames.length; index += 1) {
      if (frames[index].timeMs === frames[index - 1].timeMs) {
        return { ok: false, reason: "duplicate-observed-times" };
      }
      if (frames[index].width !== frames[0].width || frames[index].height !== frames[0].height) {
        return { ok: false, reason: "observed-dimensions-mismatch" };
      }
    }
    return {
      ok: true,
      frames,
      width: frames[0].width,
      height: frames[0].height,
      threshold: clampInteger(options.signalThreshold, 8, 1, 254),
      inputFrameCount: supplied.length,
      usedFrameCount: frames.length
    };
  }

  function validateSuppliedMotion(motion, normalized, options) {
    const latest = normalized.frames[normalized.frames.length - 1];
    const anchorTime = parseTime(motion.anchorValidTime);
    const velocityX = Number(motion.velocityX ?? motion.pixelsPerMinuteX);
    const velocityY = Number(motion.velocityY ?? motion.pixelsPerMinuteY);
    const confidence = Number(motion.confidence);
    const maximumVelocity = clampNumber(options.maximumVelocityPixelsPerMinute, 1.5, 0.05, 4);
    if (anchorTime !== latest.timeMs ||
        motion.width !== normalized.width || motion.height !== normalized.height ||
        ![velocityX, velocityY, confidence].every(Number.isFinite) ||
        Math.hypot(velocityX, velocityY) > maximumVelocity ||
        confidence < clampNumber(options.minimumMotionConfidence, 0.5, 0.25, 0.9)) {
      return unavailable("supplied-motion-does-not-match-observed-anchor");
    }
    return motion;
  }

  function normalizeCorrectionInput(input, options) {
    const reference = normalizeFrame(input.referenceFrame, "reference", options);
    if (!reference.ok) return reference;
    const forecast = normalizeFrame(input.forecastFrame, "forecast", options);
    if (!forecast.ok) return forecast;
    if (reference.frame.width !== forecast.frame.width || reference.frame.height !== forecast.frame.height) {
      return { ok: false, reason: "correction-dimensions-mismatch" };
    }
    return {
      ok: true,
      reference: reference.frame,
      forecast: forecast.frame,
      width: reference.frame.width,
      height: reference.frame.height,
      threshold: clampInteger(options.signalThreshold, 8, 1, 254)
    };
  }

  function normalizeForecastFrames(supplied, options) {
    if (!Array.isArray(supplied)) return { ok: false, reason: "forecast-frames-invalid" };
    if (supplied.length > MAX_FORECAST_FRAMES) {
      return {
        ok: false,
        reason: "too-many-forecast-frames",
        details: { supplied: supplied.length, maximum: MAX_FORECAST_FRAMES }
      };
    }
    const frames = [];
    for (let index = 0; index < supplied.length; index += 1) {
      const result = normalizeFrame(supplied[index], `forecast[${index}]`, options);
      if (!result.ok) return result;
      frames.push(result.frame);
    }
    frames.sort((a, b) => a.timeMs - b.timeMs);
    return { ok: true, frames };
  }

  function normalizeFrame(input, label, options) {
    if (!input || typeof input !== "object") {
      return { ok: false, reason: `${label}-frame-missing` };
    }
    const data = input.data instanceof Uint8Array
      ? input.data
      : input.texture instanceof Uint8Array ? input.texture : null;
    const width = Number(input.width ?? options.width);
    const height = Number(input.height ?? options.height);
    if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
      return { ok: false, reason: `${label}-texture-invalid` };
    }
    if (width * height > MAX_TEXTURE_PIXELS) {
      return {
        ok: false,
        reason: `${label}-texture-too-large`,
        details: { pixels: width * height, maximum: MAX_TEXTURE_PIXELS }
      };
    }
    if (data.length !== width * height) {
      return {
        ok: false,
        reason: `${label}-texture-length-mismatch`,
        details: { bytes: data.length, expected: width * height }
      };
    }
    const timeValue = input.validTime ?? input.observedAt ?? input.timestamp;
    const timeMs = parseTime(timeValue);
    if (!Number.isFinite(timeMs)) return { ok: false, reason: `${label}-time-invalid` };
    return {
      ok: true,
      frame: Object.freeze({
        ...input,
        data,
        width,
        height,
        timeMs,
        validTime: new Date(timeMs).toISOString()
      })
    };
  }

  function normalizeTargets(input, anchorTimeMs) {
    if (Array.isArray(input.targetValidTimes) && input.targetValidTimes.length) {
      if (input.targetValidTimes.length > 6) {
        return { ok: false, reason: "too-many-nowcast-targets", details: { maximum: 6 } };
      }
      const unique = new Map();
      for (const value of input.targetValidTimes) {
        const timeMs = parseTime(value);
        const leadMinutes = (timeMs - anchorTimeMs) / 60_000;
        if (!Number.isFinite(timeMs) || !Number.isFinite(leadMinutes) || leadMinutes <= 0 || leadMinutes > MAX_LEAD_MINUTES) {
          return {
            ok: false,
            reason: "nowcast-target-outside-safe-bounds",
            details: { maximumLeadMinutes: MAX_LEAD_MINUTES }
          };
        }
        unique.set(timeMs, Object.freeze({
          targetValidTime: new Date(timeMs).toISOString(),
          leadMinutes: Number(leadMinutes.toFixed(3))
        }));
      }
      return { ok: true, values: [...unique.values()].sort((a, b) => a.leadMinutes - b.leadMinutes) };
    }
    const supplied = input.leadsMinutes == null ? DEFAULT_LEADS_MINUTES : input.leadsMinutes;
    if (!Array.isArray(supplied) || !supplied.length || supplied.length > 6) {
      return { ok: false, reason: "nowcast-leads-invalid" };
    }
    const values = [...new Set(supplied.map(Number))].sort((a, b) => a - b);
    if (values.some((value) => !Number.isInteger(value) || value <= 0 || value > MAX_LEAD_MINUTES)) {
      return {
        ok: false,
        reason: "nowcast-lead-outside-safe-bounds",
        details: { maximumLeadMinutes: MAX_LEAD_MINUTES }
      };
    }
    return {
      ok: true,
      values: values.map((leadMinutes) => Object.freeze({
        targetValidTime: new Date(anchorTimeMs + leadMinutes * 60_000).toISOString(),
        leadMinutes
      }))
    };
  }

  function countSignal(data, width, height, threshold, stride) {
    let count = 0;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        if (data[y * width + x] >= threshold) count += 1;
      }
    }
    return count;
  }

  function weightedMedian(values, weights) {
    const sorted = values.map((value, index) => ({ value, weight: weights[index] }))
      .sort((a, b) => a.value - b.value);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = 0;
    for (const item of sorted) {
      cursor += item.weight;
      if (cursor >= total / 2) return item.value;
    }
    return sorted[sorted.length - 1]?.value ?? 0;
  }

  function weightedMean(values, weights) {
    let sum = 0;
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[index] * weights[index];
      total += weights[index];
    }
    return total ? sum / total : 0;
  }

  function translatedCoverage(width, height, dx, dy) {
    const retainedWidth = Math.max(0, width - Math.abs(dx));
    const retainedHeight = Math.max(0, height - Math.abs(dy));
    return clamp01(retainedWidth * retainedHeight / (width * height));
  }

  function invalidCandidate(dx, dy) {
    return { dx, dy, score: -Infinity, intensityIou: 0, precipOverlap: 0, overlap: 0, activeUnion: 0 };
  }

  function compareCandidate(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    const aDistance = Math.hypot(a.dx, a.dy);
    const bDistance = Math.hypot(b.dx, b.dy);
    return aDistance - bDistance;
  }

  function unavailable(reason, details) {
    return Object.freeze({
      status: "unavailable",
      reason: reason || "unknown",
      details: details ? Object.freeze({ ...details }) : undefined,
      frames: Object.freeze([])
    });
  }

  function confidenceLevel(value) {
    if (value >= 0.76) return "high";
    if (value >= 0.56) return "moderate";
    return "low";
  }

  function parseTime(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : NaN;
  }

  function normalizeDegrees(value) {
    return (value % 360 + 360) % 360;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smoothstep(value) {
    const x = clamp01(value);
    return x * x * (3 - 2 * x);
  }

  function clampNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
  }

  function clampInteger(value, fallback, minimum, maximum) {
    return Math.round(clampNumber(value, fallback, minimum, maximum));
  }

  function finite(value) {
    return Number.isFinite(value) ? value : null;
  }

  function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    VERSION,
    DEFAULT_LEADS_MINUTES,
    LIMITS: Object.freeze({
      maximumTexturePixels: MAX_TEXTURE_PIXELS,
      maximumObservedFrames: MAX_OBSERVED_FRAMES,
      maximumObservedInputFrames: MAX_OBSERVED_INPUT_FRAMES,
      maximumForecastFrames: MAX_FORECAST_FRAMES,
      maximumShiftPixels: MAX_SHIFT_PIXELS,
      maximumLeadMinutes: MAX_LEAD_MINUTES
    }),
    estimateMotion,
    generateNowcast,
    estimateForecastCorrection,
    applyForecastCorrection,
    buildSeam,
    composeSeamFrames,
    blendTextures,
    translateTexture
  });
});
