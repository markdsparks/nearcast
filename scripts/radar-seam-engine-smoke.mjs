#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  HEIGHT,
  START_TIME,
  WIDTH,
  observedTrack,
  scaleTexture,
  signalCentroid
} from "./fixtures/radar-seam-engine-fixtures.mjs";

const require = createRequire(import.meta.url);
const seam = require("../radar-seam-engine.js");

assert.equal(seam.VERSION, "0.1.0");
assert.deepEqual(seam.DEFAULT_LEADS_MINUTES, [15, 30, 45, 60]);

const observations = observedTrack(seam);
const inputSnapshots = observations.map((frame) => frame.data.slice());
const motion = seam.estimateMotion({ frames: observations }, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1
});

assert.equal(motion.status, "ready", JSON.stringify(motion));
assert.equal(motion.velocityX, 0.4);
assert.equal(motion.velocityY, -0.2);
assert.ok(motion.confidence >= 0.7, `motion confidence ${motion.confidence}`);
assert.ok(motion.consistency >= 0.99, `motion consistency ${motion.consistency}`);
assert.ok(motion.observedSpanMinutes >= 10);
assert.ok(motion.pairs.every((pair) => pair.newerValidTime === observations.at(-1).validTime));

const nowcast = seam.generateNowcast({ frames: observations, motion }, {
  signalThreshold: 8,
  interpolation: "nearest"
});
assert.equal(nowcast.status, "ready", JSON.stringify(nowcast));
assert.deepEqual(nowcast.frames.map((frame) => frame.leadMinutes), [15, 30, 45, 60]);
assert.equal(nowcast.frames[0].validTime, "2026-08-17T18:30:00.000Z");
assert.equal(nowcast.frames[3].validTime, "2026-08-17T19:15:00.000Z");
assert.ok(nowcast.frames.every((frame) => frame.targetValidTime === frame.validTime));

const latestCentroid = signalCentroid(observations.at(-1).data);
const plus15Centroid = signalCentroid(nowcast.frames[0].data);
assert.ok(Math.abs((plus15Centroid.x - latestCentroid.x) - 6) < 0.05);
assert.ok(Math.abs((plus15Centroid.y - latestCentroid.y) + 3) < 0.05);

// Model guidance is four pixels behind and two pixels south of the observed
// extrapolation, and is 20% weaker. The correction should recover that phase
// and intensity mismatch, then decay fully back to the model by +75 minutes.
const reference = nowcast.frames[0];
const laggedForecastData = scaleTexture(
  seam.translateTexture(reference.data, WIDTH, HEIGHT, -4, 2, { interpolation: "nearest" }),
  0.8
);
const forecastAnchor = {
  width: WIDTH,
  height: HEIGHT,
  validTime: reference.validTime,
  data: laggedForecastData
};
const correction = seam.estimateForecastCorrection({
  referenceFrame: reference,
  forecastFrame: forecastAnchor,
  motion
}, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1,
  minimumIntensitySamples: 16
});
assert.equal(correction.status, "ready", JSON.stringify(correction));
assert.equal(correction.dx, 4);
assert.equal(correction.dy, -2);
assert.ok(Math.abs(correction.intensityScale - 1.25) < 0.03, `${correction.intensityScale}`);
assert.ok(Math.abs(correction.phaseLagMinutes - 10) < 0.01, `${correction.phaseLagMinutes}`);

const correctedAnchor = seam.applyForecastCorrection({ frame: forecastAnchor }, correction, {
  interpolation: "nearest",
  correctionDecayMinutes: 75
});
assert.equal(correctedAnchor.status, "ready");
assert.equal(correctedAnchor.correctionFactor, 1);
const correctedCentroid = signalCentroid(correctedAnchor.data);
const referenceCentroid = signalCentroid(reference.data);
assert.ok(Math.abs(correctedCentroid.x - referenceCentroid.x) < 0.05);
assert.ok(Math.abs(correctedCentroid.y - referenceCentroid.y) < 0.05);

const laterForecast = {
  ...forecastAnchor,
  validTime: new Date(Date.parse(forecastAnchor.validTime) + 75 * 60_000).toISOString()
};
const released = seam.applyForecastCorrection({ frame: laterForecast }, correction, {
  correctionDecayMinutes: 75
});
assert.equal(released.status, "ready");
assert.equal(released.correctionFactor, 0);
assert.deepEqual(released.data, laggedForecastData);

const built = seam.buildSeam({
  observedFrames: observations,
  forecastFrames: [...nowcast.frames.map((frame) => ({
    width: WIDTH,
    height: HEIGHT,
    validTime: frame.targetValidTime,
    data: scaleTexture(
      seam.translateTexture(frame.data, WIDTH, HEIGHT, -4, 2, { interpolation: "nearest" }),
      0.8
    )
  })), laterForecast]
}, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1,
  minimumIntensitySamples: 16,
  interpolation: "nearest"
});
assert.equal(built.status, "ready", JSON.stringify(built));
assert.equal(built.nowcastFrames.length, 4);
assert.equal(built.forecastCorrection.status, "ready", JSON.stringify(built.forecastCorrection));
assert.equal(built.correctedForecastFrames.length, 5);
assert.equal(built.compositeFrames.length, 4);
assert.equal(built.preferredFrames, built.handoffFrames);
assert.equal(built.preferredFrames.length, 5);
assert.equal(built.preferredFrames.at(-1).targetValidTime, laterForecast.validTime);
assert.deepEqual(
  built.compositeFrames.map((frame) => frame.targetValidTime),
  nowcast.frames.map((frame) => frame.targetValidTime)
);
assert.equal(built.compositeFrames[0].blend.forecastWeight, 0);
assert.ok(built.compositeFrames[1].blend.forecastWeight > built.compositeFrames[0].blend.forecastWeight);
assert.ok(built.compositeFrames[2].blend.forecastWeight > built.compositeFrames[1].blend.forecastWeight);
assert.ok(built.compositeFrames[3].blend.forecastWeight > built.compositeFrames[2].blend.forecastWeight);

// Canonical runtimes can supply their exact slots rather than accepting
// rounded relative times from the engine.
const latestObservedTime = Date.parse(observations.at(-1).validTime);
const exactTargets = [12, 27, 42, 57].map((lead) =>
  new Date(latestObservedTime + lead * 60_000).toISOString()
);
const exact = seam.generateNowcast({
  frames: observations,
  targetValidTimes: exactTargets
}, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1,
  interpolation: "nearest"
});
assert.equal(exact.status, "ready", JSON.stringify(exact));
assert.deepEqual(exact.frames.map((frame) => frame.targetValidTime), exactTargets);
assert.deepEqual(exact.frames.map((frame) => frame.leadMinutes), [12, 27, 42, 57]);

// A slow track moves only half a pixel per adjacent five-minute scan. The
// engine deliberately compares 10/20/30-minute lags to recover a stable
// 0.1 px/minute vector, and bounds a longer caller history to its latest eight.
const slowTrack = observedTrack(seam, { frameCount: 19, dxPerFrame: 0.5, dyPerFrame: 0 });
const adjacentOnly = seam.estimateMotion({ frames: slowTrack.slice(-2) }, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1
});
const slowMotion = seam.estimateMotion({ frames: slowTrack }, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1
});
assert.equal(slowMotion.status, "ready", JSON.stringify(slowMotion));
assert.ok(Math.abs(slowMotion.velocityX - 0.1) < 0.001, `${slowMotion.velocityX}`);
assert.equal(slowMotion.velocityY, 0);
assert.equal(slowMotion.observedSpanMinutes, 30);
assert.equal(slowMotion.observedFrameCount, 8);
assert.equal(slowMotion.discardedObservedFrameCount, 11);
assert.ok(slowMotion.pairs.every((pair) => pair.intervalMinutes >= 10));
assert.ok(slowMotion.pairs.every((pair) =>
  Date.parse(pair.olderValidTime) >= Date.parse(slowTrack.at(-8).validTime)
));
assert.notEqual(adjacentOnly.velocityX, slowMotion.velocityX);

// Fail closed: a sparse echo, an untrackable uniform field, invalid texture
// dimensions, and unsafe extrapolation all return no invented frames.
const sparseFrames = [0, 1].map((index) => {
  const data = new Uint8Array(WIDTH * HEIGHT);
  data[20 * WIDTH + 20 + index] = 160;
  return {
    width: WIDTH,
    height: HEIGHT,
    validTime: new Date(START_TIME + index * 5 * 60_000).toISOString(),
    data
  };
});
const sparse = seam.generateNowcast({ frames: sparseFrames }, { signalThreshold: 8 });
assert.equal(sparse.status, "unavailable");
assert.deepEqual(sparse.frames, []);

const uniformFrames = [0, 1].map((index) => ({
  width: WIDTH,
  height: HEIGHT,
  validTime: new Date(START_TIME + index * 5 * 60_000).toISOString(),
  data: new Uint8Array(WIDTH * HEIGHT).fill(80)
}));
const uniform = seam.estimateMotion({ frames: uniformFrames }, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1
});
assert.equal(uniform.status, "unavailable");
assert.equal(uniform.reason, "insufficient-trackable-frame-pairs");

const malformed = seam.generateNowcast({
  frames: observations.map((frame, index) => index === 1 ? { ...frame, width: WIDTH - 1 } : frame)
});
assert.equal(malformed.status, "unavailable");
assert.deepEqual(malformed.frames, []);

const unsafe = seam.generateNowcast({ frames: observations }, {
  signalThreshold: 8,
  maximumShiftPixels: 8,
  sampleStride: 1,
  leadsMinutes: [90],
  minimumAdvectedCoverage: 0.95
});
assert.equal(unsafe.status, "unavailable");
assert.equal(unsafe.reason, "nowcast-leaves-observed-domain");
assert.deepEqual(unsafe.frames, []);

// Every input texture remains byte-for-byte untouched.
observations.forEach((frame, index) => assert.deepEqual(frame.data, inputSnapshots[index]));

console.log(JSON.stringify({
  ok: true,
  version: seam.VERSION,
  motion: {
    velocityX: motion.velocityX,
    velocityY: motion.velocityY,
    confidence: motion.confidence
  },
  nowcastLeads: nowcast.frames.map((frame) => frame.leadMinutes),
  forecastCorrection: {
    dx: correction.dx,
    dy: correction.dy,
    intensityScale: correction.intensityScale,
    decayVerified: true
  },
  exactTargetSlots: exactTargets.length,
  slowMotionLagSpanMinutes: slowMotion.observedSpanMinutes,
  compositeBlend: built.compositeFrames.map((frame) => frame.blend.forecastWeight),
  failClosedCases: 4,
  inputMutation: false
}, null, 2));
