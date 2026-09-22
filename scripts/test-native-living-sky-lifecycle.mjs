import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preview = readFileSync(new URL('../native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewView.swift', import.meta.url), 'utf8');
const root = readFileSync(new URL('../native/ios/NearcastApp/Views/ContentView.swift', import.meta.url), 'utf8');
const gate = preview.match(/private var livingSkyMotionAllowed: Bool \{([\s\S]*?)\n    \}/)?.[1];
assert.ok(gate, 'The native weather surface owns the single motion gate');
assert.match(gate, /guard #available\(iOS 18\.0, \*\) else \{ return false \}/,
  'Older systems remain static without native visibility/scroll signals');

// Evaluate the actual Swift boolean expression, not a separately maintained
// copy of the lifecycle policy. This is source-level gate coverage, not a
// replacement for the simulator's clipping, presentation, or animation tests.
const expression = gate.slice(gate.indexOf('return usesLivingSky') + 'return '.length)
  .trim()
  .replace(/\bnil\b/g, 'null')
  .replace(/\.(active|increased|nominal|fair)\b/g, '"$1"');
const evaluate = new Function('state', `with (state) { return (${expression}); }`);
const visible = {
  usesLivingSky: true, viewIsVisible: true, isUncovered: true, scenePhase: 'active',
  hasUsableForecast: true,
  isToday: true, isHourly: false, hasCurrentSkyEvidence: true, heroIsVisible: true,
  isScrolling: false, weatherDetail: null, assistantEntry: null, showingNativeMap: false,
  confirmingLegacy: false, showingCurrentConditionExplanation: false, switchingPlaceID: null, reduceMotion: false,
  reduceTransparency: false, colorSchemeContrast: 'standard', isLowPowerMode: false,
  thermalState: 'nominal',
};
assert.equal(evaluate(visible), true, 'The visible current hero may animate');
for (const [key, value] of [
  ['usesLivingSky', false], ['viewIsVisible', false], ['isUncovered', false],
  ['hasUsableForecast', false],
  ['scenePhase', 'inactive'], ['scenePhase', 'background'], ['isToday', false],
  ['isHourly', true], ['hasCurrentSkyEvidence', false], ['heroIsVisible', false],
  ['isScrolling', true], ['weatherDetail', 'overview'], ['assistantEntry', 'ask'],
  ['showingNativeMap', true], ['confirmingLegacy', true], ['switchingPlaceID', 'another-place'],
  ['showingCurrentConditionExplanation', true],
  ['reduceMotion', true], ['reduceTransparency', true], ['colorSchemeContrast', 'increased'],
  ['isLowPowerMode', true], ['thermalState', 'serious'], ['thermalState', 'critical'],
  ['thermalState', 'unknown'],
]) {
  assert.equal(evaluate({ ...visible, [key]: value }), false, `${key}=${value} pauses motion`);
}
assert.equal(evaluate({ ...visible, thermalState: 'fair' }), true, 'Fair thermal state is allowed');
assert.doesNotMatch(gate, /scrollViewportHeight/, 'Modern motion does not depend on a second geometry measurement');

const visibility = preview.match(/private struct NativeSkyHeroVisibilityGate:[\s\S]*?(?=\/\/\/ Observe native scroll ownership)/)?.[0];
assert.ok(visibility, 'Hero visibility has one bounded adapter');
assert.match(visibility, /if #available\(iOS 18\.0, \*\) \{\s*content\.onScrollVisibilityChange\(threshold: 0\.05\)/,
  'Motion-capable systems use native initial visibility and viewport clipping');
assert.match(visibility, /\} else \{\s*content\.onGeometryChange/,
  'Geometry is restricted to the still-only older-system fallback');
assert.match(visibility, /frame\.maxY > 24 && frame\.minY < viewportHeight/,
  'The fallback tests both viewport boundaries');
assert.match(preview, /NativeSkyHeroVisibilityGate\(viewportHeight: scrollViewportHeight\)[\s\S]*?withAnimation\(reduceMotion \? nil : \.easeInOut\(duration: 0\.35\)\)/,
  'The reading veil keeps its restrained, Reduce Motion-aware transition');
assert.match(preview, /var isUncovered: Bool = false/, 'Hosts without presentation ownership default to stills');
assert.match(root, /isUncovered: placesSettingsTab == nil && webModel\.showingNativePreview\s*&& webModel\.nativePreviewError == nil/,
  'Ancestor Places, Settings, native-home dismissal, and error presentation gate motion');
assert.match(preview, /NSProcessInfoPowerStateDidChange/, 'Low Power Mode uses OS notifications');
assert.match(preview, /ProcessInfo\.thermalStateDidChangeNotification/, 'Thermal changes use OS notifications');
assert.match(preview, /@Environment\(\\\.accessibilityDimFlashingLights\) private var dimFlashingLights/,
  'The native host reads the actual Dim Flashing Lights accessibility preference');
assert.match(preview, /dimFlashingLights: dimFlashingLights/,
  'The preference reaches the backdrop rather than being a test-only star gate');

const backdrop = readFileSync(new URL('../native/ios/NearcastApp/NativeWeather/NativeLivingSkyBackdrop.swift', import.meta.url), 'utf8');
assert.match(backdrop, /canMove && !dimFlashingLights && scene\.source == \.currentForecast[\s\S]*?scene\.context == \.current[\s\S]*?scene\.nightSky\.starVisibility > 0/,
  'Star twinkle requires allowed current night evidence and honors Dim Flashing Lights');

const identity = preview.match(/private var livingSkyIdentity: String \{([\s\S]*?)\n    \}/)?.[1];
assert.ok(identity);
assert.match(identity, /selectedPlace\.coordinateIdentity/);
assert.match(identity, /"hour:/);
assert.match(identity, /"day:/);
assert.match(identity, /"current"/);
assert.doesNotMatch(identity, /generatedAt|Date\(\)/, 'Forecast refreshes do not reset scene identity');
console.log('PASS Native Living Sky lifecycle source gates: native hero visibility, all pause conditions, ancestor coverage, notification-only power/thermal updates, stable place/time identity');
