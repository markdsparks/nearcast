import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../daygraph.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("function dayOverviewNumber("), source.indexOf("function dayDetailSharedEvent("));
let clock24 = true;
const data = { daily: { time: ["2026-09-07", "2026-09-08"] }, now: Date.parse("2026-09-07T15:30:00Z"), offsetMs: -5 * 3600000 };
const parse = (iso, forecast = data) => Date.parse(`${iso}Z`) - forecast.offsetMs;
const host = { hidden: true, innerHTML: "", dataset: {} };
let rows = [];
const context = {
  state: { forecast: data },
  dayDetailNavState: null,
  forecastNowMs: (forecast) => forecast.now,
  parseForecastTimestamp: parse,
  addDaysToDateString: (date, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10),
  formatTime: (iso) => {
    const hour = Number(iso.slice(11, 13));
    return clock24 ? `${String(hour).padStart(2, "0")}:00` : `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
  },
  formatForecastMs: (ms, forecast) => new Date(ms + forecast.offsetMs).toISOString().slice(11, 16),
  forecastStoryCondition: (code) => ({ 0: "Clear", 3: "Cloudy", 61: "Light rain", 71: "Snow", 95: "Thunderstorms" }[code]),
  isThunderCode: (code) => code === 95,
  isSnowCode: (code) => code === 71,
  isPrecipCode: (code) => [61, 71, 95].includes(code),
  escapeHtml: (value) => String(value),
  degree: (unit) => `°${unit}`,
  weatherIcon: () => "<svg></svg>",
  thunderBadgeHtml: () => "<span>thunder</span>",
  bindTapDelegate: () => {},
  document: { getElementById: () => host, querySelectorAll: () => rows },
  window: { matchMedia: () => ({ matches: true }) },
  setSheetHourRowExpanded: (row, expanded) => { row.expanded = expanded; }
};
vm.createContext(context);
vm.runInContext(functions, context);
for (const value of [false, true, "", " ", null, undefined, NaN]) assert.equal(context.dayOverviewNumber(value), null);
const build = (day) => Array.from({ length: 24 }, (_, hour) => {
  const time = `${day}T${String(hour).padStart(2, "0")}:00`;
  return {
    time, ms: parse(time), endMs: parse(time) + 3600000,
    temp: 60 + hour, tempAvailable: true, code: 0, isDay: hour >= 6 && hour < 19,
    forecastPop: 4, popAvailable: true, stormPotential: false
  };
});
const hours = build("2026-09-08");
let periods = context.dayOverviewPeriods(hours, { data, dayIndex: 1 });
assert.deepEqual(Array.from(periods, (period) => period.key), ["overnight", "morning", "afternoon", "evening"]);
assert.equal(periods[0].startMs, parse("2026-09-08T00:00"));
assert.equal(periods[0].endMs, parse("2026-09-08T06:00"));
assert.equal(periods[3].endMs, parse("2026-09-09T00:00"), "Evening ends at the selected civil day's midnight");
assert.equal(periods[0].isDay, false);
assert.equal(periods[1].isDay, true);
assert.equal(periods[1].range, "06:00–12:00");
assert.equal(periods[1].cue, "", "a trivial 4% chance does not add noise");
assert.equal(periods[1].low, 66);
assert.equal(periods[1].high, 71);

hours[15] = { ...hours[15], stormPotential: true, convective: { level: "possible" }, forecastPop: 30 };
periods = context.dayOverviewPeriods(hours, { data, dayIndex: 1 });
assert.equal(periods[2].condition, "Clear", "the modal sky and a short storm possibility stay distinct");
assert.equal(periods[2].cue, "Thunder possible near 15:00");
hours[15] = { ...hours[15], code: 95, convective: { level: "likely" } };
assert.equal(context.dayOverviewPeriods(hours, { data, dayIndex: 1 })[2].cue, "Thunderstorms likely near 15:00");
hours[8] = { ...hours[8], forecastPop: 60 };
assert.equal(context.dayOverviewPeriods(hours, { data, dayIndex: 1 })[1].cue, "Rain likely near 08:00 · 60%");
hours[23] = { ...hours[23], stormPotential: true, forecastPop: 30 };
assert.equal(context.dayOverviewPeriods(hours, { data, dayIndex: 1 })[3].cue, "Thunder possible near 23:00", "a late storm cannot make the entire evening read as stormy");
const rainyPeriod = hours.map((hour, index) => index >= 16 && index < 18 ? { ...hour, forecastPop: 70 } : { ...hour, code: 0, stormPotential: false, convective: null });
assert.equal(context.dayOverviewPeriods(rainyPeriod, { data, dayIndex: 1 })[2].cue, "Rain likely 16:00–18:00 · 70%");

const missing = hours.slice(0, 6).map((hour) => ({ ...hour, temp: 0, tempAvailable: false, forecastPop: null, popAvailable: false }));
const missingPeriod = context.dayOverviewPeriods(missing, { data, dayIndex: 1 })[0];
assert.equal(missingPeriod.low, null, "missing temperature cannot become zero degrees");
assert.equal(missingPeriod.cue, "Rain chance unavailable");
const missingCodes = context.dayOverviewPeriods(missing.map(hour => ({ ...hour, code: 0, codeAvailable: false })), { data, dayIndex: 1 })[0];
assert.equal(missingCodes.code, null, "fallback Clear is not an available forecast condition");
assert.equal(missingCodes.condition, "Conditions unavailable");
assert.equal(context.dayOverviewPeriods(hours.slice(3), { data, dayIndex: 1 })[0].partial, true);
assert.equal(context.dayOverviewPeriods([...hours, ...build("2026-09-09")], { data, dayIndex: 1 }).length, 4, "adjacent dates cannot leak into the selected day");

const today = build("2026-09-07");
periods = context.dayOverviewPeriods(today, { data, dayIndex: 0, showNow: true });
assert.deepEqual(Array.from(periods, (period) => period.key), ["morning", "afternoon", "evening"], "elapsed overnight is omitted");
assert.equal(periods[0].label, "Rest of morning");
assert.equal(periods[0].range, "Now–12:00");
assert.equal(periods[0].startMs, data.now);
assert.equal(periods[0].low, 70, "elapsed cold hours do not enter the remaining-period temperature range");
assert.equal(periods[0].partial, false);
data.now = parse("2026-09-07T18:00");
assert.deepEqual(Array.from(context.dayOverviewPeriods(today, { data, dayIndex: 0, showNow: true }), (period) => period.key), ["evening"], "the exact period boundary removes the completed period");
clock24 = false;
assert.equal(context.dayOverviewPeriods(hours, { data, dayIndex: 1 })[1].range, "6:00 AM–12:00 PM", "clock preference is reused");

context.renderDayOverviewPeriods(hours, { data, dayIndex: 1, source: "rolling", tempUnit: "F" });
assert.equal(host.hidden, true, "the rolling Hourly surface is not given another overview");
context.renderDayOverviewPeriods(hours, { data, dayIndex: 1, source: "day", eventWindow: { memoryId: "plan" }, tempUnit: "F" });
assert.equal(host.hidden, true, "a focused plan/event keeps its own compact context");
context.renderDayOverviewPeriods(hours, { data, dayIndex: 1, source: "day", tempUnit: "F" });
assert.equal(host.hidden, false);
assert.equal((host.innerHTML.match(/data-day-period=/g) || []).length, 4);

rows = hours.map((hour) => ({
  dataset: { forecastStart: String(hour.ms), forecastEnd: String(hour.endMs) },
  scrollIntoView(options) { this.scrollOptions = options; },
  focus() { this.focused = true; }
}));
context.dayDetailNavState = { source: "day", dayIndex: 1 };
const start = parse("2026-09-08T12:00");
const end = parse("2026-09-08T18:00");
context.jumpToDayOverviewPeriod({ dataset: { periodStart: String(start), periodEnd: String(end), periodKind: "storm", periodLabel: "Afternoon" } });
assert.equal(rows[12].expanded, true);
assert.equal(rows[12].focused, true);
assert.equal(rows[12].scrollOptions.behavior, "auto", "reduced motion is respected");
assert.equal(context.dayDetailNavState.forecastFocus.startMs, start);
assert.equal(context.dayDetailNavState.forecastFocus.endMs, end);
assert.equal(context.dayDetailNavState.forecastFocus.source, "day-period", "Map retains the full selected window after the row jump");
assert.match(html, /id="sheetDayPeriods"/);
assert.match(styles, /\.sheet-day-period-description[^}]*overflow-wrap: anywhere/);
assert.match(styles, /\.sheet-day-period\s*\{[^}]*touch-action: pan-y/);
assert.doesNotMatch(functions, /airQuality|current\.us_aqi/);
console.log("Day overview: civil periods, missing data, clock settings, exact row/Map handoff, and focused-flow scope passed.");
