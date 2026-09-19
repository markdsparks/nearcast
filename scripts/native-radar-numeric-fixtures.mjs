#!/usr/bin/env node
// Synthetic, offline oracle. Executes production JS primitives, not Swift or a
// second hand-written implementation. --emit prints the reviewable fixture;
// default/--check compares the checked-in fixture against current web behavior.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { WIDTH, HEIGHT, START_TIME, asymmetricStormTexture } from "./fixtures/radar-seam-engine-fixtures.mjs";

const require = createRequire(import.meta.url);
const seam = require("../radar-seam-engine.js");
const rawSource = await readFile(new URL("../raw-map-runtime.js", import.meta.url), "utf8");
const seamSource = await readFile(new URL("../radar-seam-engine.js", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../map.js", import.meta.url), "utf8");

// Each selected raw helper is followed by another function at the same indent.
function sourceFunction(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Missing raw helper ${name}`);
  const end = source.indexOf("\n  function ", start + 1);
  assert.ok(end > start, `Missing boundary after ${name}`);
  return source.slice(start, end);
}
const constantsStart = mapSource.indexOf("const MAPLIBRE_RADAR_RAMP =");
const constantsEnd = mapSource.indexOf("\nfunction ", constantsStart);
const colorsStart = mapSource.indexOf("function colorizeMapLibreRadarImageData(");
const colorsEnd = mapSource.indexOf("function mapLibreSourceBounds(", colorsStart);
assert.ok(constantsStart >= 0 && constantsEnd > constantsStart && colorsStart >= 0 && colorsEnd > colorsStart);
const oracle = vm.createContext({});
vm.runInContext([
  ...["encodeDbz", "textureStats", "normalizeTextureStats", "finiteOrNull"].map((name) => sourceFunction(rawSource, name)),
  seamSource.match(/  const MAX_LEAD_MINUTES = [^;]+;/)[0],
  seamSource.match(/  const DEFAULT_LEADS_MINUTES = [^;]+;/)[0],
  ...["normalizeTargets", "parseTime"].map((name) => sourceFunction(seamSource, name)),
  mapSource.slice(constantsStart, constantsEnd),
  mapSource.slice(colorsStart, colorsEnd)
].join("\n"), oracle);

const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const encoding = { dbzMin: 0, dbzMax: 80, threshold: 5 };
function rgba(data, enc = encoding, alpha = 1.22) {
  const imageData = { data: new Uint8ClampedArray(data.length * 4) };
  data.forEach((value, index) => { imageData.data[index * 4] = value; imageData.data[index * 4 + 3] = 255; });
  oracle.colorizeMapLibreRadarImageData(imageData, { min: enc.dbzMin, max: enc.dbzMax, threshold: enc.threshold, style: "resolved", alpha });
  return imageData.data;
}
const iso = (minutes, origin = START_TIME) => new Date(origin + minutes * 60_000).toISOString();
const frameJSON = (frame) => ({ width: frame.width, height: frame.height, validTime: frame.validTime, bytesBase64: base64(frame.data) });
const frame = (data, minutes = 0, width = 8, height = 8) => ({ width, height, data, validTime: iso(minutes) });
const outputJSON = (result) => ({
  ...frameJSON(result), correctionFactor: result.correctionFactor, displacementX: result.displacementX,
  displacementY: result.displacementY, intensityScale: result.intensityScale, confidence: result.confidence
});

const encodings = [encoding, { dbzMin: -20, dbzMax: 120, threshold: -3 }, { dbzMin: 40, dbzMax: 41, threshold: 40 }];
const encodingCases = encodings.map((enc) => ({
  encoding: enc,
  values: [-150, -20, 0, 4.99, 5, 5.01, 10, 20, 40, 40.5, 60, 80, 120, 150, 300],
  encoded: [-150, -20, 0, 4.99, 5, 5.01, 10, 20, 40, 40.5, 60, 80, 120, 150, 300].map((value) => oracle.encodeDbz(value, enc)),
  decoded: Array.from({ length: 256 }, (_, value) => oracle.textureStats(Uint8Array.of(value), enc).minDbz)
}));
const sweep = Uint8Array.from({ length: 256 }, (_, index) => index);
const colors = encodings.flatMap((enc) => [0.2, 1.22, 1.9].map((alpha) => ({
  encoding: enc, alpha, width: 16, height: 16, inputBase64: base64(sweep), expectedBase64: base64(rgba(sweep, enc, alpha))
})));
const small = Uint8Array.from([0, 1, 64, 255, 32, 80, 128, 254, 5, 7, 9, 11]);
const translations = [];
for (const interpolation of ["nearest", "bilinear"]) {
  for (const [dx, dy, scale] of [[0, 0, 1], [1, -1, 1], [-0.5, 0.5, 1], [0.25, -0.75, 1.3], [-1.5, -0.5, 2.5], [4, 0, 1], [0, 3, 0.1]]) {
    translations.push({ name: `${interpolation}/${dx}/${dy}/${scale}`, width: 4, height: 3, inputBase64: base64(small),
      dx, dy, scale, interpolation, expectedBase64: base64(seam.translateTexture(small, 4, 3, dx, dy, { interpolation, intensityScale: scale })) });
  }
}
const storm = asymmetricStormTexture();
for (const interpolation of ["nearest", "bilinear"]) {
  translations.push({ name: `asymmetric-storm/${interpolation}`, width: WIDTH, height: HEIGHT, inputBase64: base64(storm),
    dx: 6.25, dy: -3.5, scale: 1, interpolation,
    expectedBase64: base64(seam.translateTexture(storm, WIDTH, HEIGHT, 6.25, -3.5, { interpolation })) });
}
const opposite = Uint8Array.from(small, (value) => 255 - value);
const blends = [-1, 0, 0.15625, 0.5, 0.84375, 1, 2].map((weight) => ({
  width: 4, height: 3, observedBase64: base64(small), forecastBase64: base64(opposite), weight,
  expectedBase64: base64(seam.blendTextures(small, opposite, 4, 3, weight))
}));
const pattern = Uint8Array.from({ length: 64 }, (_, index) => index % 7 === 0 ? 0 : (index * 31 + 1) % 256);
const correction = { status: "ready", dx: 1.5, dy: -0.75, intensityScale: 1.25, confidence: 0.82, anchorValidTime: iso(0) };
const corrections = [];
for (const [minutes, decayMinutes] of [[-5, 75], [0, 75], [37.5, 75], [74.994, 75], [75, 75], [100, 75], [15, 1], [90, 999]]) {
  for (const interpolation of ["nearest", "bilinear"]) {
    const input = frame(pattern, minutes);
    const result = seam.applyForecastCorrection(input, correction, { correctionDecayMinutes: decayMinutes, interpolation });
    assert.equal(result.status, "ready");
    corrections.push({ input: frameJSON(input), correction, decayMinutes, interpolation, expected: outputJSON(result) });
  }
}

const compositing = [];
for (const scenario of ["matched", "missing", "one-millisecond-mismatch", "duplicate-last-wins"]) {
  const nowcasts = [12.5, 15, 30, 45, 60, 90].map((leadMinutes) => ({ ...frame(pattern, leadMinutes), leadMinutes, anchorValidTime: iso(0), confidence: 0.71 }));
  let forecasts = nowcasts.map((item) => ({ ...item, data: Uint8Array.from(pattern, (byte) => Math.round(byte * 0.6)), correctionFactor: 0.4 }));
  if (scenario === "missing") forecasts = [];
  if (scenario === "one-millisecond-mismatch") forecasts = forecasts.map((item) => ({ ...item, validTime: new Date(Date.parse(item.validTime) + 1).toISOString() }));
  if (scenario === "duplicate-last-wins") forecasts.push({ ...forecasts[2], data: new Uint8Array(64).fill(255), correctionFactor: 0.6 });
  const result = seam.composeSeamFrames(nowcasts, forecasts, correction);
  compositing.push({ scenario, correctionConfidence: correction.confidence,
    nowcasts: nowcasts.map((item) => ({ ...frameJSON(item), anchorValidTime: item.anchorValidTime, confidence: item.confidence })),
    forecasts: forecasts.map((item) => ({ ...frameJSON(item), correctionFactor: item.correctionFactor })),
    expected: result.map((item) => ({ ...frameJSON(item), kind: item.kind, sourceProvider: item.sourceProvider,
      anchorValidTime: item.anchorValidTime, leadMinutes: item.leadMinutes, confidence: item.confidence,
      confidenceLevel: item.confidenceLevel, ...item.blend }))
  });
}
const observed = { ...frame(storm, 45, WIDTH, HEIGHT), anchorValidTime: iso(0), leadMinutes: 45, confidence: 0.71 };
const hrrr = { ...observed, data: seam.translateTexture(storm, WIDTH, HEIGHT, 8, -4, { intensityScale: 0.8 }), correctionFactor: 0 };
const syntheticSeam = seam.composeSeamFrames([observed], [hrrr], correction)[0];
const preview = { width: WIDTH, height: HEIGHT, frames: [
  ["synthetic-observed", "Synthetic observed extrapolation", observed],
  ["synthetic-hrrr", "Synthetic HRRR-like guidance", hrrr],
  ["synthetic-seam", "Synthetic 50/50 seam", syntheticSeam]
].map(([id, label, item]) => ({ id, label, validTime: item.validTime, bytesBase64: base64(item.data), rgbaBase64: base64(rgba(item.data)) })) };
const times = ["2026-08-17T18:00:00Z", "2026-08-17T18:00:00.123Z", "2026-08-17T13:00:00.001-05:00", "2026-08-18T01:00:00.999+07:00", "1970-01-01T00:00:00.001Z", "1969-12-31T23:59:59.999Z"].map((input) => ({ input, milliseconds: Date.parse(input), canonical: new Date(input).toISOString() }));
const targetLeads = [1 / 60_000, 0.0005, 0.0625, 0.1875, 12.5005, 15.1875, 30.3335, 45.8165, 60.9995, 90].map((lead) => {
  const validTime = iso(lead);
  const result = oracle.normalizeTargets({ targetValidTimes: [validTime] }, START_TIME);
  assert.equal(result.ok, true);
  return { validTime, anchorValidTime: iso(0), leadMinutes: result.values[0].leadMinutes };
});
const fixture = { version: 1, provenance: "Synthetic only. Expected results executed from checked-in radar-seam-engine.js, raw-map-runtime.js, and map.js CPU resolved color functions.",
  exclusions: ["No provider acquisition or decoder", "No native motion or correction estimation", "No full buildSeam/runtime quality-gate parity", "No GPU shader/rendered visual parity"],
  encodingCases, colors, translations, blends, corrections, compositing, times, targetLeads, preview };
if (process.argv.includes("--emit")) {
  process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
} else {
  const saved = JSON.parse(await readFile(new URL("./fixtures/native-radar/numeric-contract.json", import.meta.url), "utf8"));
  // JSON intentionally canonicalizes -0 to 0; compare the transport contract.
  assert.deepEqual(saved, JSON.parse(JSON.stringify(fixture)), "Native numeric fixture is stale relative to web primitives; review and regenerate.");
  console.log(`PASS Native radar JS oracle: ${translations.length} translations, ${blends.length} blends, ${corrections.length} corrections, ${compositing.length} time-matched compositions, 3 encoding ranges, 9 full-byte color sweeps; synthetic only`);
}
