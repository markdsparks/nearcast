#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../map.js", import.meta.url), "utf8");
const minuteMs = 60_000;
const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
const canonicalFrames = [
  ...Array.from({ length: 19 }, (_, index) => canonicalFrame(-90 + index * 5, "radar")),
  ...Array.from({ length: 12 }, (_, index) => canonicalFrame((index + 1) * 15, "forecast"))
];
const nowIndex = canonicalFrames.findIndex((frame) => frame.isNow);
const lastIndex = canonicalFrames.length - 1;
const plus60Index = canonicalFrames.findIndex((frame) => frame.offsetMinutes === 60);
const plus120Index = canonicalFrames.findIndex((frame) => frame.offsetMinutes === 120);

const harness = createHarness(canonicalFrames, nowIndex);

assert.equal(harness.canonicalRawTimelineActive(), true);
assert.deepEqual(
  { ...harness.standardTimelineTimeRange() },
  { start: nowMs - 90 * minuteMs, end: nowMs + 180 * minuteMs }
);

const milestones = Array.from(harness.standardTimelineMilestones(), (marker) => ({ ...marker }));
assert.deepEqual(
  milestones.map((marker) => marker.offsetMinutes),
  [-90, -60, -30, 0, 30, 60, 90, 120, 150, 180],
  "the canonical rail exposes half-hour ticks across the complete time range"
);
const majorMilestones = milestones.filter((marker) => marker.major);
assert.deepEqual(
  majorMilestones.map((marker) => marker.offsetMinutes),
  [-90, -30, 0, 60, 120, 180],
  "the canonical rail uses the intended glanceable milestone set"
);
assert.deepEqual(
  majorMilestones.map((marker) => marker.label),
  ["−90m", "−30m", "Now", "+1h", "+2h", "+3h"]
);
assert.deepEqual(
  majorMilestones.map((marker) => marker.value),
  [0, 222, 333, 556, 778, 1000],
  "milestone slider values are proportional to elapsed time, not frame count"
);
assert.deepEqual(
  majorMilestones.map((marker) => marker.ariaLabel),
  [
    "Jump to 90 minutes ago",
    "Jump to 30 minutes ago",
    "Jump to Now",
    "Jump to 1 hour from now",
    "Jump to 2 hours from now",
    "Jump to 3 hours from now"
  ]
);
assertApprox(majorMilestones.find((marker) => marker.now).progress, 1 / 3, 1e-12, "Now rail position");
assert.notEqual(
  Math.round(majorMilestones.find((marker) => marker.now).progress * 100),
  Math.round((nowIndex / lastIndex) * 100),
  "the Now marker does not regress to an index-spaced position"
);
assert.equal(harness.standardTimelineSliderValueForFrame(nowIndex), 333);
assert.equal(harness.standardTimelineFrameIndexForSliderValue(778), plus120Index);

for (const frameIndex of [0, nowIndex, nowIndex + 1, lastIndex - 1]) {
  harness.mapState.frameIndex = frameIndex;
  assert.deepEqual(
    { ...harness.playbackBounds() },
    { start: 0, end: lastIndex, loop: true },
    `canonical playback remains one continuous looping range at frame ${frameIndex}`
  );
}
assert.equal(
  harness.nextPlaybackIndexFrom(nowIndex),
  nowIndex + 1,
  "canonical playback crosses directly from observed Now into forecast guidance"
);
assert.equal(harness.nextPlaybackIndexFrom(lastIndex), 0, "canonical playback cycles back to the first observation");

const observedStepMs = harness.canonicalTimelineStepMs(0);
const forecastStepMs = harness.canonicalTimelineStepMs(nowIndex);
assertApprox(
  forecastStepMs / observedStepMs,
  3,
  1e-12,
  "a 15-minute forecast interval receives three times a 5-minute observed interval"
);
assert.equal(harness.canonicalTimelineStepMs(lastIndex), 700, "the final frame uses the explicit end hold");

const mixedFrames = canonicalFrames.map((frame) => ({ ...frame }));
mixedFrames[0].rawMapCanonical = false;
harness.setFrames(mixedFrames, nowIndex);
assert.equal(harness.canonicalRawTimelineActive(), false);
assert.deepEqual(
  Array.from(harness.standardTimelineMilestones()),
  [],
  "a partial/mixed fallback timeline hides fixed time milestones rather than mislabeling the rail"
);
assert.equal(harness.standardTimelineTimeRange(), null);
assert.equal(harness.standardTimelineSliderValueForFrame(7), 7);
assert.equal(harness.standardTimelineFrameIndexForSliderValue(7.4), 7);
harness.mapState.timelineKind = "precip";
harness.mapState.frameIndex = nowIndex;
assert.deepEqual(
  { ...harness.playbackBounds() },
  { start: 0, end: nowIndex, loop: true },
  "a mixed fallback keeps the honest legacy observed playback range"
);

harness.setFrames(canonicalFrames, nowIndex);
harness.mapState.timelineKind = "precip";
harness.mapState.frameIndex = nowIndex;
harness.mapState.playing = true;
harness.mapState.userPausedRadar = false;
harness.slider.value = String(harness.standardTimelineSliderValueForFrame(nowIndex));
harness.resetCalls();

harness.scrubToFrame(111);
harness.scrubToFrame(333);
harness.scrubToFrame(760);
assert.equal(harness.mapState.playing, false, "scrubbing pauses active playback immediately");
assert.equal(harness.mapState.userPausedRadar, true);
assert.deepEqual(
  plain(harness.calls.stop),
  [{ renderStatic: false }],
  "canonical scrubbing pauses without rendering the old frame"
);
assert.equal(harness.pendingRafCount(), 1, "a burst of input events schedules one map render RAF");
assert.equal(harness.calls.showFrame.length, 0, "no expensive frame render occurs before the RAF");
assert.equal(harness.slider.value, "760", "the native thumb keeps the latest finger position");
assert.deepEqual(plain(harness.scrubSnapshot()), { rafPending: true, pendingValue: 760, active: true });

harness.flushNextRaf();
assert.equal(harness.calls.showFrame.length, 1, "one RAF renders exactly one frame from the input burst");
assert.equal(harness.calls.showFrame[0].index, plus120Index, "only the latest queued scrub target is rendered");
assert.deepEqual({ ...harness.calls.showFrame[0].options }, { preserveSliderValue: true });
assert.equal(harness.slider.value, "760", "rendering the nearest frame does not snap the thumb mid-drag");
assert.deepEqual(plain(harness.scrubSnapshot()), { rafPending: false, pendingValue: null, active: true });

const showCountBeforeSettle = harness.calls.showFrame.length;
assert.equal(harness.settleStandardTimelineScrub(), true);
assert.equal(harness.calls.showFrame.length, showCountBeforeSettle, "settling an already-rendered scrub does not redraw it");
assert.equal(harness.slider.value, "778", "settle snaps the rail to the exact selected frame timestamp");
assert.deepEqual(plain(harness.scrubSnapshot()), { rafPending: false, pendingValue: null, active: false });

harness.mapState.frameIndex = nowIndex;
harness.scrubToFrame(444);
harness.scrubToFrame(555);
assert.equal(harness.pendingRafCount(), 1);
const showCountBeforePendingSettle = harness.calls.showFrame.length;
assert.equal(harness.settleStandardTimelineScrub(), true);
assert.equal(harness.pendingRafCount(), 0, "settle cancels the queued RAF before rendering synchronously");
assert.equal(harness.calls.showFrame.length, showCountBeforePendingSettle + 1);
assert.equal(harness.calls.showFrame.at(-1).index, plus60Index, "settle renders only the latest pending target");
assert.equal(harness.slider.value, "556");

const showCountBeforeCancel = harness.calls.showFrame.length;
harness.scrubToFrame(700);
assert.equal(harness.pendingRafCount(), 1);
harness.cancelStandardTimelineScrub();
assert.equal(harness.pendingRafCount(), 0);
harness.flushAllRafs();
assert.equal(harness.calls.showFrame.length, showCountBeforeCancel, "cancelled scrubs cannot render later");
assert.deepEqual(plain(harness.scrubSnapshot()), { rafPending: false, pendingValue: null, active: false });

harness.setFrames(canonicalFrames, nowIndex);
harness.mapState.immersive = false;
harness.mapState.timelineKind = "radar";
harness.mapState.userPausedRadar = false;
harness.setMapInView(true);
harness.calls.start.length = 0;
harness.maybeAutoPlayRadar();
assert.equal(harness.calls.start.length, 0, "canonical timelines never auto-play when they enter view");

harness.setFrames(mixedFrames, nowIndex);
harness.maybeAutoPlayRadar();
assert.deepEqual(
  plain(harness.calls.start),
  [{ restartIfAtEnd: true }],
  "the canonical guard does not change legacy inline radar auto-play behavior"
);
harness.mapState.userPausedRadar = true;
harness.maybeAutoPlayRadar();
assert.equal(harness.calls.start.length, 1, "manual pause still blocks legacy auto-play");

console.log(JSON.stringify({
  ok: true,
  majorMilestones: majorMilestones.map((marker) => marker.label),
  canonicalPlaybackRange: canonicalFrames.length,
  forecastToObservedStepRatio: forecastStepMs / observedStepMs,
  coalescedScrub: true,
  partialFallbackMilestonesHidden: true,
  canonicalAutoPlayBlocked: true
}, null, 2));

function canonicalFrame(offsetMinutes, source) {
  const timestamp = nowMs + offsetMinutes * minuteMs;
  return {
    id: `${source}-${offsetMinutes}`,
    source,
    timestamp,
    observedTimestamp: source === "radar" ? timestamp : undefined,
    rawMapCanonical: true,
    rawMapIndexUrl: `https://example.test/${source}/${offsetMinutes}/index.json`,
    rawMapNoRasterFallback: source === "forecast",
    isNow: offsetMinutes === 0,
    offsetMinutes
  };
}

function assertApprox(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`
  );
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(frames, initialNowIndex) {
  const calls = {
    stop: [],
    start: [],
    showFrame: [],
    setSlider: [],
    syncSlider: [],
    renderBubble: [],
    showBubble: []
  };
  const slider = { value: "0" };
  const rafCallbacks = new Map();
  let nextRafId = 1;
  const mapState = {
    frames,
    frameIndex: initialNowIndex,
    nowIndex: initialNowIndex,
    timelineKind: "precip",
    playing: false,
    userPausedRadar: false,
    immersive: true
  };
  const sandbox = {
    mapState,
    calls,
    slider,
    rafCallbacks,
    STANDARD_TIMELINE_SLIDER_STEPS: 1000,
    STANDARD_TIMELINE_MAJOR_OFFSETS_MINUTES: Object.freeze([-90, -30, 0, 60, 120, 180]),
    STANDARD_TIMELINE_MINOR_STEP_MINUTES: 30,
    RAW_MAP_FORECAST_STEP_MINUTES: 15,
    CANONICAL_TIMELINE_PLAY_DURATION_MS: 12_000,
    CANONICAL_TIMELINE_END_HOLD_MS: 700,
    MIN_STEP_MS: 90,
    requestAnimationFrame(callback) {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`
    function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
    function activeMapSource(frame = mapState.frames[mapState.frameIndex]) {
      return frame?.source === "forecast" ? "forecast" : "radar";
    }
    function xweatherStormActive() { return false; }
    function mapLibreCurrentRecord() { return null; }
    function scrubXweatherStormTimeline() { return false; }
    function stopRadarPlayback(options = {}) {
      calls.stop.push({ ...options });
      mapState.playing = false;
    }
    function startRadarPlayback(options = {}) { calls.start.push({ ...options }); }
    function showTimelineTimeBubble(durationMs) { calls.showBubble.push(durationMs); }
    function renderTimelineTimeBubble(options = {}) { calls.renderBubble.push({ ...options }); }
    function setStandardTimelineSliderValue(target, value, frameIndex = null) {
      target.value = String(Math.round(Number(value) || 0));
      calls.setSlider.push({ value: target.value, frameIndex });
    }
    function showFrame(index, options = {}) {
      calls.showFrame.push({ index, options: { ...options } });
      mapState.frameIndex = index;
    }
    function syncStandardTimelineSlider(frameIndex = mapState.frameIndex) {
      calls.syncSlider.push(frameIndex);
      slider.value = String(standardTimelineSliderValueForFrame(frameIndex));
    }
    const els = { frameSlider: slider };
    let standardTimelineScrubRaf = 0;
    let standardTimelinePendingScrubValue = null;
    let standardTimelineScrubActive = false;
    let mapInView = true;
    ${extractFunction(source, "rawMapTimelineTimestamp")}
    ${extractFunction(source, "rawMapClosestFrameIndex")}
    ${extractFunction(source, "standardTimelineTimeRange")}
    ${extractFunction(source, "canonicalRawTimelineActive")}
    ${extractFunction(source, "standardTimelineNowTimestamp")}
    ${extractFunction(source, "standardTimelineMilestoneLabel")}
    ${extractFunction(source, "standardTimelineMilestoneAriaLabel")}
    ${extractFunction(source, "standardTimelineMilestones")}
    ${extractFunction(source, "standardTimelineSliderValueForFrame")}
    ${extractFunction(source, "standardTimelineFrameIndexForSliderValue")}
    ${extractFunction(source, "cancelStandardTimelineScrub")}
    ${extractFunction(source, "beginStandardTimelineScrub")}
    ${extractFunction(source, "renderPendingStandardTimelineScrub")}
    ${extractFunction(source, "settleStandardTimelineScrub")}
    ${extractFunction(source, "scrubToFrame")}
    ${extractFunction(source, "playbackBounds")}
    ${extractFunction(source, "nextPlaybackIndexFrom")}
    ${extractFunction(source, "canonicalTimelineStepMs")}
    ${extractFunction(source, "maybeAutoPlayRadar")}
    globalThis.api = {
      canonicalRawTimelineActive,
      standardTimelineTimeRange,
      standardTimelineMilestones,
      standardTimelineSliderValueForFrame,
      standardTimelineFrameIndexForSliderValue,
      cancelStandardTimelineScrub,
      settleStandardTimelineScrub,
      scrubToFrame,
      playbackBounds,
      nextPlaybackIndexFrom,
      canonicalTimelineStepMs,
      maybeAutoPlayRadar,
      setMapInView(value) { mapInView = Boolean(value); },
      scrubSnapshot() {
        return {
          rafPending: Boolean(standardTimelineScrubRaf),
          pendingValue: standardTimelinePendingScrubValue,
          active: standardTimelineScrubActive
        };
      }
    };
  `, sandbox);

  return {
    mapState,
    calls,
    slider,
    ...sandbox.api,
    setFrames(nextFrames, nextNowIndex) {
      mapState.frames = nextFrames;
      mapState.nowIndex = nextNowIndex;
      mapState.frameIndex = nextNowIndex;
    },
    resetCalls() {
      Object.values(calls).forEach((values) => { values.length = 0; });
    },
    pendingRafCount() {
      return rafCallbacks.size;
    },
    flushNextRaf() {
      const entry = rafCallbacks.entries().next().value;
      assert.ok(entry, "expected a pending animation frame");
      const [id, callback] = entry;
      rafCallbacks.delete(id);
      callback(16);
    },
    flushAllRafs() {
      while (rafCallbacks.size) this.flushNextRaf();
    }
  };
}

function extractFunction(sourceText, name) {
  const asyncMarker = `async function ${name}(`;
  const functionMarker = `function ${name}(`;
  const asyncStart = sourceText.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : sourceText.indexOf(functionMarker);
  assert.notEqual(start, -1, `Found ${name} in map.js`);
  const signatureEnd = sourceText.indexOf(") {", start);
  const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : sourceText.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name} from map.js`);
}
